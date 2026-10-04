import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { openStore, type Store } from "../../src/store/schema.ts";
import { SendGuard } from "../../src/send/safety.ts";
import { createHttpServer } from "../../src/http.ts";
import type { BridgeHttp } from "../../src/http.ts";
import type { WASocket } from "baileys";
import type { BridgeHandle, BridgeStatus } from "../../src/lifecycle.ts";
import { createEventBus } from "../../src/events.ts";

const created: BridgeHttp[] = [];

function url(bridge: BridgeHttp, path: string): string {
  return `http://127.0.0.1:${bridge.port}${path}`;
}

const authHeader = { authorization: "Bearer test-token" };

function stubHandle(status: BridgeStatus = "connected", socket?: WASocket) {
  return {
    status,
    events: createEventBus(),
    close: async () => {},
    getLastQr: () => null,
    socket,
  } as unknown as BridgeHandle;
}

const stores: Store[] = [];

function freshStore(): Store {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-guard-")));
  stores.push(store);
  return store;
}

afterEach(() => {
  for (const store of stores.splice(0)) {
    store.close();
  }
});

test("paces rapid sends with a configurable minimum interval", () => {
  const guard = new SendGuard(freshStore(), { minIntervalMs: 1000 });
  expect(guard.check(0)).toEqual({ ok: true });
  // T94-E H2: check() reserves — record() is gone
  guard.check(0);
  expect(guard.check(100)).toEqual({ ok: false, code: "RATE_LIMITED", retryAfterMs: 900 });
  expect(guard.check(999)).toEqual({ ok: false, code: "RATE_LIMITED", retryAfterMs: 1 });
  expect(guard.check(1000)).toEqual({ ok: true });
});

test("six sends at 500ms spacing with a 1s interval pass five and limit one", () => {
  const guard = new SendGuard(freshStore(), { minIntervalMs: 1000 });
  const verdicts = [0, 1000, 2000, 3000, 4000, 4500].map((now) => guard.check(now));
  expect(verdicts.filter((verdict) => verdict.ok)).toHaveLength(5);
  const limited = verdicts[5];
  expect(limited).toEqual({ ok: false, code: "RATE_LIMITED", retryAfterMs: 500 });
});

test("daily cap blocks the send after the limit and persists across instances", () => {
  const store = freshStore();
  const first = new SendGuard(store, { dailyCap: 2, minIntervalMs: 0 });
  expect(first.check(1000)).toEqual({ ok: true });
  expect(first.check(2000)).toEqual({ ok: true });
  expect(first.check(3000)).toEqual({ ok: false, code: "DAILY_CAP_EXCEEDED", cap: 2 });
  const second = new SendGuard(store, { dailyCap: 2, minIntervalMs: 0 });
  expect(second.check(4000)).toEqual({ ok: false, code: "DAILY_CAP_EXCEEDED", cap: 2 });
});

test("the daily counter is keyed by UTC date", () => {
  const store = freshStore();
  const guard = new SendGuard(store, { dailyCap: 1, minIntervalMs: 0 });
  const dayOne = Date.UTC(2026, 9, 1, 12, 0, 0);
  const dayTwo = Date.UTC(2026, 9, 2, 12, 0, 0);
  expect(guard.check(dayOne)).toEqual({ ok: true });
  expect(guard.check(dayOne + 1)).toEqual({ ok: false, code: "DAILY_CAP_EXCEEDED", cap: 1 });
  expect(guard.check(dayTwo)).toEqual({ ok: true });
});

test("defaults are a 1s interval and a 200-per-day cap", { timeout: 30_000 }, () => {
  const store = freshStore();
  const guard = new SendGuard(store);
  for (let index = 0; index < 200; index += 1) {
    const now = index * 1000;
    expect(guard.check(now)).toEqual({ ok: true });
  }
  expect(guard.check(200 * 1000)).toEqual({ ok: false, code: "DAILY_CAP_EXCEEDED", cap: 200 });
});

test("T94-E H2 — check() reserves atomically; release() gives the budget back", () => {
  const store = freshStore();
  const guard = new SendGuard(store, { minIntervalMs: 0, dailyCap: 1 });
  const now = Date.now();
  // RED today: check() is a pure read — two parallel callers both see ok
  expect(guard.check(now)).toMatchObject({ ok: true });
  expect(guard.check(now)).toMatchObject({ ok: false, code: "DAILY_CAP_EXCEEDED" });
  // a failed send releases the reservation
  guard.release(now);
  expect(guard.check(now)).toMatchObject({ ok: true });
});

test("T94-E H2 — two parallel sends against a budget of 1: exactly one lands", async () => {
  const store = freshStore();
  const sendMessage = vi.fn(async () => ({ key: { id: "RACE1", fromMe: true } }));
  const sock = { sendMessage } as unknown as WASocket;
  const bridge = await createHttpServer(stubHandle("connected", sock), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 1 }),
  });
  created.push(bridge);
  const body = JSON.stringify({ chat_jid: "358497773518@s.whatsapp.net", text: "race" });
  const fire = () =>
    fetch(url(bridge, "/api/send"), {
      method: "POST",
      headers: { ...authHeader, "content-type": "application/json" },
      body,
    });
  // RED today: both pass the check-only gate and both hit WhatsApp
  const [a, b] = await Promise.all([fire(), fire()]);
  const codes = [a.status, b.status].sort();
  expect(codes).toEqual([200, 429]);
  expect(sendMessage).toHaveBeenCalledTimes(1);
});
