import { expect, test } from "vite-plus/test";
import { shouldExchange } from "../src/state.ts";

test("T142-W1 — a non-terminal failure blocks only until the retry window passes", () => {
  expect(
    shouldExchange({
      loggedIn: false,
      latched: false,
      token: "",
      terminal: false,
      retryNotBefore: 5000,
      now: 4000,
    }),
  ).toBe(false);
});

test("T142-W1 — once the window passes, the exchange retries (the owner-rule fix)", () => {
  expect(
    shouldExchange({
      loggedIn: true,
      latched: false,
      token: "",
      terminal: false,
      retryNotBefore: 5000,
      now: 6000,
    }),
  ).toBe(true);
  expect(
    shouldExchange({
      loggedIn: false,
      latched: false,
      token: "",
      terminal: false,
      retryNotBefore: 0,
      now: 0,
    }),
  ).toBe(true);
});

test("T142-W1 — a terminal verdict (403) never retries within this page load", () => {
  expect(
    shouldExchange({
      loggedIn: true,
      latched: false,
      token: "",
      terminal: true,
      retryNotBefore: 0,
      now: 999999,
    }),
  ).toBe(false);
});

test("T142-W1 — an existing session token means never exchange", () => {
  expect(
    shouldExchange({
      loggedIn: true,
      latched: true,
      token: "session",
      terminal: false,
      retryNotBefore: 0,
      now: 0,
    }),
  ).toBe(false);
  expect(
    shouldExchange({
      loggedIn: false,
      latched: false,
      token: "session",
      terminal: false,
      retryNotBefore: 0,
      now: 0,
    }),
  ).toBe(false);
});
