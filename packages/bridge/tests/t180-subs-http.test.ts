import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import type { BaileysEventMap } from "baileys";
import { openStore, type Store } from "../src/store/schema.ts";
import {
  createSubscriptionConfig,
  getSubscriptionConfig,
  listSubscriptionConfigs,
  migrateV1Subscriptions,
} from "../src/store/subscription-configs.ts";
import { createSubscription, listSubscriptions } from "../src/subscriptions.ts";
import { createEventBus } from "../src/events.ts";
import { createHttpServer, type BridgeHttp } from "../src/http.ts";
import type { BridgeHandle } from "../src/lifecycle.ts";

const GROUP = "120363428874442773@g.us";
const DM = "358401112222@s.whatsapp.net";
const ME_LID = "55600000009854@lid";
const TOKEN = "t180-token";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) {
    await fn();
  }
});

function makeDir(): { dataDir: string; store: Store } {
  const dataDir = mkdtempSync(join(tmpdir(), "t180-"));
  const store = openStore(dataDir);
  cleanups.push(() => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  });
  return { dataDir, store };
}

function stubHandle(events: ReturnType<typeof createEventBus>): BridgeHandle {
  return {
    status: "connected",
    events,
    close: async () => {},
    getLastQr: () => null,
    hasPairedAccount: () => true,
    pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
    resumePairing: () => {},
    connectionQuality: () => ({ reconnects: 0, lastDisconnectAt: null }),
    logout: async () => {},
    fetchHistory: async () => ({ requested: false, request_id: "" }),
    contactsWarm: () => true,
    socket: {
      user: { id: "358497773518:12@s.whatsapp.net", lid: "55600000009854:12@lid" },
      signalRepository: { lidMapping: { getPNForLID: async () => null } },
    },
  } as unknown as BridgeHandle;
}

async function boot(
  dataDir: string,
  store: Store,
): Promise<{ bridge: BridgeHttp; events: ReturnType<typeof createEventBus> }> {
  const events = createEventBus();
  const bridge = await createHttpServer(stubHandle(events), {
    token: TOKEN,
    store,
    subscriptionsDir: dataDir,
  });
  cleanups.push(() => bridge.close());
  return { bridge, events };
}

function call(bridge: BridgeHttp, path: string, method = "GET", body?: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${bridge.port}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function upsert(
  remoteJid: string,
  content: Record<string, unknown>,
): { type: "messages.upsert"; payload: BaileysEventMap["messages.upsert"] } {
  return {
    type: "messages.upsert",
    payload: {
      type: "notify",
      messages: [
        {
          key: { remoteJid, fromMe: false, id: "3EB180", participant: DM },
          message: content,
          messageTimestamp: Math.floor(Date.now() / 1000),
        },
      ],
    } as BaileysEventMap["messages.upsert"],
  };
}

function lines(path: string): Array<Record<string, unknown>> {
  try {
    return readFileSync(path, "utf8")
      .trim()
      .split("\n")
      .filter((line) => line.length > 0)
      .map((line) => JSON.parse(line) as Record<string, unknown>);
  } catch {
    return [];
  }
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 50));

test("T180 E — v1 subscriptions migrate into subs2 once, keeping their ids", () => {
  const { dataDir, store } = makeDir();
  const chat = createSubscription(store, dataDir, {
    chatJid: GROUP,
    fromJid: null,
    kinds: ["message"],
    includeMedia: false,
    allChats: false,
  });
  const all = createSubscription(store, dataDir, {
    chatJid: null,
    fromJid: null,
    kinds: ["message"],
    includeMedia: true,
    allChats: true,
  });
  expect(migrateV1Subscriptions(store)).toBe(2);
  expect(migrateV1Subscriptions(store)).toBe(0);
  const configs = listSubscriptionConfigs(store);
  expect(configs).toHaveLength(2);
  expect(getSubscriptionConfig(store, chat.id)).toMatchObject({
    name: `Imported ${chat.id.slice(0, 6)}`,
    chats: [GROUP],
    filter: {},
    delivery: { mode: "inbox" },
    enabled: true,
  });
  expect(getSubscriptionConfig(store, all.id)).toMatchObject({ chats: ["*"] });
});

test("T180 E — boot migrates; deleting the subs2 config also retires the v1 row", async () => {
  const { dataDir, store } = makeDir();
  const v1 = createSubscription(store, dataDir, {
    chatJid: GROUP,
    fromJid: null,
    kinds: ["message"],
    includeMedia: false,
    allChats: false,
  });
  const { bridge } = await boot(dataDir, store);
  const listed = (await (await call(bridge, "/api/subs2")).json()) as {
    subscriptions: Array<{ id: string; inboxPath: string }>;
  };
  expect(listed.subscriptions.map((sub) => sub.id)).toEqual([v1.id]);
  expect(listed.subscriptions[0]?.inboxPath).toBe(join(dataDir, "subs", v1.id, "inbox.jsonl"));
  expect((await call(bridge, `/api/subs2/${v1.id}`, "DELETE")).status).toBe(200);
  expect(listSubscriptions(store)).toEqual([]);
  expect(migrateV1Subscriptions(store)).toBe(0);
});

test("T180 E — v1 POST is 410 Gone with a pointer to /api/subs2; v1 GET still works", async () => {
  const { dataDir, store } = makeDir();
  const { bridge } = await boot(dataDir, store);
  const res = await call(bridge, "/api/subscriptions", "POST", { chat_jid: GROUP });
  expect(res.status).toBe(410);
  expect(await res.json()).toMatchObject({
    error: { code: "GONE", message: expect.stringContaining("/api/subs2") },
  });
  expect((await call(bridge, "/api/subscriptions")).status).toBe(200);
});

test("T180 B wired — a bus message reaches the subs2 inbox with prompt; PATCH disable stops it", async () => {
  const { dataDir, store } = makeDir();
  const { bridge, events } = await boot(dataDir, store);
  const created = (await (
    await call(bridge, "/api/subs2", "POST", {
      name: "Team",
      chats: [GROUP],
      filter: { like: "%invoice%" },
      prompt: "Triage",
      delivery: { mode: "inbox" },
    })
  ).json()) as { id: string; inboxPath: string };
  expect(created.inboxPath).toBe(join(dataDir, "subs", created.id, "inbox.jsonl"));
  events.emit(upsert(GROUP, { conversation: "lunch?" }));
  events.emit(upsert(GROUP, { conversation: "INVOICE 42" }));
  await settle();
  expect(lines(created.inboxPath)).toEqual([
    expect.objectContaining({
      kind: "message",
      text: "INVOICE 42",
      prompt: "Triage",
      subId: created.id,
    }),
  ]);
  const patched = await call(bridge, `/api/subs2/${created.id}`, "PATCH", { enabled: false });
  expect(patched.status).toBe(200);
  events.emit(upsert(GROUP, { conversation: "invoice again" }));
  await settle();
  expect(lines(created.inboxPath)).toHaveLength(1);
});

test("T180 B wired — mentionOnly matches when our LID is mentioned (device suffix stripped)", async () => {
  const { dataDir, store } = makeDir();
  const sub = createSubscriptionConfig(store, {
    name: "Mentions",
    chats: [GROUP],
    filter: { mentionOnly: true },
    delivery: { mode: "inbox" },
    enabled: true,
  });
  const { events } = await boot(dataDir, store);
  events.emit(upsert(GROUP, { conversation: "no mention" }));
  events.emit(
    upsert(GROUP, {
      extendedTextMessage: { text: "@bot hi", contextInfo: { mentionedJid: [ME_LID] } },
    }),
  );
  await settle();
  expect(lines(join(dataDir, "subs", sub.id, "inbox.jsonl"))).toEqual([
    expect.objectContaining({ text: "@bot hi" }),
  ]);
});

test("T180 B test endpoint — POST /api/subs2/:id/test delivers a kind:test event via the config's mode", async () => {
  const { dataDir, store } = makeDir();
  const { bridge } = await boot(dataDir, store);
  const sub = createSubscriptionConfig(store, {
    name: "Session",
    chats: [GROUP],
    filter: {},
    prompt: "p",
    delivery: { mode: "session", session: "claude:abc" },
    enabled: true,
  });
  const res = await call(bridge, `/api/subs2/${sub.id}/test`, "POST");
  expect(res.status).toBe(200);
  expect(await res.json()).toMatchObject({ ok: true, mode: "session" });
  expect(lines(join(dataDir, "subs", sub.id, "session.jsonl"))).toEqual([
    expect.objectContaining({ kind: "test", subId: sub.id, session: "claude:abc", prompt: "p" }),
  ]);
  expect((await call(bridge, `/api/subs2/${sub.id}/test`, "POST")).status).toBe(429);
  expect((await call(bridge, "/api/subs2/deadbeef0000/test", "POST")).status).toBe(404);
});

test("T180 B health — /health counts subs2 configs", async () => {
  const { dataDir, store } = makeDir();
  createSubscriptionConfig(store, {
    name: "A",
    chats: ["*"],
    filter: {},
    delivery: { mode: "inbox" },
    enabled: true,
  });
  const { bridge } = await boot(dataDir, store);
  const health = (await (await call(bridge, "/health")).json()) as {
    subscriptions: { count: number };
  };
  expect(health.subscriptions.count).toBe(1);
});
