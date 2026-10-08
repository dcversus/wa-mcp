import { describe, expect, test } from "vite-plus/test";
import {
  bridgeDownBanner,
  chatErrorHtml,
  contextViewHtml,
  messageListHtml,
  navHtml,
  profilePageHtml,
  settingsHtml,
} from "../src/pages.ts";
import { connectionPageHtml } from "../src/connection.ts";

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

test("settingsHtml renders inputs for bridge url and token", () => {
  const html = settingsHtml({ bridgeUrl: "http://b", token: "t" });
  expect(html).toContain('id="bridge-url"');
  expect(html).toContain('id="token"');
  expect(html).toContain('value="http://b"');
});

test("sidebar nav lists the full section set with active state (T51)", () => {
  const html = navHtml("contacts");
  for (const section of [
    "Logs",
    "Contacts",
    "Connections",
    "Subscriptions",
    "Profile",
    "Connection",
    "Settings",
  ]) {
    expect(html).toContain(section);
  }
  expect(html).toContain('class="active" aria-current="page" data-nav="contacts"');
  expect(html).not.toContain(">Chats<");
});

test("connection page renders health fields with escaping (T51)", () => {
  const html = connectionPageHtml({
    health: {
      status: "qr",
      connected: false,
      pairingBlocked: false,
      uptime: 42,
      version: "0.9.0",
      channel: "baileys",
    },
    me: null,
    stats: null,
    settings: null,
    events: [{ type: "connection.update", at: 1, detail: "<script>x</script>" }],
  });
  expect(html).toContain("qr");
  expect(html).toContain("Recent activity");
  expect(html).not.toContain("<script>x</script>");
  expect(html).toContain("&lt;script&gt;");
});

describe("T51-B chats", () => {
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
        poll: {
          question: "Lunch?",
          options: [
            { label: "A", votes: 3 },
            { label: "B", votes: 1 },
          ],
        },
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
        reactions: [{ emote: "👍", count: 2 }],
      },
    ]);
    expect(html).toContain('src="/api/media/m1"'); // T68: real thumbnail
    expect(html).toContain("📊 Lunch?");
    expect(html).toContain("A · 3 votes");
    expect(html).toContain("original");
    expect(html).toContain("👍");
    expect(html).not.toContain("<b>bold</b>");
    expect(html).toContain("&lt;b&gt;bold&lt;/b&gt;");
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
    // T142-W3: the privacy/name forms moved into the native-style mirror
    // (data-privacy-key selects + me-card fields)
    expect(html).toContain('data-privacy-key="last"');
    expect(html).toContain('id="me-name"');
  });

  test("profilePageHtml escapes blocklist entries", () => {
    const html = profilePageHtml({ blocklist: ['"><script>x</script>'] });
    expect(html).not.toContain("<script>x</script>");
  });
});

test("settingsHtml marks the token field optional (T54 revised)", () => {
  const html = settingsHtml({ bridgeUrl: "http://127.0.0.1:8080", token: "" });
  expect(html).toContain("Access key");
  expect(html).not.toContain("cat ~");
});

describe("T67 send-outcome UX", () => {
  test("chatErrorHtml renders an inline escaped banner with the engine message", () => {
    const html = chatErrorHtml("send failed: <script>x</script>");
    expect(html).toContain('class="send-error"');
    expect(html).toContain("&lt;script&gt;x&lt;/script&gt;");
    expect(html).not.toContain("<script>x</script>");
  });

  test("chatErrorHtml offers a dismiss affordance", () => {
    const html = chatErrorHtml("boom");
    expect(html).toContain("data-dismiss-error");
  });
});

describe("T68 media bubbles + day separators + banner", () => {
  test("image bubbles render an <img> thumbnail from /api/media/:id", () => {
    const html = messageListHtml("c", [
      {
        id: "IMG1",
        chatJid: "c",
        senderName: "V",
        timestamp: "t",
        content: null,
        isFromMe: false,
        isUnread: false,
        mediaType: "image",
      },
    ]);
    expect(html).toContain('src="/api/media/IMG1"');
    expect(html).toContain("<img");
  });

  test("audio bubbles render an audio player; document bubbles keep the download link", () => {
    const html = messageListHtml("c", [
      {
        id: "AUD1",
        chatJid: "c",
        senderName: "V",
        timestamp: "t",
        content: null,
        isFromMe: false,
        isUnread: false,
        mediaType: "audio",
      },
      {
        id: "DOC1",
        chatJid: "c",
        senderName: "V",
        timestamp: "t",
        content: "spec.pdf",
        isFromMe: false,
        isUnread: false,
        mediaType: "document",
      },
    ]);
    expect(html).toContain("<audio");
    expect(html).toContain('src="/api/media/AUD1"');
    expect(html).toContain('data-download-id="DOC1"');
  });

  test("day separators group messages by calendar day", () => {
    const html = messageListHtml("c", [
      {
        id: "d1",
        chatJid: "c",
        senderName: "V",
        timestamp: "2026-10-02T10:00:00.000Z",
        content: "yesterday",
        isFromMe: false,
        isUnread: false,
      },
      {
        id: "d2",
        chatJid: "c",
        senderName: "V",
        timestamp: "2026-10-03T10:00:00.000Z",
        content: "today",
        isFromMe: false,
        isUnread: false,
      },
    ]);
    expect(html).toContain('class="day-separator"');
    expect(html).toContain("Fri 2 Oct");
    expect(html).toContain("Sat 3 Oct");
  });
});

describe("T68 daemon-down banner", () => {
  test("bridgeDownBanner renders the url + recovery hint, escaped", () => {
    const html = bridgeDownBanner("http://127.0.0.1:8080<script>x</script>");
    expect(html).toContain("bridge unreachable at http://127.0.0.1:8080");
    expect(html).toContain("is the daemon running?");
    expect(html).not.toContain("<script>x</script>");
  });
});

describe("T70 media query-token", () => {
  test("media elements append ?token=<mediaToken> to every /api/media URL", () => {
    const html = messageListHtml(
      "c",
      [
        {
          id: "IMG1",
          chatJid: "c",
          senderName: "V",
          timestamp: "t",
          content: null,
          isFromMe: false,
          isUnread: false,
          mediaType: "image",
        },
        {
          id: "AUD1",
          chatJid: "c",
          senderName: "V",
          timestamp: "t",
          content: null,
          isFromMe: false,
          isUnread: false,
          mediaType: "audio",
        },
        {
          id: "DOC1",
          chatJid: "c",
          senderName: "V",
          timestamp: "t",
          content: "f.pdf",
          isFromMe: false,
          isUnread: false,
          mediaType: "document",
        },
      ],
      { mediaToken: "sekrit" },
    );
    expect(html).toContain('src="/api/media/IMG1?token=sekrit"');
    expect(html).toContain('src="/api/media/AUD1?token=sekrit"');
    expect(html).toContain('href="/api/media/DOC1?token=sekrit"');
  });

  test("an empty mediaToken appends no query string", () => {
    const html = messageListHtml(
      "c",
      [
        {
          id: "IMG2",
          chatJid: "c",
          senderName: "V",
          timestamp: "t",
          content: null,
          isFromMe: false,
          isUnread: false,
          mediaType: "image",
        },
      ],
      { mediaToken: "" },
    );
    expect(html).toContain('src="/api/media/IMG2"');
    expect(html).not.toContain("token=");
  });
});

describe("T78 M3 — poll bubbles render question, options and vote counts", () => {
  const row = {
    id: "P1",
    chatJid: "1@g.us",
    senderName: "Vasilisa",
    timestamp: "2026-10-03T12:00:00Z",
    content: "",
    mentions: [],
    isFromMe: false,
    isUnread: false,
    reactions: null,
    poll: {
      question: "lunch?",
      options: [
        { label: "Pizza", votes: 2 },
        { label: "Burger", votes: 0 },
      ],
    },
  };

  test("question + option labels + counts render", () => {
    const html = messageListHtml("1@g.us", [row as never]);
    expect(html).toContain("lunch?");
    expect(html).toContain("Pizza");
    expect(html).toContain("Burger");
    expect(html).toMatch(/Pizza[^B]*2/);
    expect(html).toMatch(/Burger[^<]*0/);
  });

  test("reaction badges read the aggregate shape (emote, not emoji)", () => {
    const html = messageListHtml("1@g.us", [
      { ...row, poll: null, reactions: [{ emote: "👍", count: 2, senders: ["a", "b"] }] } as never,
    ]);
    expect(html).toContain("👍");
    expect(html).toContain("2");
    expect(html).not.toContain("undefined");
  });
});

test("C1 — errorBannerHtml escapes the message and marks the banner", async () => {
  const { errorBannerHtml } = await import("../src/pages.ts");
  const html = errorBannerHtml('<script>alert("x")</script> rate limited');
  expect(html).toContain("error-banner");
  expect(html).not.toContain("<script>");
  expect(html).toContain("rate limited");
});

test("C1 — guardLoader renders the banner when a loader throws", async () => {
  const { guardLoader } = await import("../src/pages.ts");
  const guarded = guardLoader(async () => {
    throw new Error("bridge request failed: 429");
  });
  const html = await guarded({});
  expect(html).toContain("error-banner");
  expect(html).toContain("429");
});

test("T142-W3 — profilePageHtml mirrors native WhatsApp: me-card + privacy rows", () => {
  const html = profilePageHtml({
    blocklist: ["358999@s.whatsapp.net"],
    me: { pn: "358497773518@s.whatsapp.net", name: "Vasilisa", status: null },
    privacy: { last: "all", online: "match_last_seen", profile: "all", groupadd: "contacts" },
  });
  expect(html).toContain('id="me-name"');
  expect(html).toContain('id="me-phone"');
  expect(html).toContain('id="me-status"');
  expect(html).toContain('id="save-name"');
  expect(html).toContain('id="save-status"');
  expect(html).toContain("358497773518@s.whatsapp.net");
  expect(html).toContain('data-privacy-key="last"');
  expect(html).toContain('data-privacy-key="calladd"');
  expect(html).toContain("358999@s.whatsapp.net");
});

test("T106-major4 — privacy rows derive from state privacyOptionsFor; live values render selected", async () => {
  const { privacyOptionsFor } = (await import("../src/state.ts")) as {
    privacyOptionsFor: (key: string) => string[];
  };
  expect(privacyOptionsFor("profile")).toContain("contact_blacklist");
  expect(privacyOptionsFor("groupadd")).toContain("none");
  const html = profilePageHtml({
    blocklist: [],
    me: { pn: null, name: "V", status: null },
    privacy: { profile: "contact_blacklist", groupadd: "none", last: "nobody" },
  });
  // live values outside the vocabulary render as an extra selected option
  expect(html).toContain('<option value="nobody" selected>nobody</option>');
  expect(html).toContain('<option value="contact_blacklist" selected');
  // groupadd: none is a legal option and shows selected for the live value
  expect(html).toContain('<option value="none" selected>Nobody</option>');
});
