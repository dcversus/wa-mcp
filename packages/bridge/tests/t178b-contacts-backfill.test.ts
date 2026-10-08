import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import type { WAMessage, WASocket } from "baileys";
import { openStore, type Store } from "../src/store/schema.ts";
import { storeMessage, upsertChatMeta } from "../src/store/messages.ts";
import {
  getContact,
  listContactViews,
  upsertContact,
  upsertResolvedContact,
} from "../src/store/contacts.ts";
import { backfillContacts, lidResolver } from "../src/store/contact-backfill.ts";
import { createEventBus } from "../src/events.ts";
import { createHttpServer } from "../src/http.ts";
import type { BridgeHandle } from "../src/lifecycle.ts";

const TOKEN = "t178b-token";
const VASILISA = "351930017568@s.whatsapp.net";
const VASILISA_LID = "55600000009854@lid";
const OWNER = "358497773518@s.whatsapp.net";
const BOB = "358400000007@s.whatsapp.net";
const GROUP = "120363428874442773@g.us";
const STRANGER_LID = "99887766554433@lid";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) {
    await fn();
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeStore(): Store {
  const store = openStore(tempDir("t178b-store-"));
  cleanups.push(() => store.close());
  return store;
}

/** the engine's lid-mapping key files (fork lid-mapping.js batchData) */
function authDirWith(pairs: Array<[lidUser: string, pnUser: string]>): string {
  const dir = tempDir("t178b-auth-");
  for (const [lidUser, pnUser] of pairs) {
    writeFileSync(join(dir, `lid-mapping-${lidUser}_reverse.json`), JSON.stringify(pnUser));
    writeFileSync(join(dir, `lid-mapping-${pnUser}.json`), JSON.stringify(lidUser));
  }
  return dir;
}

function message(
  store: Store,
  chat: string,
  id: string,
  opts: { participant?: string; pushName?: string; fromMe?: boolean },
): void {
  storeMessage(store, {
    key: { remoteJid: chat, fromMe: opts.fromMe ?? false, id, participant: opts.participant },
    message: { conversation: `msg ${id}` },
    messageTimestamp: 1_791_000_000,
    pushName: opts.pushName,
  } as unknown as WAMessage);
}

/** the live-db shape that shipped raw LIDs: named chats, a group, sender
 * history, and three bare @lid roster rows from the group warmup */
function seedLiveShape(store: Store): void {
  upsertChatMeta(store, { id: VASILISA, name: "Vasilisa" });
  upsertChatMeta(store, { id: GROUP, name: "Test group" });
  message(store, GROUP, "g1", { participant: BOB, pushName: "Bob B" });
  message(store, GROUP, "g2", { participant: VASILISA_LID, pushName: "Vasi" });
  message(store, GROUP, "g3", { participant: OWNER, pushName: "Owner Me", fromMe: true });
  message(store, GROUP, "g4", { participant: STRANGER_LID, pushName: "Stranger" });
  store.db
    .prepare("INSERT INTO contacts (jid) VALUES (?), (?), (?)")
    .run(VASILISA_LID, STRANGER_LID, "11112222333344@lid");
}

function allContacts(store: Store): Array<Record<string, unknown>> {
  return store.db.prepare("SELECT * FROM contacts ORDER BY jid").all() as Array<
    Record<string, unknown>
  >;
}

test("T178b backfill — named chats + sender history become PN contact rows; groups and fromMe excluded", () => {
  const store = makeStore();
  seedLiveShape(store);
  const authDir = authDirWith([["55600000009854", "351930017568"]]);
  const result = backfillContacts(store, { resolvePn: lidResolver(authDir) });
  expect(getContact(store, VASILISA)).toEqual({
    jid: VASILISA,
    name: "Vasilisa",
    pushname: "Vasi",
    businessName: null,
    phone: "351930017568",
    username: null,
    lid: VASILISA_LID,
  });
  expect(getContact(store, BOB)).toMatchObject({ pushname: "Bob B", phone: "358400000007" });
  expect(getContact(store, OWNER)).toBeNull();
  expect(getContact(store, GROUP)).toBeNull();
  expect(result).toEqual({
    fromChats: 1,
    fromSenders: 3,
    mergedLids: 1,
    removedNonPersons: 0,
    removedEmpty: 1,
    unresolvedLids: 1,
    total: 3,
  });
});

test("T178b backfill — LID merge collapses the duplicate into the PN row and keeps the lid column", () => {
  const store = makeStore();
  upsertContact(store, { jid: VASILISA, name: "Vasilisa" });
  upsertContact(store, { jid: VASILISA_LID, pushname: "Vasi", username: "vasi_v" });
  backfillContacts(store, {
    resolvePn: lidResolver(authDirWith([["55600000009854", "351930017568"]])),
  });
  expect(allContacts(store).map((row) => row.jid)).toEqual([VASILISA]);
  expect(getContact(store, VASILISA)).toMatchObject({
    name: "Vasilisa",
    pushname: "Vasi",
    username: "vasi_v",
    lid: VASILISA_LID,
    phone: "351930017568",
  });
});

test("T178b backfill — fills blanks only: a roster name is never overwritten by a chat name", () => {
  const store = makeStore();
  upsertContact(store, { jid: VASILISA, name: "Vasilisa Versus", pushname: "V" });
  upsertChatMeta(store, { id: VASILISA, name: "Vasilisa" });
  message(store, GROUP, "g1", { participant: VASILISA, pushName: "Vasi" });
  backfillContacts(store, { resolvePn: () => null });
  expect(getContact(store, VASILISA)).toMatchObject({ name: "Vasilisa Versus", pushname: "V" });
});

test("T178b backfill — group/newsletter/broadcast rows are purged from contacts", () => {
  const store = makeStore();
  upsertContact(store, { jid: GROUP, name: "Test group" });
  upsertContact(store, { jid: "status@broadcast", name: "Status" });
  upsertContact(store, { jid: OWNER, name: "Owner" });
  const result = backfillContacts(store, { resolvePn: () => null });
  expect(allContacts(store).map((row) => row.jid)).toEqual([OWNER]);
  expect(result.removedNonPersons).toBe(2);
});

test("T178b backfill — an unresolved LID keeps its row, named from its message history", () => {
  const store = makeStore();
  seedLiveShape(store);
  backfillContacts(store, { resolvePn: () => null });
  expect(getContact(store, STRANGER_LID)).toMatchObject({
    pushname: "Stranger",
    lid: STRANGER_LID,
  });
  const view = listContactViews(store, {}).contacts.find((c) => c.jid === STRANGER_LID);
  expect(view?.displayName).toBe("Stranger");
});

test("T178b backfill — dryRun reports the same counts and leaves the table untouched; rerun is idempotent", () => {
  const store = makeStore();
  seedLiveShape(store);
  const resolvePn = lidResolver(authDirWith([["55600000009854", "351930017568"]]));
  const before = allContacts(store);
  const dry = backfillContacts(store, { resolvePn, dryRun: true });
  expect(allContacts(store)).toEqual(before);
  const real = backfillContacts(store, { resolvePn });
  expect(real).toEqual(dry);
  const after = allContacts(store);
  backfillContacts(store, { resolvePn });
  expect(allContacts(store)).toEqual(after);
});

test("T178b lidResolver — strips device suffixes and rejects junk mapping files", () => {
  const dir = authDirWith([["55600000009854", "351930017568"]]);
  writeFileSync(join(dir, "lid-mapping-42_reverse.json"), '"not digits"');
  const resolve = lidResolver(dir);
  expect(resolve("55600000009854@lid")).toBe(VASILISA);
  expect(resolve("55600000009854:12@lid")).toBe(VASILISA);
  expect(resolve("42@lid")).toBeNull();
  expect(resolve(VASILISA)).toBeNull();
});

test("T178b upsertResolvedContact — a lid-only event resolves through the mapping to the PN row", () => {
  const store = makeStore();
  const resolvePn = lidResolver(authDirWith([["55600000009854", "351930017568"]]));
  expect(upsertResolvedContact(store, { jid: VASILISA_LID }, resolvePn)).toBe(true);
  expect(allContacts(store).map((row) => row.jid)).toEqual([VASILISA]);
  expect(getContact(store, VASILISA)).toMatchObject({ lid: VASILISA_LID, phone: "351930017568" });
});

test("T178b upsertResolvedContact — never stores an all-NULL row; groups are not contacts", () => {
  const store = makeStore();
  expect(upsertResolvedContact(store, { jid: STRANGER_LID }, () => null)).toBe(false);
  expect(upsertResolvedContact(store, { jid: GROUP, name: "Test group" }, () => null)).toBe(false);
  expect(upsertResolvedContact(store, { jid: STRANGER_LID, pushname: "S" }, () => null)).toBe(true);
  expect(allContacts(store).map((row) => row.jid)).toEqual([STRANGER_LID]);
});

test("T178b upsertResolvedContact — an event carrying lid + phoneNumber lands on the PN jid and absorbs the old LID row", () => {
  const store = makeStore();
  upsertContact(store, { jid: VASILISA_LID, pushname: "Vasi" });
  upsertResolvedContact(
    store,
    { jid: VASILISA_LID, name: "Vasilisa", phone: "351930017568" },
    () => null,
  );
  expect(allContacts(store).map((row) => row.jid)).toEqual([VASILISA]);
  expect(getContact(store, VASILISA)).toMatchObject({
    name: "Vasilisa",
    pushname: "Vasi",
    lid: VASILISA_LID,
  });
});

test("T178b listContactViews — rows with nothing to show are hidden and not counted", () => {
  const store = makeStore();
  store.db.prepare("INSERT INTO contacts (jid) VALUES (?)").run(STRANGER_LID);
  upsertContact(store, { jid: OWNER, name: "Owner" });
  const views = listContactViews(store, {});
  expect(views.contacts.map((view) => view.jid)).toEqual([OWNER]);
  expect(views.total).toBe(1);
});

function handle(): BridgeHandle {
  return {
    status: "connected",
    events: createEventBus(),
    close: async () => {},
    getLastQr: () => null,
    socket: undefined as WASocket | undefined,
    hasPairedAccount: () => true,
    pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
    resumePairing: () => {},
    connectionQuality: () => ({ reconnects: 0, lastDisconnectAt: null }),
    logout: async () => {},
    fetchHistory: async () => ({ requested: false, request_id: "" }),
    contactsWarm: () => true,
  } as unknown as BridgeHandle;
}

test("T178b POST /api/contacts/sync — dry_run reports counts without writing; real run backfills", async () => {
  const store = makeStore();
  seedLiveShape(store);
  const bridge = await createHttpServer(handle(), {
    token: TOKEN,
    store,
    dataDir: tempDir("t178b-data-"),
  });
  cleanups.push(() => bridge.close());
  const post = async (path: string): Promise<{ status: number; body: Record<string, unknown> }> => {
    const res = await fetch(`http://127.0.0.1:${bridge.port}${path}`, {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}` },
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  };
  const dry = await post("/api/contacts/sync?dry_run=1");
  expect(dry.status).toBe(200);
  expect(dry.body).toMatchObject({ dryRun: true, fromChats: 1, fromSenders: 3 });
  expect(getContact(store, VASILISA)).toBeNull();
  const real = await post("/api/contacts/sync");
  expect(real.status).toBe(200);
  expect(real.body).toMatchObject({ dryRun: false, fromChats: 1 });
  expect(getContact(store, VASILISA)).toMatchObject({ name: "Vasilisa", phone: "351930017568" });
  const list = await fetch(`http://127.0.0.1:${bridge.port}/api/contacts`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const listed = (await list.json()) as { contacts: Array<{ jid: string; phone: string | null }> };
  expect(listed.contacts.find((c) => c.jid === VASILISA)?.phone).toBe("+351 93 001 7568");
});
