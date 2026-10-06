import { expect, test } from "vite-plus/test";
import { statusDashboardHtml, subscriptionsPageHtml } from "../src/pages.ts";

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

test("T166 P3 — notification rules live on the Agent alerts page", () => {
  const html = subscriptionsPageHtml(
    [
      {
        id: "s1",
        chatJid: "120363428874442773@g.us",
        allChats: false,
        kinds: ["message"],
        includeMedia: false,
        inboxPath: "/data/subs/s1/inbox.jsonl",
      },
    ],
    [],
    {
      rules: [{ id: "r1", chat_jid: "120363428874442773@g.us", pattern: "invoice" }],
      resolveName: (jid) => (jid === "120363428874442773@g.us" ? "Test group" : null),
    },
  );
  expect(html).toContain("Notification rules");
  expect(html).toContain("Test group");
  expect(html).toContain('data-delete-rule="r1"');
});
