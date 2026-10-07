import { expect, test } from "vite-plus/test";
import { subscriptionsPageHtml } from "../src/pages.ts";

function sub(overrides: Partial<{ id: string; chatJid: string | null; inboxPath: string }> = {}) {
  return {
    id: "s1",
    chatJid: "120363428874442773@g.us" as string | null,
    allChats: false,
    kinds: ["message"],
    includeMedia: false,
    inboxPath: "/data/subs/s1/inbox.jsonl",
    ...overrides,
  };
}

test("T172 A1 — each wired sub shows the exact install commands with copy", () => {
  const html = subscriptionsPageHtml([sub()], [], {});
  expect(html).toContain("wa-mcp install --hooks claude --sub s1");
  expect(html).toContain("wa-mcp install --hooks codex --sub s1");
  expect(html).toContain("tail -F /data/subs/s1/inbox.jsonl");
  expect((html.match(/class="copy-cmd"/g) ?? []).length).toBeGreaterThanOrEqual(3);
  expect(html).toContain("Events are appended to this file");
});

test("T172 A1 — each wired sub has a Send test event control", () => {
  const html = subscriptionsPageHtml([sub()], [], {});
  expect(html).toContain('data-test-sub="s1"');
  expect(html).toContain("Send test event");
});

test("T172 A5 — @lid chats appear in the picker", () => {
  const html = subscriptionsPageHtml(
    [],
    [
      { jid: "999555000111@lid", name: "Lid contact", unreadCount: 2 },
      { jid: "120363428874442773@g.us", name: "Test group", unreadCount: 0 },
    ],
    {},
  );
  expect(html).toContain('data-chat-jid="999555000111@lid"');
  expect(html).toContain("Lid contact");
  expect(html).toContain('class="unread-badge">2<');
});
