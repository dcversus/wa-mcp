import { expect, test } from "vite-plus/test";
import {
  chatListHtml,
  contactsPageHtml,
  messageListHtml,
  navHtml,
  profilePageHtml,
} from "../src/pages.ts";

test("T168 P5 — every page has exactly one h1", () => {
  for (const [name, html] of [
    ["chats", chatListHtml([{ jid: "a@g.us", name: "A", unreadCount: 0 }], {})],
    ["contacts", contactsPageHtml([{ jid: "a@s.whatsapp.net", name: "A" }])],
    ["profile", profilePageHtml({ blocklist: [], privacy: {} })],
  ] as Array<[string, string]>) {
    expect((html.match(/<h1>/g) ?? []).length, name).toBe(1);
    expect(html, name).not.toContain("<h2>");
  }
});

test("T168 P5 — inputs carry aria-labels", () => {
  const chats = chatListHtml([], {});
  expect(chats).toContain('aria-label="Search chats"');
  const contacts = contactsPageHtml([{ jid: "a@s.whatsapp.net", name: "A" }]);
  expect(contacts).toContain('aria-label="Search contacts"');
  const chat = messageListHtml("c", [
    {
      id: "m1",
      chatJid: "c",
      senderName: null,
      timestamp: "2026-10-06T10:00:00Z",
      content: "hi",
      isFromMe: false,
      isUnread: false,
    },
  ]);
  expect(chat).toContain('aria-label="Type a message"');
});

test("T168 P5 — message text is direction-aware", () => {
  const html = messageListHtml("c", [
    {
      id: "m1",
      chatJid: "c",
      senderName: null,
      timestamp: "2026-10-06T10:00:00Z",
      content: "مرحبا",
      isFromMe: false,
      isUnread: false,
    },
  ]);
  expect(html).toContain('dir="auto"');
});

test("T168 P5 — the nav highlights the active page with aria-current", () => {
  const html = navHtml("chats");
  expect(html).toContain('aria-current="page"');
  expect(html.match(/aria-current="page"/g)).toHaveLength(1);
});
