import { expect, test } from "vite-plus/test";
import { routeKind } from "../src/router.ts";

test("T149 F1 — #/chat/<jid> is a chat-view route", () => {
  expect(routeKind("#/chat/120363428874442773@g.us")).toBe("chat-view");
});

test("T149 F1 — every other hash is neither", () => {
  expect(routeKind("#/unread")).toBe("other");
  expect(routeKind("#/chats")).toBe("other");
  expect(routeKind("#/settings")).toBe("other");
});
