import { expect, test } from "vite-plus/test";
import {
  chatListHtml,
  healthHtml,
  messageListHtml,
  qrHtml,
  settingsHtml,
  unreadHtml,
} from "../src/pages.ts";

test("chatListHtml renders chats with unread badges", () => {
  const html = chatListHtml([
    { jid: "a@g.us", name: "Alpha", unreadCount: 3, lastMessage: null },
    { jid: "b@g.us", name: "Beta", unreadCount: 0, lastMessage: null },
  ]);
  expect(html).toContain("Alpha");
  expect(html).toContain('data-jid="a@g.us"');
  expect(html).toContain('<span class="unread-badge">3</span>');
  expect(html).not.toContain('<span class="unread-badge">0</span>');
  expect(html).toContain("Beta");
});

test("messageListHtml renders messages with sender and text", () => {
  const html = messageListHtml("g@g.us", [
    {
      id: "M1",
      chatJid: "g@g.us",
      senderName: "Vasilisa",
      timestamp: "2026-10-01T10:00:00.000Z",
      content: "hello",
      isFromMe: false,
      isUnread: false,
    },
    {
      id: "M2",
      chatJid: "g@g.us",
      senderName: "Me",
      timestamp: "2026-10-01T11:00:00.000Z",
      content: "hi",
      isFromMe: true,
      isUnread: false,
    },
  ]);
  expect(html).toContain("hello");
  expect(html).toContain("Vasilisa");
  expect(html).toContain('class="message from-me"');
  expect(html).toContain('data-chat-jid="g@g.us"');
});

test("unreadHtml renders counts with mark-read buttons", () => {
  const html = unreadHtml([{ chatJid: "g@g.us", unreadCount: 2 }]);
  expect(html).toContain("g@g.us");
  expect(html).toContain('data-mark-jid="g@g.us"');
  expect(html).toContain("2");
});

test("settingsHtml renders inputs for bridge url and token", () => {
  const html = settingsHtml({ bridgeUrl: "http://b", token: "t" });
  expect(html).toContain('id="bridge-url"');
  expect(html).toContain('id="token"');
  expect(html).toContain('value="http://b"');
});

test("qrHtml renders an image slot and status line", () => {
  const html = qrHtml(null);
  expect(html).toContain('id="qr-image"');
  expect(html).toContain('id="qr-status"');
  const withQr = qrHtml("data:image/png;base64,QUJD");
  expect(withQr).toContain('src="data:image/png;base64,QUJD"');
});

test("healthHtml renders status fields", () => {
  const html = healthHtml({
    status: "connected",
    connected: true,
    loggedIn: true,
    version: "0.0.0",
    uptime: 12,
  });
  expect(html).toContain("connected");
  expect(html).toContain("0.0.0");
  expect(html).toContain("12");
});
