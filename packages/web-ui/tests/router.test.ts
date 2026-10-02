import { expect, test } from "vite-plus/test";
import { resolveRoute, type RoutePattern } from "../src/router.ts";

const ROUTES: Array<RoutePattern<"chats" | "chat" | "unread" | "settings" | "health" | "pairing">> = [
  { route: "chats", pattern: "chats" },
  { route: "chat", pattern: "chat/:jid" },
  { route: "unread", pattern: "unread" },
  { route: "settings", pattern: "settings" },
  { route: "health", pattern: "health" },
  { route: "pairing", pattern: "pairing" },
];

test("routes bare and #/ hashes to chats", () => {
  expect(resolveRoute("#/chats", ROUTES)?.route).toBe("chats");
  expect(resolveRoute("", ROUTES)?.route).toBe("chats");
});

test("routes extract the jid param with url-decoding", () => {
  const match = resolveRoute("#/chat/120363428874442773%40g.us", ROUTES);
  expect(match?.route).toBe("chat");
  expect(match?.params.jid).toBe("120363428874442773@g.us");
});

test("routes every declared page", () => {
  for (const page of ["unread", "settings", "health", "pairing"] as const) {
    expect(resolveRoute(`#/${page}`, ROUTES)?.route).toBe(page);
  }
});

test("unknown hash resolves to null", () => {
  expect(resolveRoute("#/nope", ROUTES)).toBeNull();
});
