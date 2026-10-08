import { expect, test } from "vite-plus/test";
import { routeKind } from "../src/router.ts";
import { chatListHtml } from "../src/pages.ts";

test("T149 F1 — #/chats is a chats-list route, not a chat view", () => {
  expect(routeKind("#/chats")).toBe("chats-list");
});

test("T149 F1 — #/chat/<jid> is a chat-view route", () => {
  expect(routeKind("#/chat/120363428874442773@g.us")).toBe("chat-view");
});

test("T149 F1 — every other hash is neither", () => {
  expect(routeKind("#/unread")).toBe("other");
  expect(routeKind("#/settings")).toBe("other");
});

test("T149 F1 — chat rows are real links to the chat view", () => {
  const html = chatListHtml(
    [
      { jid: "120363428874442773@g.us", name: "Test group", unreadCount: 2 },
      { jid: "351930017568@s.whatsapp.net", name: null, unreadCount: 0 },
    ],
    {},
  );
  expect(html).toContain('<a href="#/chat/120363428874442773@g.us"');
  expect(html).toContain('<a href="#/chat/351930017568@s.whatsapp.net"');
});
