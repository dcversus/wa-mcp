import { expect, test } from "vite-plus/test";
import {
  applyExchangeFailure,
  classifyExchangeFailure,
  shouldClearStaleToken,
} from "../src/state.ts";

test("T147 M1 — a manually entered token is never auto-wiped", () => {
  expect(
    shouldClearStaleToken({
      token: "manual",
      terminal: false,
      exchangeMinted: false,
      clearedForEpoch: -1,
      currentEpoch: 3,
    }),
  ).toBe(false);
});

test("T147 M1 — an exchanged token wipes once per epoch", () => {
  const base = { token: "stale", terminal: false, exchangeMinted: true };
  expect(shouldClearStaleToken({ ...base, clearedForEpoch: -1, currentEpoch: 0 })).toBe(true);
  expect(shouldClearStaleToken({ ...base, clearedForEpoch: 0, currentEpoch: 0 })).toBe(false);
  expect(shouldClearStaleToken({ ...base, clearedForEpoch: 0, currentEpoch: 1 })).toBe(true);
});

test("T147 M1 — terminal and empty tokens still never wipe", () => {
  expect(
    shouldClearStaleToken({
      token: "x",
      terminal: true,
      exchangeMinted: true,
      clearedForEpoch: -1,
      currentEpoch: 0,
    }),
  ).toBe(false);
  expect(
    shouldClearStaleToken({
      token: "",
      terminal: false,
      exchangeMinted: true,
      clearedForEpoch: -1,
      currentEpoch: 0,
    }),
  ).toBe(false);
});

test("T147 minor1 — a 401 on the very first attempt is a startup race, not terminal", () => {
  expect(classifyExchangeFailure({ status: 401 }, { firstAttempt: true })).toEqual({
    terminal: false,
    retryAfterMs: null,
  });
  expect(classifyExchangeFailure({ status: 401 }, { firstAttempt: false })).toEqual({
    terminal: true,
    retryAfterMs: null,
  });
  expect(classifyExchangeFailure({ status: 403 }, { firstAttempt: true })).toEqual({
    terminal: true,
    retryAfterMs: null,
  });
});

test("T147 M2 — the latch survives a failed attempt", () => {
  const result = applyExchangeFailure({ failure: { status: 502 }, attempt: 1, now: 1_000 });
  expect(result.latched).toBe(true);
  expect(result.terminal).toBe(false);
  expect(result.retryNotBefore).toBe(0);
});

test("T147 M2 — a 429 failure books the retry window and keeps the latch", () => {
  expect(
    applyExchangeFailure({
      failure: { status: 429, retryAfterMs: 30_000 },
      attempt: 2,
      now: 1_000,
    }),
  ).toEqual({ terminal: false, retryNotBefore: 31_000, latched: true });
});
