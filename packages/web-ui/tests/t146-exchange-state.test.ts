import { expect, test } from "vite-plus/test";
import { classifyExchangeFailure, shouldClearStaleToken, shouldExchange } from "../src/state.ts";

test("T106 — a latched exchange retries only once loggedIn flips true", () => {
  // latched while unpaired: no retry (the old code retried every render)
  expect(
    shouldExchange({
      loggedIn: false,
      token: "",
      latched: true,
      terminal: false,
      retryNotBefore: 0,
      now: 5_000,
    }),
  ).toBe(false);
  // the sync AFTER loggedIn flips true: retry allowed
  expect(
    shouldExchange({
      loggedIn: true,
      token: "",
      latched: true,
      terminal: false,
      retryNotBefore: 0,
      now: 5_000,
    }),
  ).toBe(true);
});

test("T106 — an exchange 401 is terminal for this page load", () => {
  expect(classifyExchangeFailure({ status: 401, retryAfterMs: null })).toEqual({
    terminal: true,
    retryAfterMs: null,
  });
});

test("T147 — a stale stored token wipes once per epoch, only if exchange-minted", () => {
  // armed (no wipe yet this epoch): clear once
  expect(
    shouldClearStaleToken({
      token: "stale",
      terminal: false,
      exchangeMinted: true,
      clearedForEpoch: 0,
      currentEpoch: 1,
    }),
  ).toBe(true);
  // the wipe consumed the epoch: keep
  expect(
    shouldClearStaleToken({
      token: "fresh",
      terminal: false,
      exchangeMinted: true,
      clearedForEpoch: 1,
      currentEpoch: 1,
    }),
  ).toBe(false);
  // terminal 403: the inline token form is the path, never wipe
  expect(
    shouldClearStaleToken({
      token: "x",
      terminal: true,
      exchangeMinted: true,
      clearedForEpoch: 0,
      currentEpoch: 1,
    }),
  ).toBe(false);
  // no stored token: nothing to clear
  expect(
    shouldClearStaleToken({
      token: "",
      terminal: false,
      exchangeMinted: true,
      clearedForEpoch: 0,
      currentEpoch: 1,
    }),
  ).toBe(false);
});
