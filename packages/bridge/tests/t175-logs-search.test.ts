import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import type { WAMessage } from "baileys";
import { openStore, type Store } from "../src/store/schema.ts";
import { storeMessage } from "../src/store/messages.ts";
import { searchMessages } from "../src/store/queries.ts";
import { createEventBus } from "../src/events.ts";
import { createHttpServer, type BridgeHttp } from "../src/http.ts";
import type { BridgeHandle } from "../src/lifecycle.ts";

const GROUP_A = "120363428874442773@g.us";
const GROUP_B = "120363999999999999@g.us";
const ALICE = "358401112222@s.whatsapp.net";
const BOB = "358403334444@s.whatsapp.net";
const ME = "358409990000@s.whatsapp.net";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) {
    await fn();
  }
});

function makeStore(): Store {
  const dir = mkdtempSync(join(tmpdir(), "t175-"));
  const store = openStore(dir);
  cleanups.push(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

function seed(
  store: Store,
  id: string,
  chatJid: string,
  seconds: number,
  text: string,
  from: { fromMe: boolean; participant: string },
): void {
  storeMessage(store, {
    key: { remoteJid: chatJid, fromMe: from.fromMe, id, participant: from.participant },
    message: { conversation: text },
    messageTimestamp: seconds,
    pushName: "Someone",
  } as unknown as WAMessage);
}

function seedAll(store: Store): void {
  seed(store, "M1", GROUP_A, 1000, "pizza from alice", { fromMe: false, participant: ALICE });
  seed(store, "M2", GROUP_A, 2000, "pizza reply from me", { fromMe: true, participant: ME });
  seed(store, "M3", GROUP_B, 3000, "burger from bob", { fromMe: false, participant: BOB });
  seed(store, "M4", GROUP_B, 4000, "pizza from bob", { fromMe: false, participant: BOB });
  seed(store, "M5", GROUP_A, 5000, "100%_off deal", { fromMe: false, participant: ALICE });
}

function ids(rows: Array<{ id: string }>): string[] {
  return rows.map((row) => row.id);
}

test("T175 A1 store — empty query with no filters lists every message newest first", () => {
  const store = makeStore();
  seedAll(store);
  expect(ids(searchMessages(store, "", {}))).toEqual(["M5", "M4", "M3", "M2", "M1"]);
});

test("T175 A1 store — direction in/out filters on is_from_me", () => {
  const store = makeStore();
  seedAll(store);
  expect(ids(searchMessages(store, "", { direction: "out" }))).toEqual(["M2"]);
  expect(ids(searchMessages(store, "", { direction: "in" }))).toEqual(["M5", "M4", "M3", "M1"]);
});

test("T175 A1 store — fromJid filters on the sender", () => {
  const store = makeStore();
  seedAll(store);
  expect(ids(searchMessages(store, "", { fromJid: BOB }))).toEqual(["M4", "M3"]);
});

test("T175 A1 store — since/until bound the timestamp inclusively", () => {
  const store = makeStore();
  seedAll(store);
  expect(ids(searchMessages(store, "", { since: new Date(3000 * 1000) }))).toEqual([
    "M5",
    "M4",
    "M3",
  ]);
  expect(ids(searchMessages(store, "", { until: new Date(2000 * 1000) }))).toEqual(["M2", "M1"]);
  expect(
    ids(searchMessages(store, "", { since: new Date(2000 * 1000), until: new Date(3000 * 1000) })),
  ).toEqual(["M3", "M2"]);
});

test("T175 A1 store — chatJid still scopes an empty query", () => {
  const store = makeStore();
  seedAll(store);
  expect(ids(searchMessages(store, "", { chatJid: GROUP_B }))).toEqual(["M4", "M3"]);
});

test("T175 A1 store — filters combine with the FTS query", () => {
  const store = makeStore();
  seedAll(store);
  expect(ids(searchMessages(store, "pizza", { direction: "in" }))).toEqual(["M4", "M1"]);
  expect(ids(searchMessages(store, "pizza", { direction: "in", chatJid: GROUP_A }))).toEqual([
    "M1",
  ]);
  expect(
    ids(searchMessages(store, "pizza", { fromJid: BOB, since: new Date(3500 * 1000) })),
  ).toEqual(["M4"]);
});

test("T175 A1 store — LIKE fallback keeps escaping and honours filters", () => {
  const store = makeStore();
  seedAll(store);
  store.db.exec("DROP TABLE messages_fts");
  expect(ids(searchMessages(store, "100%_", {}))).toEqual(["M5"]);
  expect(ids(searchMessages(store, "%", {}))).toEqual(["M5"]);
  expect(ids(searchMessages(store, "pizza", { direction: "out" }))).toEqual(["M2"]);
  expect(ids(searchMessages(store, "pizza", { chatJid: GROUP_B, fromJid: BOB }))).toEqual(["M4"]);
});

test("T175 A1 store — pagination applies to filtered listings", () => {
  const store = makeStore();
  seedAll(store);
  expect(ids(searchMessages(store, "", { direction: "in", limit: 2, offset: 1 }))).toEqual([
    "M4",
    "M3",
  ]);
});

function stubHandle(): BridgeHandle {
  return {
    status: "connected",
    events: createEventBus(),
    close: async () => {},
    getLastQr: () => null,
    hasPairedAccount: () => true,
    pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
    resumePairing: () => {},
    connectionQuality: () => ({ reconnects: 0, lastDisconnectAt: null }),
    logout: async () => {},
    fetchHistory: async () => ({ requested: false, request_id: "" }),
    contactsWarm: () => true,
  } as unknown as BridgeHandle;
}

async function boot(): Promise<BridgeHttp> {
  const store = makeStore();
  seedAll(store);
  const bridge = await createHttpServer(stubHandle(), { token: "t175-token", store });
  cleanups.push(() => bridge.close());
  return bridge;
}

async function search(
  bridge: BridgeHttp,
  query: string,
): Promise<{ status: number; ids: string[]; code?: string }> {
  const res = await fetch(`http://127.0.0.1:${bridge.port}/api/search${query}`, {
    headers: { authorization: "Bearer t175-token" },
  });
  const body = (await res.json()) as {
    messages?: Array<{ id: string }>;
    error?: { code: string };
  };
  return { status: res.status, ids: ids(body.messages ?? []), code: body.error?.code };
}

test("T175 A1 http — /api/search without q lists everything (logs mode)", async () => {
  const bridge = await boot();
  expect(await search(bridge, "")).toEqual({
    status: 200,
    ids: ["M5", "M4", "M3", "M2", "M1"],
    code: undefined,
  });
});

test("T175 A1 http — each filter param in isolation", async () => {
  const bridge = await boot();
  expect((await search(bridge, "?direction=out")).ids).toEqual(["M2"]);
  expect((await search(bridge, "?direction=in")).ids).toEqual(["M5", "M4", "M3", "M1"]);
  expect((await search(bridge, `?from_jid=${encodeURIComponent(ALICE)}`)).ids).toEqual([
    "M5",
    "M1",
  ]);
  expect((await search(bridge, `?since=${4000 * 1000}`)).ids).toEqual(["M5", "M4"]);
  expect(
    (await search(bridge, `?until=${encodeURIComponent(new Date(1000 * 1000).toISOString())}`)).ids,
  ).toEqual(["M1"]);
  expect((await search(bridge, `?chat_jid=${encodeURIComponent(GROUP_B)}`)).ids).toEqual([
    "M4",
    "M3",
  ]);
});

test("T175 A1 http — filters combine with q and pagination", async () => {
  const bridge = await boot();
  const query =
    `?q=pizza&direction=in&from_jid=${encodeURIComponent(BOB)}` +
    `&since=${encodeURIComponent(new Date(3000 * 1000).toISOString())}&until=${5000 * 1000}`;
  expect((await search(bridge, query)).ids).toEqual(["M4"]);
  expect((await search(bridge, "?direction=in&limit=1&offset=1")).ids).toEqual(["M4"]);
});

test("T175 A1 http — invalid direction / dates are VALIDATION_ERROR", async () => {
  const bridge = await boot();
  for (const query of ["?direction=sideways", "?since=yesterday", "?until=not-a-date"]) {
    const result = await search(bridge, query);
    expect(result.status).toBe(400);
    expect(result.code).toBe("VALIDATION_ERROR");
  }
});
