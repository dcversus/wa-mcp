import { describe, expect, test } from "vite-plus/test";
import { createApiClient } from "../src/api.ts";
import { healthWithRetry } from "../src/preflight.ts";
import { ApiError } from "../src/api.ts";

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

test("uiToken cookie mode sends same-origin credentials and no bearer", async () => {
  const { fetchFn, calls } = mockFetch({ token: "T" });
  const client = createApiClient({
    baseUrl: "http://127.0.0.1:8080",
    token: "stored",
    fetchFn,
    onUnauthorized: () => {},
  });
  await client.uiToken({ useCookie: true });
  expect(calls[0]?.init.credentials).toBe("same-origin");
  const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
  expect(headers.authorization).toBeUndefined();
});

test("uiToken default mode keeps the bearer exchange", async () => {
  const { fetchFn, calls } = mockFetch({ token: "T" });
  const client = createApiClient({
    baseUrl: "http://127.0.0.1:8080",
    token: "stored",
    fetchFn,
    onUnauthorized: () => {},
  });
  await client.uiToken();
  const headers = (calls[0]?.init.headers ?? {}) as Record<string, string>;
  expect(headers.authorization).toBe("Bearer stored");
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

test("sendMessage carries reply_to_message_id when replying", async () => {
  const { fetchFn, calls } = mockFetch({ message_id: "M2" });
  const client = createApiClient({
    baseUrl: "http://bridge:8080",
    token: "tok",
    fetchFn,
    onUnauthorized: () => {},
  });
  await client.sendMessage("g@g.us", "a reply", { replyToMessageId: "3EBORIG" });
  const body = JSON.parse(bodyOf(calls[0])) as { reply_to_message_id?: string };
  expect(body.reply_to_message_id).toBe("3EBORIG");
});

test("sendMessage without an option never adds reply_to_message_id", async () => {
  const { fetchFn, calls } = mockFetch({ message_id: "M3" });
  const client = createApiClient({
    baseUrl: "http://bridge:8080",
    token: "tok",
    fetchFn,
    onUnauthorized: () => {},
  });
  await client.sendMessage("g@g.us", "plain");
  expect(bodyOf(calls[0])).not.toContain("reply_to_message_id");
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
  // C1 contract update: the callback still fires, then the call rejects
  await expect(client.getChats()).rejects.toMatchObject({ name: "ApiError", status: 401 });
  expect(redirected).toBe(true);
});

test("getQr, getHealth hit their endpoints", async () => {
  const { fetchFn, calls } = mockFetch({});
  const client = createApiClient({
    baseUrl: "http://bridge:8080",
    token: "tok",
    fetchFn,
    onUnauthorized: () => {},
  });
  await client.getQr();
  await client.getHealth();
  expect(calls.map((call) => call.url)).toEqual([
    "http://bridge:8080/api/qr",
    "http://bridge:8080/health",
  ]);
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

  test("contacts lists with optional query", async () => {
    const { client, calls } = recordingClient();
    await client.contacts({ q: "ali" });
    expect(calls[0]?.path).toBe("/api/contacts?q=ali");
  });

  test("privacy/blocklist read paths", async () => {
    const { client, calls } = recordingClient();
    await client.privacy();
    await client.blocklist();
    expect(calls.map((c) => c.path)).toEqual(["/api/privacy", "/api/blocklist"]);
  });

  test("media + transcribe", async () => {
    const { client, calls } = recordingClient();
    await client.downloadMedia("msg-1");
    await client.transcribe("msg-1");
    expect(calls[0]?.path).toBe("/api/media/msg-1");
    expect(calls[0]?.init?.method).toBe("POST");
    expect(calls[1]?.path).toBe("/api/transcribe");
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
    await client.setPrivacy({ readReceipts: "none" });
    await client.setProfileName("New Name");
    expect(calls.map((c) => c.path)).toEqual(["/api/block", "/api/privacy", "/api/profile"]);
    // bodies are strings by construction (createApiClient JSON.stringify's them)
    const bodyOf = (i: number): string => {
      const body = calls[i]?.init?.body;
      if (typeof body !== "string") throw new Error(`call ${i} body not a string`);
      return body;
    };
    expect(JSON.parse(bodyOf(0))).toEqual({
      jid: "999@s.whatsapp.net",
      block: true,
    });
    expect(JSON.parse(bodyOf(1))).toEqual({
      readReceipts: "none",
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
});

test("C1 — a 429/500 error body throws a structured ApiError, not the payload", async () => {
  const { fetchFn } = mockFetch(
    { error: { code: "RATE_LIMITED", message: "rate limit exceeded" } },
    429,
  );
  const client = createApiClient({
    baseUrl: "http://bridge:8080",
    token: "tok",
    fetchFn,
    onUnauthorized: () => {},
  });
  await expect(client.getChats()).rejects.toMatchObject({
    name: "ApiError",
    status: 429,
    message: "rate limit exceeded",
  });
});

test("C1 — a non-JSON error page throws a structured ApiError", async () => {
  const fetchFn = (async () =>
    new Response("<html>502 Bad Gateway</html>", { status: 502 })) as unknown as typeof fetch;
  const client = createApiClient({
    baseUrl: "http://bridge:8080",
    token: "tok",
    fetchFn,
    onUnauthorized: () => {},
  });
  await expect(client.getChats()).rejects.toMatchObject({
    name: "ApiError",
    status: 502,
  });
});

test("healthWithRetry recovers after ApiError 429s then succeeds", async () => {
  let calls = 0;
  const client = {
    getHealth: async () => {
      calls += 1;
      if (calls < 3) {
        throw new ApiError(429, "rate limit exceeded");
      }
      return { connected: true, uiBootstrapToken: "tok" };
    },
  };
  const health = await healthWithRetry(client, {
    attempts: 5,
    delayMs: 1,
  });
  expect(calls).toBe(3);
  expect(health.uiBootstrapToken).toBe("tok");
});

test("healthWithRetry gives up after the budget and returns {}", async () => {
  let calls = 0;
  const client = {
    getHealth: async () => {
      calls += 1;
      throw new ApiError(429, "rate limit exceeded");
    },
  };
  const health = await healthWithRetry(client, {
    attempts: 3,
    delayMs: 1,
  });
  expect(calls).toBe(3);
  expect(health).toEqual({});
});

test("healthWithRetry does NOT retry non-429 errors (bridge down fails fast)", async () => {
  let calls = 0;
  const client = {
    getHealth: async () => {
      calls += 1;
      throw new ApiError(503, "bridge returned 503");
    },
  };
  const health = await healthWithRetry(client, {
    attempts: 5,
    delayMs: 50,
  });
  expect(calls).toBe(1);
  expect(health).toEqual({});
});

test("healthWithRetry honors retry-after when the server sends it", async () => {
  const started = Date.now();
  let calls = 0;
  const client = {
    getHealth: async () => {
      calls += 1;
      if (calls === 1) {
        throw new ApiError(429, "rate limit exceeded", 30);
      }
      return { connected: true };
    },
  };
  const health = await healthWithRetry(client, {
    attempts: 3,
    delayMs: 10_000,
  });
  expect(calls).toBe(2);
  expect(health.connected).toBe(true);
  expect(Date.now() - started).toBeGreaterThanOrEqual(25);
});
