import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";
import { healthHtml, statusDashboardHtml } from "../src/pages.ts";

const HEALTH = {
  pairingAttempts: { used: 1, limit: 3 },
  subscriptions: { count: 2, dropped: 0 },
  connected: true,
  loggedIn: false,
  uptime: 912,
};

test("T141 — statusDashboardHtml renders semantic stat values, never [object Object]", () => {
  const html = statusDashboardHtml({ health: HEALTH, notifications: [], events: [] });
  expect(html).not.toContain("[object Object]");
  expect(html).toContain("<dd>1 / 3</dd>");
  expect(html).toContain("<dd>2</dd>");
  expect(html).toContain("<dd>yes</dd>");
  expect(html).toContain("<dd>no</dd>");
  expect(html).toContain("<dd>15 m</dd>");
});

test("T141 — healthHtml renders the same values escaped and readable", () => {
  const html = healthHtml(HEALTH);
  expect(html).not.toContain("[object Object]");
  expect(html).toContain("1 / 3");
  expect(html).toContain("yes");
  expect(html).toContain("no");
  expect(html).toContain("15 m");
});

test("T141 — unknown object keys render as k: v pairs", () => {
  const html = healthHtml({ meta: { a: 1, b: "x" } });
  expect(html).not.toContain("[object Object]");
  expect(html).toContain("a: (1), b: (x)");
});

test("T141 — the formatter is a shared pages.ts export", () => {
  const pages = readFileSync(new URL("../src/pages.ts", import.meta.url), "utf8");
  expect(pages).toContain("export function formatStatValue");
});
