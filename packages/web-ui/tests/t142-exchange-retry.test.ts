import { expect, test } from "vite-plus/test";
import { shouldExchange } from "../src/state.ts";

test("T142-W1 — a failed exchange (latched, not yet loggedIn) does not retry", () => {
  expect(shouldExchange({ loggedIn: false, token: "", latched: true })).toBe(false);
});

test("T142-W1 — once loggedIn, a latched failure retries (the owner-rule fix)", () => {
  expect(shouldExchange({ loggedIn: true, token: "", latched: true })).toBe(true);
});

test("T142-W1 — an unlatched failure always retries", () => {
  expect(shouldExchange({ loggedIn: true, token: "", latched: false })).toBe(true);
  expect(shouldExchange({ loggedIn: false, token: "", latched: false })).toBe(true);
});

test("T142-W1 — an existing session token means never exchange", () => {
  expect(shouldExchange({ loggedIn: true, token: "session", latched: false })).toBe(false);
  expect(shouldExchange({ loggedIn: false, token: "session", latched: false })).toBe(false);
});
