import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { WASocket } from "@whiskeysockets/baileys";
import { createEventBus } from "../src/events.ts";
import { createHttpServer, type BridgeHttp, type HttpServerOptions } from "../src/http.ts";
import type { BridgeHandle, BridgeStatus } from "../src/lifecycle.ts";
import { saveQrPng } from "../src/qr.ts";
import { openStore, type Store } from "../src/store/schema.ts";
import { SendGuard } from "../src/send/safety.ts";
import { storeMessage } from "../src/store/messages.ts";

const created: BridgeHttp[] = [];
const openedStores: Store[] = [];
const authHeader = { authorization: "Bearer test-token" };
const GROUP_A = "120363428874442773@g.us";
const GROUP_B = "120363999999999999@g.us";

function makeFakeSocket(): WASocket {
  const sendMessage = vi.fn(async (jid: string, content: unknown) => ({
    key: { remoteJid: jid, fromMe: true, id: "SENTID1" },
    message: content,
  }));
  return { sendMessage } as unknown as WASocket;
}

function stubHandle(
  status: BridgeStatus = "connected",
  lastQr: string | null = null,
  socket: WASocket = makeFakeSocket(),
): BridgeHandle {
  return {
    status,
    events: createEventBus(),
    close: async () => {},
    getLastQr: () => lastQr,
    socket,
  };
}

async function startServer(opts: Partial<HttpServerOptions> = {}): Promise<BridgeHttp> {
  const bridge = await createHttpServer(stubHandle(), { token: "test-token", ...opts });
  created.push(bridge);
  return bridge;
}

function url(bridge: BridgeHttp, path: string): string {
  return `http://127.0.0.1:${bridge.port}${path}`;
}

afterEach(async () => {
  for (const bridge of created.splice(0)) {
    await bridge.close();
  }
  for (const store of openedStores.splice(0)) {
    store.close();
  }
});

function seedRow(store: Store, id: string, chatJid: string, timestamp: number, text: string): void {
  storeMessage(store, {
    key: { remoteJid: chatJid, fromMe: false, id, participant: "358401112222@s.whatsapp.net" },
    message: { conversation: text },
    messageTimestamp: timestamp,
    pushName: "Vasilisa",
  } as never);
}

async function bootWithStore(seed: (store: Store) => void): Promise<BridgeHttp> {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-store-")));
  openedStores.push(store);
  seed(store);
  const bridge = await createHttpServer(stubHandle("connected"), { token: "test-token", store });
  created.push(bridge);
  return bridge;
}

test("GET /health is public and returns the exact health shape", async () => {
  const bridge = await startServer();
  const res = await fetch(url(bridge, "/health"));
  expect(res.status).toBe(200);
  expect(res.headers.get("content-type")).toContain("application/json");
  const body = (await res.json()) as Record<string, unknown>;
  expect(body.status).toBe("connected");
  expect(body.connected).toBe(true);
  expect(body.loggedIn).toBe(true);
  expect(body.version).toBe("0.0.0");
  expect(typeof body.uptime).toBe("number");
  expect(body.uptime as number).toBeGreaterThanOrEqual(0);
});

test("health reports connecting as not connected and not logged in", async () => {
  const bridge = await createHttpServer(stubHandle("connecting"), { token: "test-token" });
  created.push(bridge);
  const body = (await (await fetch(url(bridge, "/health"))).json()) as Record<string, unknown>;
  expect(body.status).toBe("connecting");
  expect(body.connected).toBe(false);
  expect(body.loggedIn).toBe(false);
});

test("health leaks no other data", async () => {
  const bridge = await startServer();
  const body = (await (await fetch(url(bridge, "/health"))).json()) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(
    ["connected", "loggedIn", "status", "uptime", "version"].sort(),
  );
});

describe("auth matrix", () => {
  const cases: Array<[string, string]> = [
    ["GET", "/api/messages"],
    ["GET", "/api/chats"],
    ["POST", "/api/send"],
    ["GET", "/api/download"],
    ["GET", "/events"],
    ["POST", "/mcp"],
    ["GET", "/api/context"],
    ["GET", "/api/search"],
  ];

  test("every non-health endpoint rejects a missing token with 401", async () => {
    const bridge = await startServer();
    for (const [method, path] of cases) {
      const res = await fetch(url(bridge, path), { method });
      expect(res.status, `${method} ${path}`).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code, `${method} ${path}`).toBe("UNAUTHORIZED");
    }
  });

  test("every non-health endpoint rejects a wrong token with 401", async () => {
    const bridge = await startServer();
    for (const [method, path] of cases) {
      const res = await fetch(url(bridge, path), {
        method,
        headers: { authorization: "Bearer wrong-token" },
      });
      expect(res.status, `${method} ${path}`).toBe(401);
      const body = (await res.json()) as { error: { code: string } };
      expect(body.error.code, `${method} ${path}`).toBe("UNAUTHORIZED");
    }
  });

  test("non-bearer schemes are rejected", async () => {
    const bridge = await startServer();
    const res = await fetch(url(bridge, "/api/chats"), {
      headers: { authorization: "Basic dXNlcjpwYXNz" },
    });
    expect(res.status).toBe(401);
  });
});

test("a valid token passes auth and reaches the not-yet-wired route", async () => {
  const bridge = await startServer();
  const res = await fetch(url(bridge, "/api/messages"), {
    headers: { authorization: "Bearer test-token" },
  });
  expect(res.status).toBe(501);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe("NOT_IMPLEMENTED");
});

test("unknown authenticated route returns 404", async () => {
  const bridge = await startServer();
  const res = await fetch(url(bridge, "/api/unknown"), {
    headers: { authorization: "Bearer test-token" },
  });
  expect(res.status).toBe(404);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe("NOT_FOUND");
});

test("binds loopback by default on the requested port", async () => {
  const bridge = await startServer({ port: 0 });
  expect(bridge.port).toBeGreaterThan(0);
  const res = await fetch(url(bridge, "/health"));
  expect(res.status).toBe(200);
});

test("bodies over 1MB are rejected with 413 before routing", async () => {
  const bridge = await startServer();
  const big = Buffer.alloc(1_000_001 + 64, 0x61);
  const res = await fetch(url(bridge, "/api/send"), {
    method: "POST",
    headers: { authorization: "Bearer test-token" },
    body: big,
  });
  expect(res.status).toBe(413);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe("PAYLOAD_TOO_LARGE");
});

test("bodies at exactly 1MB pass the limit", async () => {
  const bridge = await startServer();
  const big = Buffer.alloc(1_000_000, 0x61);
  const res = await fetch(url(bridge, "/api/send"), {
    method: "POST",
    headers: { authorization: "Bearer test-token" },
    body: big,
  });
  expect(res.status).not.toBe(413);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
});

test("token bucket returns 429 with Retry-After when exhausted", async () => {
  const bridge = await startServer({ rateLimit: { capacity: 2, refillPerMinute: 60 } });
  const auth = { authorization: "Bearer test-token" };
  const first = await fetch(url(bridge, "/api/messages"), { headers: auth });
  const second = await fetch(url(bridge, "/api/messages"), { headers: auth });
  expect(first.status).toBe(501);
  expect(second.status).toBe(501);
  const third = await fetch(url(bridge, "/api/messages"), { headers: auth });
  expect(third.status).toBe(429);
  expect(third.headers.get("retry-after")).toBe("1");
  const body = (await third.json()) as { error: { code: string } };
  expect(body.error.code).toBe("RATE_LIMITED");
});

test("buckets refill over time", async () => {
  const bridge = await startServer({ rateLimit: { capacity: 1, refillPerMinute: 6000 } });
  const auth = { authorization: "Bearer test-token" };
  expect((await fetch(url(bridge, "/api/messages"), { headers: auth })).status).toBe(501);
  expect((await fetch(url(bridge, "/api/messages"), { headers: auth })).status).toBe(429);
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect((await fetch(url(bridge, "/api/messages"), { headers: auth })).status).toBe(501);
});

test("/api/qr requires auth", async () => {
  const bridge = await startServer();
  const res = await fetch(url(bridge, "/api/qr"));
  expect(res.status).toBe(401);
});

test("/api/qr returns 404 NO_QR when no qr was seen", async () => {
  const bridge = await startServer();
  const res = await fetch(url(bridge, "/api/qr"), { headers: authHeader });
  expect(res.status).toBe(404);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe("NO_QR");
});

test("/api/qr returns the qr string and base64 png once available", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-mcp-qr-http-"));
  const pngPath = join(dir, "qr.png");
  await saveQrPng("QRDATA-rotation-1", pngPath);
  const bridge = await createHttpServer(stubHandle("qr", "QRDATA-rotation-1"), {
    token: "test-token",
    qrPngPath: pngPath,
    qrDir: dir,
  });
  created.push(bridge);
  const res = await fetch(url(bridge, "/api/qr"), { headers: authHeader });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { qr: string; png: string };
  expect(body.qr).toBe("QRDATA-rotation-1");
  const fileBytes = await readFile(pngPath);
  expect(Buffer.from(body.png, "base64")).toEqual(fileBytes);
});

test("/api/qr serves named files from qrDir", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-mcp-qr-http-"));
  const second = join(dir, "qr-2.png");
  await saveQrPng("QRDATA-rotation-2", second);
  const bridge = await createHttpServer(stubHandle("qr", "QRDATA-rotation-1"), {
    token: "test-token",
    qrPngPath: join(dir, "qr.png"),
    qrDir: dir,
  });
  created.push(bridge);
  const res = await fetch(url(bridge, "/api/qr?file=qr-2.png"), { headers: authHeader });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { qr: string; png: string };
  expect(Buffer.from(body.png, "base64")).toEqual(await readFile(second));
});

test("/api/qr rejects path traversal with 400", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-mcp-qr-http-"));
  const secretDir = await mkdtemp(join(tmpdir(), "wa-mcp-qr-secret-"));
  const outside = join(secretDir, "secret.txt");
  await writeFile(outside, "secret");
  const bridge = await createHttpServer(stubHandle("qr", "QRDATA-rotation-1"), {
    token: "test-token",
    qrPngPath: join(dir, "qr.png"),
    qrDir: dir,
  });
  created.push(bridge);
  const attempts: Array<[string, string]> = [
    [`/api/qr?file=${encodeURIComponent("../secret.txt")}`, "plain dots"],
    ["/api/qr?file=..%2Fsecret.txt", "pre-encoded traversal"],
    ["/api/qr?file=%2e%2e%2fsecret.txt", "encoded-dot traversal"],
    [`/api/qr?file=${encodeURIComponent("..\\secret.txt")}`, "backslash"],
    [`/api/qr?file=${encodeURIComponent("a/b.png")}`, "nested name"],
  ];
  for (const [attemptUrl, label] of attempts) {
    const res = await fetch(url(bridge, attemptUrl), { headers: authHeader });
    expect(res.status, label).toBe(400);
    const body = (await res.json()) as { error: { code: string } };
    expect(body.error.code, label).toBe("INVALID_PATH");
  }
  const missing = await fetch(url(bridge, "/api/qr?file=does-not-exist.png"), {
    headers: authHeader,
  });
  expect(missing.status).toBe(404);
  const missingBody = (await missing.json()) as { error: { code: string } };
  expect(missingBody.error.code).toBe("NOT_FOUND");
});

test("GET /api/chats returns chats with previews and honors filters", async () => {
  const bridge = await bootWithStore((store) => {
    seedRow(store, "A1", GROUP_A, 1000, "older in A");
    seedRow(store, "A2", GROUP_A, 2000, "newest in A");
    seedRow(store, "B1", GROUP_B, 1500, "only in B");
    store.db.prepare("UPDATE messages SET is_unread = 0 WHERE id = 'A1'").run();
  });
  const res = await fetch(url(bridge, "/api/chats"), { headers: authHeader });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    chats: Array<{ jid: string; unreadCount: number; lastMessage: { text: string } | null }>;
  };
  expect(body.chats.map((chat) => chat.jid)).toEqual([GROUP_A, GROUP_B]);
  expect(body.chats[0]?.unreadCount).toBe(1);
  expect(body.chats[0]?.lastMessage?.text).toBe("newest in A");
  const limited = await fetch(url(bridge, "/api/chats?limit=1"), { headers: authHeader });
  const limitedBody = (await limited.json()) as { chats: unknown[] };
  expect(limitedBody.chats).toHaveLength(1);
  const noPreview = await fetch(url(bridge, "/api/chats?include_last_message=false"), {
    headers: authHeader,
  });
  const noPreviewBody = (await noPreview.json()) as { chats: Array<{ lastMessage: unknown }> };
  expect(noPreviewBody.chats[0]?.lastMessage).toBeNull();
});

test("GET /api/messages filters by chat and instants with clamped pagination", async () => {
  const bridge = await bootWithStore((store) => {
    seedRow(store, "A1", GROUP_A, 1000, "one");
    seedRow(store, "A2", GROUP_A, 2000, "two");
    seedRow(store, "B1", GROUP_B, 3000, "other");
  });
  const all = await fetch(url(bridge, `/api/messages?chat_jid=${encodeURIComponent(GROUP_A)}`), {
    headers: authHeader,
  });
  const allBody = (await all.json()) as {
    messages: Array<{ id: string; chatJid: string; isUnread: boolean }>;
  };
  expect(allBody.messages.map((message) => message.id)).toEqual(["A2", "A1"]);
  expect(allBody.messages[0]?.isUnread).toBe(true);
  const after = await fetch(
    url(
      bridge,
      `/api/messages?chat_jid=${encodeURIComponent(GROUP_A)}&after=${encodeURIComponent(new Date(1500 * 1000).toISOString())}`,
    ),
    { headers: authHeader },
  );
  const afterBody = (await after.json()) as { messages: Array<{ id: string }> };
  expect(afterBody.messages.map((message) => message.id)).toEqual(["A2"]);
  const clamped = await fetch(
    url(bridge, `/api/messages?chat_jid=${encodeURIComponent(GROUP_A)}&limit=1&offset=-9`),
    {
      headers: authHeader,
    },
  );
  const clampedBody = (await clamped.json()) as { messages: Array<{ id: string }> };
  expect(clampedBody.messages.map((message) => message.id)).toEqual(["A2"]);
});

test("GET /api/messages validates parameter shapes", async () => {
  const bridge = await bootWithStore(() => {});
  const badDate = await fetch(
    url(bridge, `/api/messages?chat_jid=${encodeURIComponent(GROUP_A)}&after=yesterday`),
    {
      headers: authHeader,
    },
  );
  expect(badDate.status).toBe(400);
  const badDateBody = (await badDate.json()) as { error: { code: string } };
  expect(badDateBody.error.code).toBe("VALIDATION_ERROR");
  const badLimit = await fetch(url(bridge, "/api/messages?limit=many"), { headers: authHeader });
  expect(badLimit.status).toBe(400);
  const badLimitBody = (await badLimit.json()) as { error: { code: string } };
  expect(badLimitBody.error.code).toBe("VALIDATION_ERROR");
  const badOffset = await fetch(url(bridge, "/api/messages?offset=soon"), { headers: authHeader });
  expect(badOffset.status).toBe(400);
});

test("GET /api/context returns the adjacent window including the target", async () => {
  const bridge = await bootWithStore((store) => {
    for (const [id, ts] of [
      ["T1", 1000],
      ["T2", 2000],
      ["T3", 3000],
      ["T4", 4000],
    ] as const) {
      seedRow(store, id, GROUP_A, ts, `msg ${id}`);
    }
  });
  const res = await fetch(url(bridge, "/api/context?message_id=T2&radius=1"), {
    headers: authHeader,
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { messages: Array<{ id: string }> };
  expect(body.messages.map((message) => message.id)).toEqual(["T1", "T2", "T3"]);
  const missing = await fetch(url(bridge, "/api/context?message_id=NOPE"), { headers: authHeader });
  expect(missing.status).toBe(404);
  const noParam = await fetch(url(bridge, "/api/context"), { headers: authHeader });
  expect(noParam.status).toBe(400);
  const noParamBody = (await noParam.json()) as { error: { code: string } };
  expect(noParamBody.error.code).toBe("VALIDATION_ERROR");
});

test("GET /api/search returns matches and requires a query", async () => {
  const bridge = await bootWithStore((store) => {
    seedRow(store, "S1", GROUP_A, 1000, "pizza night");
    seedRow(store, "S2", GROUP_B, 2000, "burger time");
  });
  const res = await fetch(url(bridge, "/api/search?q=pizza"), { headers: authHeader });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { messages: Array<{ id: string }> };
  expect(body.messages.map((message) => message.id)).toEqual(["S1"]);
  const scoped = await fetch(
    url(bridge, `/api/search?q=burger&chat_jid=${encodeURIComponent(GROUP_B)}`),
    {
      headers: authHeader,
    },
  );
  const scopedBody = (await scoped.json()) as { messages: Array<{ id: string }> };
  expect(scopedBody.messages.map((message) => message.id)).toEqual(["S2"]);
  const missing = await fetch(url(bridge, "/api/search"), { headers: authHeader });
  expect(missing.status).toBe(400);
  const missingBody = (await missing.json()) as { error: { code: string } };
  expect(missingBody.error.code).toBe("VALIDATION_ERROR");
});

test("POST /api/send dispatches, persists and returns the message id", async () => {
  const socket = makeFakeSocket();
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const bridge = await createHttpServer(stubHandle("connected", null, socket), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
  });
  created.push(bridge);
  const res = await fetch(url(bridge, "/api/send"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ chat_jid: "+358 497 773 518", text: "hello there" }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { message_id: string };
  expect(body.message_id).toBe("SENTID1");
  const row = store.db.prepare("SELECT * FROM messages").get() as Record<string, unknown>;
  expect(row.is_from_me).toBe(1);
  expect(row.is_unread).toBe(0);
  expect(row.content).toBe("hello there");
  expect(row.chat_jid).toBe("358497773518@s.whatsapp.net");
});

test("POST /api/send validates the body", async () => {
  const bridge = await bootWithStore(() => {});
  const missingChat = await fetch(url(bridge, "/api/send"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ text: "no chat" }),
  });
  expect(missingChat.status).toBe(400);
  expect(((await missingChat.json()) as { error: { code: string } }).error.code).toBe(
    "VALIDATION_ERROR",
  );
  const missingText = await fetch(url(bridge, "/api/send"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ chat_jid: "+358497773518" }),
  });
  expect(missingText.status).toBe(400);
  const malformed = await fetch(url(bridge, "/api/send"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: "{not json",
  });
  expect(malformed.status).toBe(400);
});

test("POST /api/send surfaces guard pacing as 429 with retryAfterMs", async () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const bridge = await createHttpServer(stubHandle(), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 60_000, dailyCap: 10 }),
  });
  created.push(bridge);
  const send = (text: string) =>
    fetch(url(bridge, "/api/send"), {
      method: "POST",
      headers: { ...authHeader, "content-type": "application/json" },
      body: JSON.stringify({ chat_jid: "358497773518@s.whatsapp.net", text }),
    });
  expect((await send("first")).status).toBe(200);
  const second = await send("second");
  expect(second.status).toBe(429);
  const body = (await second.json()) as { error: { code: string; retryAfterMs: number } };
  expect(body.error.code).toBe("RATE_LIMITED");
  expect(body.error.retryAfterMs).toBeGreaterThan(0);
});

test("POST /api/send surfaces the daily cap as 429", async () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const bridge = await createHttpServer(stubHandle(), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 1 }),
  });
  created.push(bridge);
  const send = (text: string) =>
    fetch(url(bridge, "/api/send"), {
      method: "POST",
      headers: { ...authHeader, "content-type": "application/json" },
      body: JSON.stringify({ chat_jid: "358497773518@s.whatsapp.net", text }),
    });
  expect((await send("only one")).status).toBe(200);
  const second = await send("blocked");
  expect(second.status).toBe(429);
  expect(((await second.json()) as { error: { code: string } }).error.code).toBe(
    "DAILY_CAP_EXCEEDED",
  );
});

test("POST /api/send honors the kill switch", async () => {
  process.env.WA_SENDS_DISABLED = "1";
  const socket = makeFakeSocket();
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const bridge = await createHttpServer(stubHandle("connected", null, socket), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
  });
  created.push(bridge);
  const res = await fetch(url(bridge, "/api/send"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ chat_jid: "358497773518@s.whatsapp.net", text: "hi" }),
  });
  expect(res.status).toBe(403);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("SENDS_DISABLED");
  expect(socket.sendMessage as ReturnType<typeof vi.fn>).not.toHaveBeenCalled();
});

test("POST /api/send reports media payloads as not yet implemented", async () => {
  const bridge = await bootWithStore(() => {});
  const res = await fetch(url(bridge, "/api/send"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({
      chat_jid: "358497773518@s.whatsapp.net",
      text: "with media",
      media: { kind: "image", base64: "aGk=" },
    }),
  });
  expect(res.status).toBe(501);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NOT_IMPLEMENTED");
});
