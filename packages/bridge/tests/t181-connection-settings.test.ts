import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { DEFAULT_CONNECTION_SETTINGS } from "@wa-mcp/shared";
import { openStore, type Store } from "../src/store/schema.ts";
import {
  countMessagesSince,
  getConnectionSettings,
  getConnectionSettingsRecord,
  saveConnectionSettings,
} from "../src/store/connection-settings.ts";
import { createEventBus } from "../src/events.ts";
import { createHttpServer, type BridgeHttp } from "../src/http.ts";
import type { BridgeHandle } from "../src/lifecycle.ts";

const TOKEN = "t181-token";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) {
    await fn();
  }
});

function makeStore(): Store {
  const dir = mkdtempSync(join(tmpdir(), "t181-"));
  const store = openStore(dir);
  cleanups.push(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

function stubHandle(): BridgeHandle {
  return {
    status: "connected",
    events: createEventBus(),
    close: async () => {},
    getLastQr: () => null,
    hasPairedAccount: () => true,
    pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
    resumePairing: () => {},
    connectionQuality: () => ({ reconnects: 2, lastDisconnectAt: 1_700_000_000_000 }),
    logout: async () => {},
    fetchHistory: async () => ({ requested: false, request_id: "" }),
    contactsWarm: () => true,
    socket: { user: { id: "358497773518:12@s.whatsapp.net" } },
  } as unknown as BridgeHandle;
}

async function boot(store?: Store): Promise<BridgeHttp> {
  const bridge = await createHttpServer(stubHandle(), { token: TOKEN, store });
  cleanups.push(() => bridge.close());
  return bridge;
}

function call(bridge: BridgeHttp, path: string, method = "GET", body?: unknown): Promise<Response> {
  return fetch(`http://127.0.0.1:${bridge.port}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
}

function insertMessage(store: Store, id: string, timestamp: string, fromMe: boolean): void {
  store.db
    .prepare(
      "INSERT INTO messages (id, chat_jid, timestamp, content, is_from_me) VALUES (?, ?, ?, ?, ?)",
    )
    .run(id, "358401112222@s.whatsapp.net", timestamp, "x", fromMe ? 1 : 0);
}

test("T181 A2 — store: defaults on empty, save round-trips, corrupt rows fall back to defaults", () => {
  const store = makeStore();
  expect(getConnectionSettings(store)).toEqual(DEFAULT_CONNECTION_SETTINGS);
  expect(getConnectionSettingsRecord(store)).toEqual({
    connection: "default",
    settings: DEFAULT_CONNECTION_SETTINGS,
    updatedAt: null,
  });
  const next = {
    ...DEFAULT_CONNECTION_SETTINGS,
    humanisation: { ...DEFAULT_CONNECTION_SETTINGS.humanisation, enabled: true },
  };
  expect(saveConnectionSettings(store, next, "default", "2026-10-08T10:00:00.000Z")).toEqual({
    connection: "default",
    settings: next,
    updatedAt: "2026-10-08T10:00:00.000Z",
  });
  expect(getConnectionSettings(store)).toEqual(next);
  expect(getConnectionSettings(store, "other")).toEqual(DEFAULT_CONNECTION_SETTINGS);
  store.db
    .prepare("UPDATE connection_settings SET settings = ? WHERE id = 'default'")
    .run("{not json");
  expect(getConnectionSettings(store)).toEqual(DEFAULT_CONNECTION_SETTINGS);
  store.db
    .prepare("UPDATE connection_settings SET settings = ? WHERE id = 'default'")
    .run(JSON.stringify({ sendLimits: { perMinute: -5 } }));
  expect(getConnectionSettings(store)).toEqual(DEFAULT_CONNECTION_SETTINGS);
});

test("T181 A2 — store: sent/received counts since a timestamp", () => {
  const store = makeStore();
  insertMessage(store, "a", "2026-10-07T23:59:59.000Z", true);
  insertMessage(store, "b", "2026-10-08T00:00:00.000Z", true);
  insertMessage(store, "c", "2026-10-08T09:00:00.000Z", false);
  insertMessage(store, "d", "2026-10-08T10:00:00.000Z", false);
  expect(countMessagesSince(store, "2026-10-08T00:00:00.000Z")).toEqual({ sent: 1, received: 2 });
});

test("T181 A3 — GET /api/connection-settings returns defaults on an empty store", async () => {
  const bridge = await boot(makeStore());
  const res = await call(bridge, "/api/connection-settings");
  expect(res.status).toBe(200);
  expect(await res.json()).toEqual({
    connection: "default",
    settings: DEFAULT_CONNECTION_SETTINGS,
    defaults: DEFAULT_CONNECTION_SETTINGS,
    updatedAt: null,
  });
});

test("T181 A3 — PUT merges a partial body, persists, and GET round-trips it", async () => {
  const store = makeStore();
  const bridge = await boot(store);
  const put = await call(bridge, "/api/connection-settings", "PUT", {
    humanisation: { enabled: true, minDelayMs: 500 },
    sendLimits: { enabled: true, perDay: 300, perChatPerDay: 25 },
  });
  expect(put.status).toBe(200);
  const expected = {
    humanisation: { ...DEFAULT_CONNECTION_SETTINGS.humanisation, enabled: true, minDelayMs: 500 },
    sendLimits: {
      ...DEFAULT_CONNECTION_SETTINGS.sendLimits,
      enabled: true,
      perDay: 300,
      perChatPerDay: 25,
    },
  };
  const putBody = (await put.json()) as { settings: unknown; updatedAt: string };
  expect(putBody.settings).toEqual(expected);
  expect(typeof putBody.updatedAt).toBe("string");
  const second = await call(bridge, "/api/connection-settings", "PUT", {
    humanisation: { typingStatus: false },
  });
  expect(((await second.json()) as { settings: unknown }).settings).toEqual({
    ...expected,
    humanisation: { ...expected.humanisation, typingStatus: false },
  });
  const get = (await (await call(bridge, "/api/connection-settings")).json()) as {
    settings: unknown;
  };
  expect(get.settings).toEqual({
    ...expected,
    humanisation: { ...expected.humanisation, typingStatus: false },
  });
  expect(getConnectionSettings(store).sendLimits.perChatPerDay).toBe(25);
});

test("T181 A3 — PUT validation errors are 400 and nothing is stored", async () => {
  const store = makeStore();
  const bridge = await boot(store);
  const cases: Array<[unknown, string]> = [
    [{ humanisation: { minDelayMs: 9000, maxDelayMs: 100 } }, "must not exceed maxDelayMs"],
    [{ humanisation: { minDelayMs: -1 } }, "humanisation.minDelayMs must be a whole number"],
    [
      { sendLimits: { perMinute: 5000 } },
      "sendLimits.perMinute must be a whole number from 1 to 1000",
    ],
    [{ sendLimits: { perHour: 0 } }, "sendLimits.perHour must be a whole number"],
    [[1, 2], "settings must be an object"],
  ];
  for (const [body, message] of cases) {
    const res = await call(bridge, "/api/connection-settings", "PUT", body);
    expect(res.status).toBe(400);
    const payload = (await res.json()) as { error: { code: string; message: string } };
    expect(payload.error.code).toBe("VALIDATION_ERROR");
    expect(payload.error.message).toContain(message);
  }
  const broken = await fetch(`http://127.0.0.1:${bridge.port}/api/connection-settings`, {
    method: "PUT",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: "{",
  });
  expect(broken.status).toBe(400);
  expect(getConnectionSettingsRecord(store).updatedAt).toBeNull();
});

test("T181 A3 — other methods 405, no store 501, auth required", async () => {
  const bridge = await boot(makeStore());
  expect((await call(bridge, "/api/connection-settings", "DELETE")).status).toBe(405);
  const anon = await fetch(`http://127.0.0.1:${bridge.port}/api/connection-settings`);
  expect(anon.status).toBe(401);
  const bare = await boot();
  expect((await call(bare, "/api/connection-settings")).status).toBe(501);
  expect((await call(bare, "/api/connection-stats")).status).toBe(501);
});

test("T181 D — GET /api/connection-stats: uptime, reconnects, sent/received today", async () => {
  const store = makeStore();
  const today = new Date().toISOString().slice(0, 10);
  insertMessage(store, "old", "2000-01-01T00:00:00.000Z", true);
  insertMessage(store, "s1", `${today}T00:00:01.000Z`, true);
  insertMessage(store, "r1", `${today}T00:00:02.000Z`, false);
  insertMessage(store, "r2", `${today}T00:00:03.000Z`, false);
  const bridge = await boot(store);
  const res = await call(bridge, "/api/connection-stats");
  expect(res.status).toBe(200);
  const body = (await res.json()) as Record<string, unknown>;
  expect(body).toMatchObject({
    connection: "default",
    status: "connected",
    reconnects: 2,
    lastDisconnectAt: 1_700_000_000_000,
    since: `${today}T00:00:00.000Z`,
    sentToday: 1,
    receivedToday: 2,
  });
  expect(typeof body.uptime).toBe("number");
});
