import { expect, test } from "vite-plus/test";
import { statusDashboardHtml } from "../src/pages.ts";

test("T166 P3 — the human status card names the account and sums up state", () => {
  const html = statusDashboardHtml({
    health: {
      connected: true,
      loggedIn: true,
      uptime: 86_400,
      lastDisconnectAt: Date.now() - 7_200_000,
      subscriptions: { count: 1, dropped: 0 },
    },
    me: { name: "Versus", pn: "358497773518" },
    notifications: [],
    events: [],
  });
  expect(html).toContain("Linked as");
  expect(html).toContain("Versus");
  expect(html).toContain("+358 49 777 3518");
  expect(html).toContain("online");
  expect(html).toContain("running for 1 d 0 h");
  expect(html).toContain("1 agent subscription");
  expect(html).not.toContain("pairing rules");
  expect(html).toContain("Recent activity");
  expect(html).toContain("Diagnostics");
});

test("T166 P3 — an unlinked daemon shows the link call-to-action", () => {
  const html = statusDashboardHtml({
    health: { connected: false, loggedIn: false },
    me: null,
    notifications: [],
    events: [],
  });
  expect(html).toContain("WhatsApp not linked");
  expect(html).toContain("#/pairing");
});
