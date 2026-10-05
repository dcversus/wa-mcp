import { expect, test } from "vite-plus/test";
import { classifyExchangeFailure, shouldExchange } from "../src/state.ts";

test("403 failures are terminal — latch for the rest of the page load", () => {
  const verdict = classifyExchangeFailure({ status: 403 });
  expect(verdict.terminal).toBe(true);
  expect(verdict.retryAfterMs).toBeNull();
});

test("429 failures carry retryAfter", () => {
  const verdict = classifyExchangeFailure({ status: 429, retryAfterMs: 30_000 });
  expect(verdict.terminal).toBe(false);
  expect(verdict.retryAfterMs).toBe(30_000);
});

test("network failures are retryable without delay", () => {
  const verdict = classifyExchangeFailure(null);
  expect(verdict.terminal).toBe(false);
  expect(verdict.retryAfterMs).toBeNull();
});

test("shouldExchange: terminal latch blocks even when loggedIn", () => {
  expect(
    shouldExchange({ loggedIn: true, token: "", terminal: true, retryNotBefore: 0, now: 1000 }),
  ).toBe(false);
});

test("shouldExchange: retry-after window blocks until it passes", () => {
  expect(
    shouldExchange({ loggedIn: true, token: "", terminal: false, retryNotBefore: 5000, now: 4000 }),
  ).toBe(false);
  expect(
    shouldExchange({ loggedIn: true, token: "", terminal: false, retryNotBefore: 5000, now: 6000 }),
  ).toBe(true);
});

test("shouldExchange: a stored token always blocks", () => {
  expect(
    shouldExchange({
      loggedIn: true,
      token: "stored",
      terminal: false,
      retryNotBefore: 0,
      now: 1000,
    }),
  ).toBe(false);
});

test("shouldExchange: clean state exchanges", () => {
  expect(
    shouldExchange({ loggedIn: false, token: "", terminal: false, retryNotBefore: 0, now: 1000 }),
  ).toBe(true);
});
