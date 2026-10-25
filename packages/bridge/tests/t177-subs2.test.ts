import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { openStore, type Store } from "../src/store/schema.ts";
import {
  createSubscriptionConfig,
  deleteSubscriptionConfig,
  getSubscriptionConfig,
  listSubscriptionConfigs,
  updateSubscriptionConfig,
} from "../src/store/subscription-configs.ts";
import { createEventBus } from "../src/events.ts";
import { createHttpServer, type BridgeHttp } from "../src/http.ts";
import type { BridgeHandle } from "../src/lifecycle.ts";

const GROUP = "120363428874442773@g.us";
const DM = "358401112222@s.whatsapp.net";
const TOKEN = "t177-token";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) {
    await fn();
  }
});

function makeStore(): Store {
  const dir = mkdtempSync(join(tmpdir(), "t177-"));
  const store = openStore(dir);
  cleanups.push(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

const SPAWN = {
  name: "Mentions",
  chats: [GROUP, DM],
  filter: { like: "%invoice%", mentionOnly: true },
  prompt: "Triage this",
  delivery: {
    mode: "spawn" as const,
    agent: { command: "claude", args: ["-p"], env: { ANTHROPIC_MODEL: "opus" } },
  },
  enabled: true,
};

test("T177 B2 store — create/get/list/update/delete round-trip with JSON columns", () => {
  const store = makeStore();
  const created = createSubscriptionConfig(store, SPAWN);
  expect(created).toMatchObject(SPAWN);
  expect(created.id).toMatch(/^[a-f0-9]{12}$/);
  expect(Number.isNaN(Date.parse(created.created))).toBe(false);
  expect(getSubscriptionConfig(store, created.id)).toEqual(created);
  const second = createSubscriptionConfig(store, {
    name: "Inbox",
    chats: [DM],
    filter: {},
    delivery: { mode: "inbox" },
    enabled: true,
  });
  expect(listSubscriptionConfigs(store).map((config) => config.id)).toEqual([
    created.id,
    second.id,
  ]);
  const updated = updateSubscriptionConfig(store, created.id, {
    ...SPAWN,
    name: "Renamed",
    delivery: { mode: "session", session: "abc" },
    enabled: false,
  });
  expect(updated).toEqual({
    ...SPAWN,
    id: created.id,
    created: created.created,
    name: "Renamed",
    delivery: { mode: "session", session: "abc" },
    enabled: false,
  });
  expect(getSubscriptionConfig(store, created.id)).toEqual(updated);
  expect(updateSubscriptionConfig(store, "nope", SPAWN)).toBeNull();
  expect(deleteSubscriptionConfig(store, created.id)).toBe(true);
  expect(deleteSubscriptionConfig(store, created.id)).toBe(false);
  expect(getSubscriptionConfig(store, created.id)).toBeNull();
});

test("T177 B2 store — a corrupted JSON column reads back as safe defaults, not a throw", () => {
  const store = makeStore();
  const created = createSubscriptionConfig(store, SPAWN);
  store.db
    .prepare(
      "UPDATE subscription_configs SET chats = 'not json', filter = '[', delivery = '{}' WHERE id = ?",
    )
    .run(created.id);
  expect(getSubscriptionConfig(store, created.id)).toMatchObject({
    chats: [],
    filter: {},
    delivery: { mode: "inbox" },
  });
});

test("T177 B2 store — v1 subscriptions table is untouched by the new model", () => {
  const store = makeStore();
  createSubscriptionConfig(store, SPAWN);
  const count = store.db.prepare("SELECT COUNT(*) AS n FROM subscriptions").get() as { n: number };
  expect(count.n).toBe(0);
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

async function boot(withStore = true): Promise<BridgeHttp> {
  const bridge = await createHttpServer(stubHandle(), {
    token: TOKEN,
    store: withStore ? makeStore() : undefined,
  });
  cleanups.push(() => bridge.close());
  return bridge;
}

async function call(
  bridge: BridgeHttp,
  method: string,
  path: string,
  body?: unknown,
  token = TOKEN,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${bridge.port}${path}`, {
    method,
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

test("T177 B3 http — full CRUD round-trip over /api/subs2", async () => {
  const bridge = await boot();
  const empty = await call(bridge, "GET", "/api/subs2");
  expect(empty).toEqual({ status: 200, body: { subscriptions: [] } });

  const created = await call(bridge, "POST", "/api/subs2", SPAWN);
  expect(created.status).toBe(201);
  expect(created.body).toMatchObject(SPAWN);
  const id = created.body.id as string;

  expect(await call(bridge, "GET", `/api/subs2/${id}`)).toEqual({
    status: 200,
    body: created.body,
  });
  const listed = await call(bridge, "GET", "/api/subs2");
  expect(listed.body.subscriptions).toEqual([created.body]);

  const patched = await call(bridge, "PATCH", `/api/subs2/${id}`, {
    enabled: false,
    delivery: { mode: "inbox" },
    filter: { mentionOnly: false },
  });
  expect(patched.status).toBe(200);
  expect(patched.body).toEqual({
    ...created.body,
    enabled: false,
    delivery: { mode: "inbox" },
    filter: { mentionOnly: false },
  });

  const removed = await call(bridge, "DELETE", `/api/subs2/${id}`);
  expect(removed).toEqual({ status: 200, body: { ok: true, removed: id } });
  expect((await call(bridge, "GET", `/api/subs2/${id}`)).status).toBe(404);
});

test("T177 B3 http — PATCH ignores id/created and re-validates the merged config", async () => {
  const bridge = await boot();
  const created = await call(bridge, "POST", "/api/subs2", SPAWN);
  const id = created.body.id as string;
  const patched = await call(bridge, "PATCH", `/api/subs2/${id}`, {
    id: "hijack",
    created: "1970-01-01T00:00:00.000Z",
    name: "New name",
  });
  expect(patched.body).toMatchObject({ id, created: created.body.created, name: "New name" });
  const bad = await call(bridge, "PATCH", `/api/subs2/${id}`, { chats: [] });
  expect(bad.status).toBe(400);
  expect(bad.body).toEqual({
    error: { code: "VALIDATION_ERROR", message: "chats must list at least one chat" },
  });
  expect((await call(bridge, "GET", `/api/subs2/${id}`)).body.chats).toEqual(SPAWN.chats);
});

test("T177 B3 http — validation errors: empty chats, bad mode, bad jid, bad JSON", async () => {
  const bridge = await boot();
  const cases: Array<[unknown, string]> = [
    [{ ...SPAWN, chats: [] }, "chats must list at least one chat"],
    [
      { ...SPAWN, delivery: { mode: "carrier-pigeon" } },
      "delivery.mode must be one of inbox, session, spawn, channel",
    ],
    [{ ...SPAWN, chats: [GROUP, "bogus"] }, "chats[1] is not a WhatsApp chat id: bogus"],
    ["{not json", "body must be valid JSON"],
  ];
  for (const [body, message] of cases) {
    const result = await call(bridge, "POST", "/api/subs2", body);
    expect(result, message).toEqual({
      status: 400,
      body: { error: { code: "VALIDATION_ERROR", message } },
    });
  }
  expect((await call(bridge, "GET", "/api/subs2")).body.subscriptions).toEqual([]);
});

test("T177 B3 http — unknown ids are 404 for GET/PATCH/DELETE", async () => {
  const bridge = await boot();
  for (const method of ["GET", "PATCH", "DELETE"]) {
    const result = await call(
      bridge,
      method,
      "/api/subs2/abcdef123456",
      method === "PATCH" ? {} : undefined,
    );
    expect(result.status, method).toBe(404);
    expect((result.body.error as { code: string }).code).toBe("NOT_FOUND");
  }
});

test("T177 B3 http — requires the bearer token; 501 without a store", async () => {
  const bridge = await boot();
  expect((await call(bridge, "GET", "/api/subs2", undefined, "wrong")).status).toBe(401);
  const bare = await boot(false);
  expect((await call(bare, "GET", "/api/subs2")).status).toBe(501);
});
