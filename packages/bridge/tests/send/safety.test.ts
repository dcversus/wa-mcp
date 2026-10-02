import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { openStore, type Store } from "../../src/store/schema.ts";
import { SendGuard } from "../../src/send/safety.ts";

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
  guard.record(0);
  expect(guard.check(100)).toEqual({ ok: false, code: "RATE_LIMITED", retryAfterMs: 900 });
  expect(guard.check(999)).toEqual({ ok: false, code: "RATE_LIMITED", retryAfterMs: 1 });
  expect(guard.check(1000)).toEqual({ ok: true });
});

test("six sends at 500ms spacing with a 1s interval pass five and limit one", () => {
  const guard = new SendGuard(freshStore(), { minIntervalMs: 1000 });
  const verdicts = [0, 1000, 2000, 3000, 4000, 4500].map((now) => {
    const verdict = guard.check(now);
    if (verdict.ok) {
      guard.record(now);
    }
    return verdict;
  });
  expect(verdicts.filter((verdict) => verdict.ok)).toHaveLength(5);
  const limited = verdicts[5];
  expect(limited).toEqual({ ok: false, code: "RATE_LIMITED", retryAfterMs: 500 });
});

test("daily cap blocks the send after the limit and persists across instances", () => {
  const store = freshStore();
  const first = new SendGuard(store, { dailyCap: 2, minIntervalMs: 0 });
  expect(first.check(1000)).toEqual({ ok: true });
  first.record(1000);
  expect(first.check(2000)).toEqual({ ok: true });
  first.record(2000);
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
  guard.record(dayOne);
  expect(guard.check(dayOne + 1)).toEqual({ ok: false, code: "DAILY_CAP_EXCEEDED", cap: 1 });
  expect(guard.check(dayTwo)).toEqual({ ok: true });
});

test("defaults are a 1s interval and a 200-per-day cap", { timeout: 30_000 }, () => {
  const store = freshStore();
  const guard = new SendGuard(store);
  for (let index = 0; index < 200; index += 1) {
    const now = index * 1000;
    expect(guard.check(now)).toEqual({ ok: true });
    guard.record(now);
  }
  expect(guard.check(200 * 1000)).toEqual({ ok: false, code: "DAILY_CAP_EXCEEDED", cap: 200 });
});
