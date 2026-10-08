import { expect, test } from "vite-plus/test";
import { subscriptionsPageHtml } from "../src/subscriptions.ts";
import { messageListHtml, profilePageHtml, settingsHtml } from "../src/pages.ts";
import { contactsPageHtml } from "../src/contacts.ts";

test("T167 P4 — contacts copy: Rename, human search", () => {
  const html = contactsPageHtml({
    contacts: [
      {
        jid: "a@s.whatsapp.net",
        displayName: "A",
        phone: null,
        name: "A",
        pushname: null,
        username: null,
        alias: null,
        source: "whatsapp",
      },
    ],
    total: 1,
    query: "",
    saved: true,
  });
  expect(html).toContain("Rename");
  expect(html).toContain("Search contacts");
});

test("T167 P4 — chat view copy: Type a message, Save file on media only", () => {
  const base = {
    id: "m1",
    chatJid: "c",
    senderName: "V",
    timestamp: "2026-10-06T10:00:00Z",
    content: "hi",
    isFromMe: false,
    isUnread: false,
  };
  const text = messageListHtml("c", [{ ...base }]);
  expect(text).toContain("Show nearby messages");
  expect(text).not.toContain(">download<");
  const media = messageListHtml("c", [{ ...base, mediaType: "image" }]);
  expect(media).toContain("Save file");
  expect(media).toContain("Type a message");
});

test("T167 P4 — profile copy: privacy labels and block-a-number", () => {
  const html = profilePageHtml({
    blocklist: [],
    me: { pn: "358497773518", name: "Versus", status: "" },
    privacy: { last: "contacts", online: "all" },
  });
  expect(html).toContain("Last seen");
  expect(html).toContain("Who can add me to groups");
  expect(html).toContain("My contacts");
  expect(html).toContain("Block a number");
  expect(html).not.toContain("block a JID");
});

test("T167 P4 — settings copy is human", () => {
  const html = settingsHtml({ bridgeUrl: "http://127.0.0.1:8080", token: "" });
  expect(html).toContain("Server address");
  expect(html).toContain("Access key");
});

test("T167 P4 — subscriptions copy is agent language", () => {
  const html = subscriptionsPageHtml({
    subscriptions: [],
    chats: [{ jid: "a@g.us", name: "A" }],
    sessions: [],
    editing: "new",
  });
  expect(html).toContain("Subscriptions");
  expect(html).not.toContain("Agent alerts");
  expect(html).toContain("System prompt your agent receives with the event");
  expect(html).toContain("Only when my account is @mentioned");
});
