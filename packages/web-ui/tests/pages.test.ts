import { describe, expect, test } from "vite-plus/test";
import {
  chatListHtml,
  contextViewHtml,
  groupParticipantsHtml,
  healthHtml,
  messageListHtml,
  navHtml,
  pairingHtml,
  profilePageHtml,
  qrHtml,
  settingsHtml,
  statusDashboardHtml,
  unreadHtml,
} from "../src/pages.ts";

test("pairingHtml embeds the token form above the qr area", () => {
  const html = pairingHtml({ bridgeUrl: "http://127.0.0.1:8080", token: "" });
  expect(html).toContain('id="pairing"');
  expect(html).toContain('id="settings-form"');
  expect(html).toContain('id="token"');
  expect(html).toContain('id="qr-status"');
});

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

test("sidebar nav lists the full section set with active state (T51)", () => {
  const html = navHtml("chats");
  for (const section of [
    "Status",
    "Chats",
    "Unread",
    "Contacts",
    "Groups",
    "Pairing",
    "Settings",
  ]) {
    expect(html).toContain(section);
  }
  expect(html).toContain('class="active" data-nav="chats"');
});

test("status dashboard renders health fields with escaping (T51)", () => {
  const html = statusDashboardHtml({
    health: {
      status: "qr",
      connected: false,
      pairingBlocked: false,
      uptime: 42,
      version: "0.9.0",
      channel: "baileys",
    },
    notifications: [{ id: "r1", chat_jid: "1@g.us", pattern: "ping" }],
    events: [{ type: "connection.update", at: 1, detail: "<script>x</script>" }],
  });
  expect(html).toContain("qr");
  expect(html).toContain("pairing rules");
  expect(html).not.toContain("<script>x</script>");
  expect(html).toContain("&lt;script&gt;");
});

describe("T51-B chats", () => {
  test("chatListHtml shows preview, timestamp, archived toggle and search; escapes names", () => {
    const html = chatListHtml(
      [
        {
          jid: "1@s.whatsapp.net",
          name: "<script>x</script>",
          unreadCount: 2,
          lastMessage: { text: "yo", timestamp: "2026-10-02T10:00:00Z" },
        },
        { jid: "2@g.us", name: "Arch", unreadCount: 0, archived: true },
      ],
      { showArchived: false },
    );
    expect(html).toContain('id="chat-search"');
    expect(html).toContain('id="archived-toggle"');
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>x</script>");
    expect(html).toContain("yo");
    expect(html).toContain('data-archived="1"');
  });

  test("messageListHtml renders media labels, polls, quotes, reactions; escapes text", () => {
    const html = messageListHtml("1@s.whatsapp.net", [
      {
        id: "m1",
        chatJid: "1@s.whatsapp.net",
        senderName: "V",
        timestamp: "2026-10-02T10:00:00Z",
        content: "<b>bold</b>",
        isFromMe: false,
        isUnread: false,
        mediaType: "image",
      },
      {
        id: "m2",
        chatJid: "1@s.whatsapp.net",
        senderName: "V",
        timestamp: "2026-10-02T10:01:00Z",
        content: null,
        isFromMe: true,
        isUnread: false,
        poll: { question: "Lunch?", options: ["A", "B"] },
      },
      {
        id: "m3",
        chatJid: "1@s.whatsapp.net",
        senderName: "V",
        timestamp: "2026-10-02T10:02:00Z",
        content: "replying",
        isFromMe: false,
        isUnread: false,
        quoted: { text: "original", senderName: "V" },
        reactions: [{ emoji: "👍", count: 2 }],
      },
    ]);
    expect(html).toContain("📷 image");
    expect(html).toContain("📊 Lunch?");
    expect(html).toContain("A · B");
    expect(html).toContain("original");
    expect(html).toContain("👍");
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
  });

  test("unreadHtml gains a mark-all-read action", () => {
    const html = unreadHtml([{ chatJid: "1@s.whatsapp.net", unreadCount: 3 }]);
    expect(html).toContain('id="mark-all-read"');
  });

  test("contextViewHtml renders ±N around a message with escaping", () => {
    const html = contextViewHtml("m2", [
      {
        id: "m1",
        chatJid: "c",
        senderName: "A",
        timestamp: "t",
        content: "before",
        isFromMe: false,
      },
      {
        id: "m2",
        chatJid: "c",
        senderName: "B",
        timestamp: "t",
        content: "<i>target</i>",
        isFromMe: true,
      },
    ]);
    expect(html).toContain('id="context-view"');
    expect(html).toContain("&lt;i&gt;target&lt;/i&gt;");
  });
});

describe("T51-C/D profile + groups participants", () => {
  test("profilePageHtml renders blocklist with unblock affordance and action forms", () => {
    const html = profilePageHtml({ blocklist: ["358999@s.whatsapp.net"] });
    expect(html).toContain('id="profile-page"');
    expect(html).toContain("358999@s.whatsapp.net");
    expect(html).toContain('data-unblock-jid="358999@s.whatsapp.net"');
    expect(html).toContain('id="block-form"');
    expect(html).toContain('id="privacy-form"');
    expect(html).toContain('id="name-form"');
  });

  test("profilePageHtml escapes blocklist entries", () => {
    const html = profilePageHtml({ blocklist: ['"><script>x</script>'] });
    expect(html).not.toContain("<script>x</script>");
  });

  test("groupParticipantsHtml lists members with admin flags, escaped", () => {
    const html = groupParticipantsHtml("1@g.us", [
      { id: "35846@s.whatsapp.net", isAdmin: true },
      { id: "<script>m</script>", isAdmin: false },
    ]);
    expect(html).toContain('data-participant-jid="35846@s.whatsapp.net"');
    expect(html).toContain("admin");
    expect(html).not.toContain("<script>m</script>");
    expect(html).toContain('data-add-participant="1@g.us"');
    expect(html).toContain('data-remove-participant="1@g.us"');
  });
});
