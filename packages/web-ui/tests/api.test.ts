import { describe, expect, test } from "vite-plus/test";
import { createApiClient } from "../src/api.ts";

/** request bodies are strings by construction (createApiClient JSON.stringify's them) */
function bodyOf(call: { init?: { body?: unknown } } | undefined): string {
  const body = call?.init?.body;
  if (typeof body !== "string") throw new Error("request body not a string");
  return body;
}

function mockFetch(
  payload: unknown,
  status = 200,
): { fetchFn: typeof fetch; calls: Array<{ url: string; init: RequestInit }> } {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

test("api client sends the bearer token on every call", async () => {
  const { fetchFn, calls } = mockFetch({ chats: [] });
  const client = createApiClient({
    baseUrl: "http://bridge:8080",
    token: "tok",
    fetchFn,
    onUnauthorized: () => {},
  });
  await client.getChats();
  expect(calls[0]?.url).toBe("http://bridge:8080/api/chats");
  const headers = calls[0]?.init.headers as Record<string, string>;
  expect(headers.authorization).toBe("Bearer tok");
});

test("getMessages passes chat and limit params", async () => {
  const { fetchFn, calls } = mockFetch({ messages: [] });
  const client = createApiClient({
    baseUrl: "http://bridge:8080",
    token: "tok",
    fetchFn,
    onUnauthorized: () => {},
  });
  await client.getMessages("g@g.us", 25);
  expect(calls[0]?.url).toBe("http://bridge:8080/api/messages?chat_jid=g%40g.us&limit=25");
});

test("sendMessage posts chat_jid and text", async () => {
  const { fetchFn, calls } = mockFetch({ message_id: "M1" });
  const client = createApiClient({
    baseUrl: "http://bridge:8080",
    token: "tok",
    fetchFn,
    onUnauthorized: () => {},
  });
  await client.sendMessage("g@g.us", "hi");
  expect(calls[0]?.init.method).toBe("POST");
  expect(JSON.parse(bodyOf(calls[0]))).toEqual({ chat_jid: "g@g.us", text: "hi" });
});

test("a 401 triggers the unauthorized callback", async () => {
  const { fetchFn } = mockFetch({}, 401);
  let redirected = false;
  const client = createApiClient({
    baseUrl: "http://bridge:8080",
    token: "tok",
    fetchFn,
    onUnauthorized: () => {
      redirected = true;
    },
  });
  await client.getChats();
  expect(redirected).toBe(true);
});

test("getQr, getUnread, getHealth hit their endpoints", async () => {
  const { fetchFn, calls } = mockFetch({});
  const client = createApiClient({
    baseUrl: "http://bridge:8080",
    token: "tok",
    fetchFn,
    onUnauthorized: () => {},
  });
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
  const client = createApiClient({
    baseUrl: "http://bridge:8080",
    token: "tok",
    fetchFn,
    onUnauthorized: () => {},
  });
  await client.markRead("g@g.us", ["M1"]);
  expect(calls[0]?.init.method).toBe("POST");
  expect(JSON.parse(bodyOf(calls[0]))).toEqual({
    chat_jid: "g@g.us",
    message_ids: ["M1"],
  });
});

describe("task-51 client surface", () => {
  function recordingClient() {
    const calls: Array<{ path: string; init?: RequestInit & { json?: unknown } }> = [];
    const client = createApiClient({
      baseUrl: "http://bridge",
      token: "tok",
      fetchFn: (async (url: string | URL, init?: RequestInit) => {
        calls.push({ path: String(url).slice("http://bridge".length), init });
        return new Response("{}", { status: 200 });
      }) as unknown as typeof fetch,
      onUnauthorized: () => {},
    });
    return { client, calls };
  }

  test("pairingCode posts the phone to /api/pairing-code", async () => {
    const { client, calls } = recordingClient();
    await client.pairingCode("358497773518");
    expect(calls[0]?.path).toBe("/api/pairing-code");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(JSON.parse(bodyOf(calls[0]))).toEqual({ phone: "358497773518" });
  });

  test("resumePairing posts /api/pair/resume", async () => {
    const { client, calls } = recordingClient();
    await client.resumePairing();
    expect(calls[0]?.path).toBe("/api/pair/resume");
    expect(calls[0]?.init?.method).toBe("POST");
  });

  test("search hits /api/search with the query", async () => {
    const { client, calls } = recordingClient();
    await client.search("pizza", 5);
    expect(calls[0]?.path).toBe("/api/search?query=pizza&limit=5");
  });

  test("contacts lists with optional query", async () => {
    const { client, calls } = recordingClient();
    await client.contacts("ali");
    expect(calls[0]?.path).toBe("/api/contacts?query=ali");
  });

  test("setAlias posts chat_jid + alias", async () => {
    const { client, calls } = recordingClient();
    await client.setAlias("123@s.whatsapp.net", "Andreas");
    expect(calls[0]?.path).toBe("/api/alias");
    expect(JSON.parse(bodyOf(calls[0]))).toEqual({
      chat_jid: "123@s.whatsapp.net",
      alias: "Andreas",
    });
  });

  test("group ops hit the group endpoints", async () => {
    const { client, calls } = recordingClient();
    await client.groupParticipants("1@g.us");
    await client.groupCreate("Test", ["1@s.whatsapp.net"]);
    await client.groupLeave("1@g.us");
    expect(calls.map((c) => c.path)).toEqual([
      "/api/group/participants",
      "/api/group/create",
      "/api/group/leave",
    ]);
  });

  test("notifications list + delete", async () => {
    const { client, calls } = recordingClient();
    await client.notifications();
    await client.deleteNotification("rule-1");
    expect(calls[0]?.path).toBe("/api/notifications");
    expect(calls[1]?.path).toBe("/api/notifications/rule-1");
    expect(calls[1]?.init?.method).toBe("DELETE");
  });

  test("profile/privacy/blocklist read paths", async () => {
    const { client, calls } = recordingClient();
    await client.profile();
    await client.privacy();
    await client.blocklist();
    expect(calls.map((c) => c.path)).toEqual(["/api/profile", "/api/privacy", "/api/blocklist"]);
  });

  test("media + transcribe + tts", async () => {
    const { client, calls } = recordingClient();
    await client.downloadMedia("msg-1");
    await client.transcribe("msg-1");
    await client.sendTts("123@s.whatsapp.net", "hello");
    expect(calls[0]?.path).toBe("/api/media/msg-1");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[1]?.path).toBe("/api/transcribe");
    expect(calls[2]?.path).toBe("/api/tts");
  });

  test("getContext hits /api/context with chat, message and radius", async () => {
    const { client, calls } = recordingClient();
    await client.getContext("123@s.whatsapp.net", "m-1", 5);
    expect(calls[0]?.path).toBe(
      "/api/context?chat_jid=123%40s.whatsapp.net&message_id=m-1&radius=5",
    );
  });

  test("block/setPrivacy/setName hit their endpoints", async () => {
    const { client, calls } = recordingClient();
    await client.block("999@s.whatsapp.net");
    await client.setPrivacy("read_receipts", "none");
    await client.setProfileName("New Name");
    expect(calls.map((c) => c.path)).toEqual(["/api/block", "/api/privacy", "/api/profile"]);
    // bodies are strings by construction (createApiClient JSON.stringify's them)
    const bodyOf = (i: number): string => {
      const body = calls[i]?.init?.body;
      if (typeof body !== "string") throw new Error(`call ${i} body not a string`);
      return body;
    };
    expect(JSON.parse(bodyOf(0))).toEqual({
      chat_jid: "999@s.whatsapp.net",
      block: true,
    });
    expect(JSON.parse(bodyOf(1))).toEqual({
      privacy_key: "read_receipts",
      value: "none",
    });
    expect(JSON.parse(bodyOf(2))).toEqual({ name: "New Name" });
  });

  test("sendPresence notifies typing", async () => {
    const { client, calls } = recordingClient();
    await client.sendPresence("123@s.whatsapp.net", "composing");
    expect(calls[0]?.path).toBe("/api/presence");
  });
});

describe("T77 — client requests match the bridge validation contracts", () => {
  function harness() {
    const { fetchFn, calls } = mockFetch({});
    const client = createApiClient({
      baseUrl: "http://bridge:8080",
      token: "tok",
      fetchFn,
      onUnauthorized: () => undefined,
    });
    const pathOf = (call: { url: string } | undefined): string =>
      call === undefined ? "" : call.url.replace("http://bridge:8080", "");
    return { client, calls, pathOf };
  }

  test("sendPresence sends `presence` (the route validates input.presence)", async () => {
    const { client, calls, pathOf } = harness();
    await client.sendPresence("358497773518@s.whatsapp.net", "composing");
    expect(pathOf(calls[0])).toBe("/api/presence");
    // RED: the client sent `state`, the bridge 400s "presence must be one of..."
    expect(JSON.parse(bodyOf(calls[0]))).toEqual({
      chat_jid: "358497773518@s.whatsapp.net",
      presence: "composing",
    });
  });

  test("setAlias sends `jid` (the route validates input.jid)", async () => {
    const { client, calls, pathOf } = harness();
    await client.setAlias("358497773518@s.whatsapp.net", "V");
    expect(pathOf(calls[0])).toBe("/api/alias");
    // RED: the client sent `chat_jid`, the bridge 400s "jid is required"
    expect(JSON.parse(bodyOf(calls[0]))).toEqual({ jid: "358497773518@s.whatsapp.net", alias: "V" });
  });
});
