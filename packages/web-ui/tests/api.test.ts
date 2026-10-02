import { expect, test, vi } from "vite-plus/test";
import { createApiClient } from "../src/api.ts";

function mockFetch(payload: unknown, status = 200): { fetchFn: typeof fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(payload), { status, headers: { "content-type": "application/json" } });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

test("api client sends the bearer token on every call", async () => {
  const { fetchFn, calls } = mockFetch({ chats: [] });
  const client = createApiClient({ baseUrl: "http://bridge:8080", token: "tok", fetchFn, onUnauthorized: () => {} });
  await client.getChats();
  expect(calls[0]?.url).toBe("http://bridge:8080/api/chats");
  const headers = calls[0]?.init.headers as Record<string, string>;
  expect(headers.authorization).toBe("Bearer tok");
});

test("getMessages passes chat and limit params", async () => {
  const { fetchFn, calls } = mockFetch({ messages: [] });
  const client = createApiClient({ baseUrl: "http://bridge:8080", token: "tok", fetchFn, onUnauthorized: () => {} });
  await client.getMessages("g@g.us", 25);
  expect(calls[0]?.url).toBe("http://bridge:8080/api/messages?chat_jid=g%40g.us&limit=25");
});

test("sendMessage posts chat_jid and text", async () => {
  const { fetchFn, calls } = mockFetch({ message_id: "M1" });
  const client = createApiClient({ baseUrl: "http://bridge:8080", token: "tok", fetchFn, onUnauthorized: () => {} });
  await client.sendMessage("g@g.us", "hi");
  expect(calls[0]?.init.method).toBe("POST");
  expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ chat_jid: "g@g.us", text: "hi" });
});

test("a 401 triggers the unauthorized callback", async () => {
  const { fetchFn } = mockFetch({}, 401);
  let redirected = false;
  const client = createApiClient({ baseUrl: "http://bridge:8080", token: "tok", fetchFn, onUnauthorized: () => { redirected = true; } });
  await client.getChats();
  expect(redirected).toBe(true);
});

test("getQr, getUnread, getHealth hit their endpoints", async () => {
  const { fetchFn, calls } = mockFetch({});
  const client = createApiClient({ baseUrl: "http://bridge:8080", token: "tok", fetchFn, onUnauthorized: () => {} });
  await client.getQr();
  await client.getUnread();
  await client.getHealth();
  expect(calls.map((call) => call.url)).toEqual([
    "http://bridge:8080/api/qr",
    "http://bridge:8080/api/unread",
    "http://bridge:8080/health",
  ]);
});

test("markRead posts chat_jid and message ids", async () => {
  const { fetchFn, calls } = mockFetch({ read: 1 });
  const client = createApiClient({ baseUrl: "http://bridge:8080", token: "tok", fetchFn, onUnauthorized: () => {} });
  await client.markRead("g@g.us", ["M1"]);
  expect(calls[0]?.init.method).toBe("POST");
  expect(JSON.parse(String(calls[0]?.init.body))).toEqual({ chat_jid: "g@g.us", message_ids: ["M1"] });
});
