import { mkdtemp, readFile, symlink, writeFile } from "node:fs/promises";
import { mkdirSync, mkdtempSync, statSync, writeFileSync } from "node:fs";
import { request as httpRequest } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeAll, describe, expect, test, vi } from "vite-plus/test";
import type { WASocket } from "baileys";
import { createEventBus } from "../src/events.ts";
import { createHttpServer, type BridgeHttp, type HttpServerOptions } from "../src/http.ts";

// real ports + real sqlite + real fs: under CI/loaded machines the 5s default
// flakes (whole file can take 200s wall). Nothing here legitimately needs >20s.
vi.setConfig({ testTimeout: 20_000 });
import type { BridgeHandle, BridgeStatus } from "../src/lifecycle.ts";
import { saveQrPng } from "../src/qr.ts";
import { openStore, type Store } from "../src/store/schema.ts";
import { listMessages } from "../src/store/queries.ts";
import { SendGuard } from "../src/send/safety.ts";
import { setAlias, upsertContact } from "../src/store/contacts.ts";

const POSIX_PERMS = process.platform !== "win32";
import { storeMessage } from "../src/store/messages.ts";

const created: BridgeHttp[] = [];
const openedStores: Store[] = [];
const mediaDirs: string[] = [];
const authHeader = { authorization: "Bearer test-token" };
const GROUP_A = "120363428874442773@g.us";
const GROUP_B = "120363999999999999@g.us";

function makeFakeSocket(): WASocket {
  const sendMessage = vi.fn(async (jid: string, content: unknown) => {
    // emulate the engine: generateWAMessageContent turns inputs into protos —
    // {text} → extendedTextMessage; {image|video|...} → <kind>Message
    const mediaProto: Record<string, string> = {
      image: "imageMessage",
      video: "videoMessage",
      audio: "audioMessage",
      document: "documentMessage",
      sticker: "stickerMessage",
    };
    const mediaKey = Object.keys(mediaProto).find(
      (key) => key in (content as Record<string, unknown>),
    );
    const message =
      (content as { text?: string }).text !== undefined
        ? { extendedTextMessage: { text: (content as { text: string }).text } }
        : mediaKey !== undefined
          ? {
              [mediaProto[mediaKey] as string]: {
                caption: (content as { caption?: string }).caption,
                mimetype: (content as { mimetype?: string }).mimetype,
              },
            }
          : content;
    return {
      key: { remoteJid: jid, fromMe: true, id: "SENTID1" },
      message,
    };
  });
  const readMessages = vi.fn(async () => {});
  const sendPresenceUpdate = vi.fn(async () => {});
  const requestPairingCode = vi.fn(async () => "ABCD1234");
  const updateProfileName = vi.fn(async () => {});
  const updateProfileStatus = vi.fn(async () => {});
  const updateProfilePicture = vi.fn(async () => {});
  const updateReadReceiptsPrivacy = vi.fn(async () => {});
  const updateBlockStatus = vi.fn(async () => {});
  const fetchBlocklist = vi.fn(async () => ["999@s.whatsapp.net"]);
  return {
    sendMessage,
    readMessages,
    sendPresenceUpdate,
    requestPairingCode,
    updateProfileName,
    updateProfileStatus,
    updateProfilePicture,
    updateReadReceiptsPrivacy,
    updateBlockStatus,
    fetchBlocklist,
    user: { jid: "358497773518@s.whatsapp.net" },
  } as unknown as WASocket;
}

function stubHandle(
  status: BridgeStatus = "connected",
  lastQr: string | null = null,
  socket: WASocket = makeFakeSocket(),
  hasPairedAccount = false,
  budget = { blocked: false, used: 0, limit: 3 },
): BridgeHandle {
  let current = budget;
  return {
    status,
    events: createEventBus(),
    close: async () => {},
    getLastQr: () => lastQr,
    socket,
    hasPairedAccount: () => hasPairedAccount,
    pairingBudget: () => current,
    resumePairing: () => {
      current = { blocked: false, used: 0, limit: current.limit };
    },
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
  delete process.env.WA_SENDS_DISABLED;
  for (const bridge of created.splice(0)) {
    await bridge.close();
  }
  for (const store of openedStores.splice(0)) {
    store.close();
  }
  mediaDirs.splice(0);
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
  const mediaDir = mkdtempSync(join(tmpdir(), "wa-mcp-http-media-"));
  mediaDirs.push(mediaDir);
  const bridge = await createHttpServer(stubHandle("connected"), {
    token: "test-token",
    store,
    mediaDir,
  });
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

test("health reports reconnecting WITHOUT a paired account as not logged in (T44)", async () => {
  // QR-pool recovery flaps through "reconnecting" with zero credentials on
  // disk — that is "not logged out", never "logged in" (misled debugging twice).
  const bridge = await createHttpServer(stubHandle("reconnecting"), { token: "test-token" });
  created.push(bridge);
  const body = (await (await fetch(url(bridge, "/health"))).json()) as Record<string, unknown>;
  expect(body.status).toBe("reconnecting");
  expect(body.connected).toBe(false);
  expect(body.loggedIn).toBe(false);
});

test("health reports reconnecting WITH a completed pairing as logged in (T44)", async () => {
  // creds.account is set only by configureSuccessfulPairing (real pair-success),
  // never by requestPairingCode — the pollution-safe "past pairing" signal.
  const bridge = await createHttpServer(stubHandle("reconnecting", null, undefined, true), {
    token: "test-token",
  });
  created.push(bridge);
  const body = (await (await fetch(url(bridge, "/health"))).json()) as Record<string, unknown>;
  expect(body.status).toBe("reconnecting");
  expect(body.loggedIn).toBe(true);
});

test("health reports qr as not logged in regardless of account state (T44)", async () => {
  const bridge = await createHttpServer(stubHandle("qr", "QRDATA", undefined, true), {
    token: "test-token",
  });
  created.push(bridge);
  const body = (await (await fetch(url(bridge, "/health"))).json()) as Record<string, unknown>;
  expect(body.status).toBe("qr");
  expect(body.loggedIn).toBe(false);
});

test("health leaks no other data", async () => {
  const bridge = await startServer();
  const body = (await (await fetch(url(bridge, "/health"))).json()) as Record<string, unknown>;
  expect(Object.keys(body).sort()).toEqual(
    [
      "channel",
      "connected",
      "loggedIn",
      "pairingAttempts",
      "pairingBlocked",
      "pairingToken",
      "status",
      "uptime",
      "version",
    ].sort(),
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
    ["POST", "/api/read"],
    ["POST", "/api/presence"],
    ["POST", "/api/chat/state"],
    ["GET", "/api/contacts"],
    ["GET", "/api/unread"],
    ["POST", "/api/alias"],
    ["POST", "/api/profile"],
    ["POST", "/api/profile/picture"],
    ["POST", "/api/privacy"],
    ["POST", "/api/block"],
    ["GET", "/api/blocklist"],
    ["GET", "/api/notifications"],
    ["POST", "/api/notifications"],
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

test("token bucket returns 429 with Retry-After when exhausted", { timeout: 15_000 }, async () => {
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
  let clock = 1_000_000;
  const base = await startServer({
    rateLimit: { capacity: 1, refillPerMinute: 6000 },
    rateLimitNow: () => clock,
  });
  const auth = { authorization: "Bearer test-token" };
  expect((await fetch(url(base, "/api/messages"), { headers: auth })).status).toBe(501);
  expect((await fetch(url(base, "/api/messages"), { headers: auth })).status).toBe(429);
  clock += 100;
  expect((await fetch(url(base, "/api/messages"), { headers: auth })).status).toBe(501);
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

test("/api/qr?file= allows ONLY qr.png (T73 Grok C2 allowlist)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-mcp-qr-http-"));
  const second = join(dir, "qr-2.png");
  await saveQrPng("QRDATA-rotation-2", second);
  await saveQrPng("QRDATA-rotation-1", join(dir, "qr.png"));
  const bridge = await createHttpServer(stubHandle("qr", "QRDATA-rotation-1"), {
    token: "test-token",
    qrPngPath: join(dir, "qr.png"),
    qrDir: dir,
  });
  created.push(bridge);
  const res = await fetch(url(bridge, "/api/qr?file=qr-2.png"), { headers: authHeader });
  expect(res.status).toBe(400);
  const body = (await res.json()) as { error: { code: string } };
  expect(body.error.code).toBe("INVALID_PATH");
  // the allowlisted name still serves
  const good = await fetch(url(bridge, "/api/qr?file=qr.png"), { headers: authHeader });
  expect(good.status).toBe(200);
});

test("/api/qr?file=token never leaks a neighbouring token file (T73 Grok C2)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-mcp-qr-http-"));
  await writeFile(join(dir, "token"), "SECRET-DAEMON-TOKEN");
  const bridge = await createHttpServer(stubHandle("qr", "QRDATA-rotation-1"), {
    token: "test-token",
    qrPngPath: join(dir, "qr.png"),
    qrDir: dir,
  });
  created.push(bridge);
  const res = await fetch(url(bridge, "/api/qr?file=token"), { headers: authHeader });
  expect(res.status).toBe(400);
  const text = await res.text();
  expect(text).not.toContain("SECRET-DAEMON-TOKEN");
});

test("/api/qr?file=qr.png refuses a symlink pointing outside qrDir (T73 Grok C2)", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-mcp-qr-http-"));
  const secretDir = await mkdtemp(join(tmpdir(), "wa-mcp-qr-secret-"));
  const outside = join(secretDir, "secret.txt");
  await writeFile(outside, "OUTSIDE-SECRET");
  await symlink(outside, join(dir, "qr.png"));
  const bridge = await createHttpServer(stubHandle("qr", "QRDATA-rotation-1"), {
    token: "test-token",
    qrPngPath: join(dir, "qr.png"),
    qrDir: dir,
  });
  created.push(bridge);
  const res = await fetch(url(bridge, "/api/qr?file=qr.png"), { headers: authHeader });
  expect(res.status).toBe(403);
  const text = await res.text();
  expect(text).not.toContain("OUTSIDE-SECRET");
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
  // T73 Grok C2: the allowlist rejects ANY name other than qr.png before
  // existence is even considered
  const missing = await fetch(url(bridge, "/api/qr?file=does-not-exist.png"), {
    headers: authHeader,
  });
  expect(missing.status).toBe(400);
  const missingBody = (await missing.json()) as { error: { code: string } };
  expect(missingBody.error.code).toBe("INVALID_PATH");
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

test("POST /api/send rejects media on a non-media kind", async () => {
  const bridge = await bootWithStore(() => {});
  const res = await fetch(url(bridge, "/api/send"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({
      chat_jid: "358497773518@s.whatsapp.net",
      text: "with media",
      media: { base64: "aGk=" },
    }),
  });
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
});

test("POST /api/send kind=image sends, stores the file and links the row", async () => {
  const socket = makeFakeSocket();
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const mediaDir = mkdtempSync(join(tmpdir(), "wa-mcp-http-media-"));
  mediaDirs.push(mediaDir);
  const bridge = await createHttpServer(stubHandle("connected", null, socket), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
    mediaDir,
  });
  created.push(bridge);
  const png = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");
  const res = await fetch(url(bridge, "/api/send"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({
      kind: "image",
      chat_jid: "358497773518@s.whatsapp.net",
      media: { base64: png.toString("base64") },
      caption: "the pic",
      file_name: "shot.png",
    }),
  });
  expect(res.status).toBe(200);
  const arg = (socket.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
    image?: Buffer;
    caption?: string;
    fileName?: string;
    mimetype?: string;
  };
  expect(Buffer.isBuffer(arg.image)).toBe(true);
  expect(arg.image?.equals(png)).toBe(true);
  expect(arg.caption).toBe("the pic");
  expect(arg.fileName).toBe("shot.png");
  expect(arg.mimetype).toBe("image/png");
  const row = store.db.prepare("SELECT * FROM messages").get() as Record<string, unknown>;
  expect(row.media_type).toBe("image");
  const mediaPath = typeof row.media_path === "string" ? row.media_path : "";
  expect(mediaPath.endsWith(`SENTID1.png`)).toBe(true);
  if (POSIX_PERMS) {
    expect(statSync(mediaPath).mode & 0o777).toBe(0o644);
    expect(statSync(mediaDir).mode & 0o777).toBe(0o700);
  }
  expect(row.content).toBe("the pic");
});

test("POST /api/send media path traversal is rejected", async () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const mediaDir = mkdtempSync(join(tmpdir(), "wa-mcp-http-media-"));
  mediaDirs.push(mediaDir);
  const bridge = await createHttpServer(stubHandle(), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
    mediaDir,
  });
  created.push(bridge);
  const res = await fetch(url(bridge, "/api/send"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({
      kind: "document",
      chat_jid: "358497773518@s.whatsapp.net",
      media: { path: "../secret.txt" },
    }),
  });
  expect(res.status).toBe(400);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("PATH_FORBIDDEN");
});

test("POST /api/send media url uses the injected fetcher", async () => {
  const socket = makeFakeSocket();
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const mediaDir = mkdtempSync(join(tmpdir(), "wa-mcp-http-media-"));
  mediaDirs.push(mediaDir);
  const jpeg = Buffer.from("ffd8ffe000104a464946", "hex");
  const fetchFn = (async () => new Response(jpeg)) as unknown as typeof fetch;
  const bridge = await createHttpServer(stubHandle("connected", null, socket), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
    mediaDir,
    fetchFn,
    lookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
  });
  created.push(bridge);
  const res = await fetch(url(bridge, "/api/send"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({
      kind: "image",
      chat_jid: "358497773518@s.whatsapp.net",
      media: { url: "https://cdn.example/cat.jpg" },
    }),
  });
  expect(res.status).toBe(200);
  const arg = (socket.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
    image?: Buffer;
  };
  expect(arg.image?.equals(jpeg)).toBe(true);
});

test("an unresolvable jid fails as INVALID_JID even when the guard would pace", async () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const bridge = await createHttpServer(stubHandle(), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 60_000, dailyCap: 10 }),
  });
  created.push(bridge);
  const send = (chatJid: string, text: string) =>
    fetch(url(bridge, "/api/send"), {
      method: "POST",
      headers: { ...authHeader, "content-type": "application/json" },
      body: JSON.stringify({ chat_jid: chatJid, text }),
    });
  expect((await send("358497773518@s.whatsapp.net", "first")).status).toBe(200);
  const bad = await send("garbage@@@", "should fail as invalid jid");
  expect(bad.status).toBe(400);
  expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("INVALID_JID");
});

test("the outbound row keeps the sent text even when the socket return omits it", async () => {
  const sendMessage = vi.fn(async (jid: string) => ({
    key: { remoteJid: jid, fromMe: true, id: "SENTID1" },
  }));
  const socket = { sendMessage } as unknown as WASocket;
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
    body: JSON.stringify({ chat_jid: "358497773518@s.whatsapp.net", text: "persisted text" }),
  });
  expect(res.status).toBe(200);
  const row = store.db.prepare("SELECT * FROM messages").get() as Record<string, unknown>;
  expect(row.content).toBe("persisted text");
});

test("the outbound sender is not recorded as the recipient", async () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const bridge = await createHttpServer(stubHandle(), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
  });
  created.push(bridge);
  await fetch(url(bridge, "/api/send"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ chat_jid: "358497773518@s.whatsapp.net", text: "to myself" }),
  });
  const row = store.db.prepare("SELECT * FROM messages").get() as Record<string, unknown>;
  expect(row.sender_jid ?? null).toBeNull();
});

async function postSend(
  bridge: BridgeHttp,
  body: Record<string, unknown>,
): Promise<{
  status: number;
  body: Record<string, unknown> & { error?: { code?: string } };
}> {
  const res = await fetch(url(bridge, "/api/send"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

test("POST /api/send routes kind=reaction through the socket", async () => {
  const socket = makeFakeSocket();
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const bridge = await createHttpServer(stubHandle("connected", null, socket), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
  });
  created.push(bridge);
  const { status } = await postSend(bridge, {
    kind: "reaction",
    chat_jid: "358497773518@s.whatsapp.net",
    message_id: "TARGET9",
    emote: "🔥",
  });
  expect(status).toBe(200);
  const call = (socket.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
    react?: { text?: string; key?: { id?: string } };
  };
  expect(call.react?.text).toBe("🔥");
  expect(call.react?.key?.id).toBe("TARGET9");
});

test("POST /api/send routes kind=edit through the socket", async () => {
  const socket = makeFakeSocket();
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const bridge = await createHttpServer(stubHandle("connected", null, socket), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
  });
  created.push(bridge);
  const { status } = await postSend(bridge, {
    kind: "edit",
    chat_jid: "358497773518@s.whatsapp.net",
    message_id: "TARGET9",
    text: "corrected",
  });
  expect(status).toBe(200);
  const call = (socket.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
    edit?: { id?: string };
    text?: string;
  };
  expect(call.edit?.id).toBe("TARGET9");
  expect(call.text).toBe("corrected");
});

test("POST /api/send routes kind=forward from the store", async () => {
  const socket = makeFakeSocket();
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  seedRow(store, "FWD1", GROUP_A, 5000, "spread this");
  const bridge = await createHttpServer(stubHandle("connected", null, socket), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
  });
  created.push(bridge);
  const { status, body } = await postSend(bridge, {
    kind: "forward",
    chat_jid: "358497773518@s.whatsapp.net",
    message_id: "FWD1",
  });
  expect(status).toBe(200);
  expect(body.message_id).toBe("SENTID1");
  const call = (socket.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
    forward?: { key?: { id?: string }; message?: { conversation?: string } };
  };
  expect((call.forward as { key?: { id?: string } } | undefined)?.key?.id).toBe("FWD1");
  expect(
    (call.forward as { message?: { conversation?: string } } | undefined)?.message?.conversation,
  ).toBe("spread this");
  const missing = await postSend(bridge, {
    kind: "forward",
    chat_jid: "358497773518@s.whatsapp.net",
    message_id: "NOPE",
  });
  expect(missing.status).toBe(404);
});

test("POST /api/send routes location, contact and poll kinds", async () => {
  const socket = makeFakeSocket();
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const bridge = await createHttpServer(stubHandle("connected", null, socket), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 30 }),
  });
  created.push(bridge);
  const location = await postSend(bridge, {
    kind: "location",
    chat_jid: "358497773518@s.whatsapp.net",
    latitude: 60.17,
    longitude: 24.94,
    label: "Kallio",
  });
  expect(location.status).toBe(200);
  const contact = await postSend(bridge, {
    kind: "contact",
    chat_jid: "358497773518@s.whatsapp.net",
    contact_name: "John Doe",
    phones: ["+15551234567"],
  });
  expect(contact.status).toBe(200);
  const poll = await postSend(bridge, {
    kind: "poll",
    chat_jid: "358497773518@s.whatsapp.net",
    poll_name: "Lunch?",
    options: ["Pizza", "Burger"],
    selectable_count: 1,
  });
  expect(poll.status).toBe(200);
  const sent = (socket.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
  expect((sent[0]?.[1] as { location?: { name?: string } }).location?.name).toBe("Kallio");
  expect((sent[1]?.[1] as { contacts?: { displayName?: string } }).contacts?.displayName).toBe(
    "John Doe",
  );
  const pollArg = sent[2]?.[1] as { poll?: { name?: string } };
  expect(pollArg.poll?.name).toBe("Lunch?");
});

test("POST /api/send validates per-kind fields and rejects unknown kinds", async () => {
  const bridge = await bootWithStore(() => {});
  const noEmote = await postSend(bridge, {
    kind: "reaction",
    chat_jid: "358497773518@s.whatsapp.net",
    message_id: "X",
  });
  expect(noEmote.status).toBe(400);
  expect(noEmote.body.error?.code).toBe("VALIDATION_ERROR");
  const badOptions = await postSend(bridge, {
    kind: "poll",
    chat_jid: "358497773518@s.whatsapp.net",
    poll_name: "L?",
    options: "pizza",
  });
  expect(badOptions.status).toBe(400);
  const unknown = await postSend(bridge, {
    kind: "teleport",
    chat_jid: "358497773518@s.whatsapp.net",
    text: "hi",
  });
  expect(unknown.status).toBe(400);
  expect(unknown.body.error?.code).toBe("VALIDATION_ERROR");
});

test("POST /mcp answers JSON-RPC over HTTP", async () => {
  const bridge = await bootWithStore(() => {});
  const res = await fetch(url(bridge, "/mcp"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    jsonrpc: string;
    id: number;
    result: {
      protocolVersion: string;
      capabilities: { tools: Record<string, unknown> };
      serverInfo: { name: string };
    };
  };
  expect(body.jsonrpc).toBe("2.0");
  expect(body.id).toBe(1);
  expect(body.result.capabilities).toEqual({ tools: {}, resources: {} });
  expect(body.result.serverInfo.name).toBe("wa-mcp");
});

test("POST /mcp tools/call reaches the bridge api over loopback", async () => {
  const bridge = await bootWithStore((store) => {
    seedRow(store, "C1", GROUP_A, 1000, "context for mcp");
  });
  const res = await fetch(url(bridge, "/mcp"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "list_messages", arguments: { chat_jid: GROUP_A, limit: 10 } },
    }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as {
    result: { content: Array<{ type: string; text: string }> };
  };
  expect(body.result.content[0]?.type).toBe("text");
  const messages = JSON.parse(body.result.content[0]?.text ?? "{}") as {
    messages: Array<{ id: string }>;
  };
  expect(messages.messages.map((message) => message.id)).toEqual(["C1"]);
});

test("POST /mcp reports parse errors in-band", async () => {
  const bridge = await bootWithStore(() => {});
  const res = await fetch(url(bridge, "/mcp"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: "{not json",
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { id: null; error: { code: number } };
  expect(body.id).toBeNull();
  expect(body.error.code).toBe(-32700);
});

test("POST /api/read marks rows and sends the receipt", async () => {
  const socket = makeFakeSocket();
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  seedRow(store, "R1", GROUP_A, 1000, "unread one");
  seedRow(store, "R2", GROUP_A, 2000, "unread two");
  const bridge = await createHttpServer(stubHandle("connected", null, socket), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
  });
  created.push(bridge);
  const res = await fetch(url(bridge, "/api/read"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ chat_jid: GROUP_A, message_ids: ["R1", "R2"] }),
  });
  expect(res.status).toBe(200);
  const unread = store.db
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE chat_jid = ? AND is_unread = 1")
    .get(GROUP_A) as {
    n: number;
  };
  expect(unread.n).toBe(0);
  const call = (socket.readMessages as ReturnType<typeof vi.fn>).mock.calls[0]?.[0] as Array<{
    id: string;
  }>;
  expect(call.map((key) => key.id)).toEqual(["R1", "R2"]);
});

test("POST /api/presence sends the presence type", async () => {
  const socket = makeFakeSocket();
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const bridge = await createHttpServer(stubHandle("connected", null, socket), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
  });
  created.push(bridge);
  const res = await fetch(url(bridge, "/api/presence"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ chat_jid: GROUP_A, presence: "composing" }),
  });
  expect(res.status).toBe(200);
  const call = (socket.sendPresenceUpdate as ReturnType<typeof vi.fn>).mock.calls[0];
  expect(call?.[0]).toBe("composing");
  expect(call?.[1]).toBe(GROUP_A);
  const invalid = await fetch(url(bridge, "/api/presence"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ chat_jid: GROUP_A, presence: "teleporting" }),
  });
  expect(invalid.status).toBe(400);
  expect(((await invalid.json()) as { error: { code: string } }).error.code).toBe(
    "VALIDATION_ERROR",
  );
});

test("POST /api/chat/state persists chat flags", async () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  seedRow(store, "A1", GROUP_A, 1000, "hello");
  const bridge = await createHttpServer(stubHandle(), { token: "test-token", store });
  created.push(bridge);
  const res = await fetch(url(bridge, "/api/chat/state"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({
      chat_jid: GROUP_A,
      archived: true,
      pinned: true,
      muted_until: "2026-10-03T12:00:00.000Z",
    }),
  });
  expect(res.status).toBe(200);
  const row = store.db
    .prepare("SELECT archived, pinned, muted_until FROM chats WHERE jid = ?")
    .get(GROUP_A) as { archived: number; pinned: number; muted_until: string } | undefined;
  expect(row?.archived).toBe(1);
  expect(row?.pinned).toBe(1);
  expect(row?.muted_until).toBe("2026-10-03T12:00:00.000Z");
});

test("GET /api/contacts searches contacts", async () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  upsertContact(store, { jid: "358461111111@s.whatsapp.net", name: "John Doe" });
  upsertContact(store, { jid: "358462222222@s.whatsapp.net", name: "Jane" });
  const bridge = await createHttpServer(stubHandle(), { token: "test-token", store });
  created.push(bridge);
  const all = await fetch(url(bridge, "/api/contacts"), { headers: authHeader });
  const allBody = (await all.json()) as { contacts: Array<{ name: string | null }> };
  expect(allBody.contacts).toHaveLength(2);
  const search = await fetch(url(bridge, "/api/contacts?query=john"), { headers: authHeader });
  const searchBody = (await search.json()) as { contacts: Array<{ name: string | null }> };
  expect(searchBody.contacts.map((contact) => contact.name)).toEqual(["John Doe"]);
});

test("GET /api/unread returns nonzero counts", async () => {
  const bridge = await bootWithStore((store) => {
    seedRow(store, "A1", GROUP_A, 1000, "one");
    seedRow(store, "A2", GROUP_A, 2000, "two");
    seedRow(store, "B1", GROUP_B, 3000, "three");
  });
  const res = await fetch(url(bridge, "/api/unread"), { headers: authHeader });
  const body = (await res.json()) as { unread: Array<{ chatJid: string; unreadCount: number }> };
  expect(body.unread).toEqual([
    { chatJid: GROUP_B, unreadCount: 1 },
    { chatJid: GROUP_A, unreadCount: 2 },
  ]);
});

test("POST /api/alias remembers a jid", async () => {
  const bridge = await bootWithStore(() => {});
  const res = await fetch(url(bridge, "/api/alias"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ alias: "me", jid: "358497773518@s.whatsapp.net" }),
  });
  expect(res.status).toBe(200);
});

test("POST /api/profile updates name and status", async () => {
  const socket = makeFakeSocket();
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const bridge = await createHttpServer(stubHandle("connected", null, socket), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
  });
  created.push(bridge);
  const res = await fetch(url(bridge, "/api/profile"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ name: "New Name", status: "new about" }),
  });
  expect(res.status).toBe(200);
  const call = socket.updateProfileName as ReturnType<typeof vi.fn>;
  expect(call).toHaveBeenCalledWith("New Name");
  expect(socket.updateProfileStatus as ReturnType<typeof vi.fn>).toHaveBeenCalledWith("new about");
});

test("POST /api/profile/picture uploads the decoded image", async () => {
  const socket = makeFakeSocket();
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const bridge = await createHttpServer(stubHandle("connected", null, socket), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
  });
  created.push(bridge);
  const png = Buffer.from("89504e470d0a1a0a", "hex");
  const res = await fetch(url(bridge, "/api/profile/picture"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ image_base64: png.toString("base64") }),
  });
  expect(res.status).toBe(200);
  const call = (socket.updateProfilePicture as ReturnType<typeof vi.fn>).mock.calls[0];
  expect(call?.[0]).toBe("358497773518@s.whatsapp.net");
  expect((call?.[1] as Buffer).equals(png)).toBe(true);
});

test("POST /api/privacy applies keys and rejects unsupported ones", async () => {
  const socket = makeFakeSocket();
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const bridge = await createHttpServer(stubHandle("connected", null, socket), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
  });
  created.push(bridge);
  const res = await fetch(url(bridge, "/api/privacy"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ readReceipts: "none" }),
  });
  expect(res.status).toBe(200);
  const applied = (await res.json()) as { applied: Array<{ key: string; value: string }> };
  expect(applied.applied).toEqual([{ key: "readReceipts", value: "none" }]);
  const bad = await fetch(url(bridge, "/api/privacy"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ visibility: "all" }),
  });
  expect(bad.status).toBe(400);
  expect(((await bad.json()) as { error: { code: string } }).error.code).toBe("VALIDATION_ERROR");
});

test("POST /api/block and GET /api/blocklist work", async () => {
  const socket = makeFakeSocket();
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const bridge = await createHttpServer(stubHandle("connected", null, socket), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
  });
  created.push(bridge);
  const res = await fetch(url(bridge, "/api/block"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ jid: "999@s.whatsapp.net", block: true }),
  });
  expect(res.status).toBe(200);
  expect(socket.updateBlockStatus as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
    "999@s.whatsapp.net",
    "block",
  );
  const list = await fetch(url(bridge, "/api/blocklist"), { headers: authHeader });
  const listBody = (await list.json()) as { blocklist: string[] };
  expect(listBody.blocklist).toEqual(["999@s.whatsapp.net"]);
});

const MEDIA_PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

vi.mock("baileys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("baileys")>();
  const downloadMediaMessage = async (message: {
    message?: Record<string, unknown>;
  }): Promise<Buffer> => {
    const content = message.message ?? {};
    const hasMedia =
      content.imageMessage !== undefined ||
      content.videoMessage !== undefined ||
      content.audioMessage !== undefined ||
      content.documentMessage !== undefined ||
      content.stickerMessage !== undefined;
    if (!hasMedia) {
      throw new Error("message is not a media message");
    }
    return MEDIA_PNG;
  };
  return { ...actual, downloadMediaMessage };
});

test("POST /api/media/{id} downloads and returns metadata; GET streams the file", async () => {
  const socket = makeFakeSocket();
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const mediaDir = mkdtempSync(join(tmpdir(), "wa-mcp-http-media-"));
  mediaDirs.push(mediaDir);
  const message = {
    key: {
      remoteJid: GROUP_A,
      fromMe: false,
      id: "PIC1",
      participant: "358401112222@s.whatsapp.net",
    },
    message: { imageMessage: { caption: "shot", url: "https://x/1.png" } },
    messageTimestamp: 1000,
    pushName: "Vasilisa",
  } as never;
  storeMessage(store, message);
  const bridge = await createHttpServer(stubHandle("connected", null, socket), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
    mediaDir,
  });
  created.push(bridge);
  const post = await fetch(url(bridge, "/api/media/PIC1"), { method: "POST", headers: authHeader });
  expect(post.status).toBe(200);
  const meta = (await post.json()) as { path: string; mime: string; size: number };
  expect(meta.mime).toBe("image/png");
  expect(meta.path.endsWith("PIC1.png")).toBe(true);
  const get = await fetch(url(bridge, "/api/media/PIC1"), { headers: authHeader });
  expect(get.status).toBe(200);
  expect(get.headers.get("content-type")).toBe("image/png");
  expect(Buffer.from(await get.arrayBuffer()).equals(MEDIA_PNG)).toBe(true);
});

test("POST /api/media/{id} without downloadable media answers 404", async () => {
  const bridge = await bootWithStore((store) => {
    seedRow(store, "TXT1", GROUP_A, 1000, "plain text");
  });
  const res = await fetch(url(bridge, "/api/media/TXT1"), { method: "POST", headers: authHeader });
  expect(res.status).toBe(404);
  expect(((await res.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
});

test("media endpoints sanitize the message id", async () => {
  const bridge = await bootWithStore(() => {});
  for (const bad of ["..%2Fevil", "a%2Fb", "a.b.c"]) {
    const post = await fetch(url(bridge, `/api/media/${bad}`), {
      method: "POST",
      headers: authHeader,
    });
    expect(post.status, bad).toBe(400);
    expect(((await post.json()) as { error: { code: string } }).error.code, bad).toBe(
      "PATH_FORBIDDEN",
    );
    const get = await fetch(url(bridge, `/api/media/${bad}`), { headers: authHeader });
    expect(get.status, bad).toBe(400);
  }
  const unknown = await fetch(url(bridge, "/api/media/UNKNOWNID"), {
    method: "POST",
    headers: authHeader,
  });
  expect(unknown.status).toBe(404);
});

test(
  "GET /events streams bus events as SSE and cleans up on disconnect",
  { timeout: 15_000 },
  async () => {
    let active = 0;
    const base = createEventBus();
    const spyBus: typeof base = {
      ...base,
      subscribe: (handler) => {
        active += 1;
        const unsubscribe = base.subscribe(handler);
        return () => {
          active -= 1;
          unsubscribe();
        };
      },
    };
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
    openedStores.push(store);
    const bridge = await createHttpServer(
      {
        status: "connected",
        events: spyBus,
        close: async () => {},
        getLastQr: () => null,
        hasPairedAccount: () => false,
        pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
        resumePairing: () => {},
        socket: makeFakeSocket(),
      },
      { token: "test-token", store, eventsHeartbeatMs: 40 },
    );
    created.push(bridge);
    const controller = new AbortController();
    const res = await fetch(url(bridge, "/events"), {
      headers: authHeader,
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    const decoder = new TextDecoder();
    const readUntil = async (needle: string): Promise<string> => {
      let seen = "";
      const deadline = Date.now() + 2000;
      while (Date.now() < deadline) {
        const chunk = await reader.read();
        if (chunk.done) break;
        seen += decoder.decode(chunk.value);
        if (seen.includes(needle)) {
          return seen;
        }
      }
      return seen;
    };
    base.emit({
      type: "messages.upsert",
      payload: { messages: [], type: "notify" },
    });
    const first = await readUntil("messages.upsert");
    expect(first).toContain("data:");
    base.emit({ type: "presence.update", payload: { id: "x", presences: {} } });
    const second = await readUntil("presence.update");
    expect(second).toContain("presence.update");
    controller.abort();
    await new Promise((resolve) => setTimeout(resolve, 100));
    expect(active).toBe(0);
    expect(() =>
      base.emit({ type: "presence.update", payload: { id: "x", presences: {} } }),
    ).not.toThrow();
  },
);

test("GET /events fans out to multiple concurrent clients", async () => {
  const base = createEventBus();
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const bridge = await createHttpServer(
    {
      status: "connected",
      events: base,
      close: async () => {},
      getLastQr: () => null,
      hasPairedAccount: () => false,
      pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
      resumePairing: () => {},
      socket: makeFakeSocket(),
    },
    { token: "test-token", store },
  );
  created.push(bridge);
  const readers: Array<ReadableStreamDefaultReader<Uint8Array>> = [];
  for (let index = 0; index < 2; index += 1) {
    const res = await fetch(url(bridge, "/events"), { headers: authHeader });
    const reader = res.body?.getReader();
    if (!reader) throw new Error("no body");
    readers.push(reader);
  }
  // T73 H2: creds.update no longer streams — fan out with a safe event
  base.emit({ type: "chats.upsert", payload: [] });
  for (const reader of readers) {
    const decoder = new TextDecoder();
    let seen = "";
    const deadline = Date.now() + 2000;
    while (Date.now() < deadline && !seen.includes("chats.upsert")) {
      const chunk = await reader.read();
      if (chunk.done) break;
      seen += decoder.decode(chunk.value);
    }
    expect(seen).toContain("chats.upsert");
    // T73 H2: the filtered event must never fan out
    expect(seen).not.toContain("creds.update");
    await reader.cancel();
  }
});

test("GET /events sends heartbeats on the configured interval", async () => {
  const base = createEventBus();
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const bridge = await createHttpServer(
    {
      status: "connected",
      events: base,
      close: async () => {},
      getLastQr: () => null,
      hasPairedAccount: () => false,
      pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
      resumePairing: () => {},
      socket: makeFakeSocket(),
    },
    { token: "test-token", store, eventsHeartbeatMs: 30 },
  );
  created.push(bridge);
  const res = await fetch(url(bridge, "/events"), { headers: authHeader });
  const reader = res.body?.getReader();
  if (!reader) throw new Error("no body");
  const decoder = new TextDecoder();
  let seen = "";
  const deadline = Date.now() + 2000;
  while (Date.now() < deadline && !seen.includes("heartbeat")) {
    const chunk = await reader.read();
    if (chunk.done) break;
    seen += decoder.decode(chunk.value);
  }
  expect(seen).toContain("heartbeat");
  await reader.cancel();
});

test("notification rule CRUD end to end", async () => {
  const bridge = await bootWithStore(() => {});
  const created_ = await fetch(url(bridge, "/api/notifications"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ title: "ping {{sender}}", chat_jid: GROUP_A, unread_only: true }),
  });
  expect(created_.status).toBe(200);
  const rule = (await created_.json()) as {
    rule: { id: number; chatJid: string; unreadOnly: boolean };
  };
  expect(rule.rule.chatJid).toBe(GROUP_A);
  expect(rule.rule.unreadOnly).toBe(true);
  const list = await fetch(url(bridge, "/api/notifications"), { headers: authHeader });
  const listBody = (await list.json()) as { rules: Array<{ id: number }> };
  expect(listBody.rules).toHaveLength(1);
  const missingTitle = await fetch(url(bridge, "/api/notifications"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ chat_jid: GROUP_A }),
  });
  expect(missingTitle.status).toBe(400);
  const removed = await fetch(url(bridge, `/api/notifications/${rule.rule.id}`), {
    method: "DELETE",
    headers: authHeader,
  });
  expect(removed.status).toBe(200);
  const gone = await fetch(url(bridge, `/api/notifications/${rule.rule.id}`), {
    method: "DELETE",
    headers: authHeader,
  });
  expect(gone.status).toBe(404);
  const empty = await fetch(url(bridge, "/api/notifications"), { headers: authHeader });
  expect(((await empty.json()) as { rules: unknown[] }).rules).toHaveLength(0);
});

function groupSocket(): WASocket {
  const fns = {
    groupCreate: vi.fn(async () => ({
      id: "120363888888888888@g.us",
      subject: "Test Group",
      participants: [],
    })),
    groupLeave: vi.fn(async () => {}),
    groupUpdateSubject: vi.fn(async () => {}),
    groupUpdateDescription: vi.fn(async () => {}),
    groupParticipantsUpdate: vi.fn(async () => [
      { status: "200", jid: "358401111111@s.whatsapp.net" },
    ]),
    groupSettingUpdate: vi.fn(async () => {}),
    groupInviteCode: vi.fn(async () => "CODE123"),
    groupFetchAllParticipating: vi.fn(async () => ({})),
  };
  return fns as unknown as WASocket;
}

test("group endpoints drive the engine", async () => {
  const socket = groupSocket();
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const bridge = await createHttpServer(stubHandle("connected", null, socket), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
  });
  created.push(bridge);

  const createdGroup = await fetch(url(bridge, "/api/group/create"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ subject: "Test Group", participants: ["358401111111@s.whatsapp.net"] }),
  });
  expect(createdGroup.status).toBe(200);
  expect(((await createdGroup.json()) as { group: { id: string } }).group.id).toBe(
    "120363888888888888@g.us",
  );
  expect(socket.groupCreate as ReturnType<typeof vi.fn>).toHaveBeenCalledWith("Test Group", [
    "358401111111@s.whatsapp.net",
  ]);

  const participants = await fetch(url(bridge, "/api/group/participants"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({
      group_jid: "120363888888888888@g.us",
      jids: ["358401111111@s.whatsapp.net"],
      action: "promote",
    }),
  });
  expect(participants.status).toBe(200);
  expect(socket.groupParticipantsUpdate as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
    "120363888888888888@g.us",
    ["358401111111@s.whatsapp.net"],
    "promote",
  );

  const meta = await fetch(url(bridge, "/api/group/meta"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({
      group_jid: "120363888888888888@g.us",
      subject: "New Subject",
      description: "desc",
    }),
  });
  expect(meta.status).toBe(200);
  expect(socket.groupUpdateSubject as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
    "120363888888888888@g.us",
    "New Subject",
  );
  expect(socket.groupUpdateDescription as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
    "120363888888888888@g.us",
    "desc",
  );

  const settings = await fetch(url(bridge, "/api/group/settings"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ group_jid: "120363888888888888@g.us", setting: "announcement" }),
  });
  expect(settings.status).toBe(200);
  expect(socket.groupSettingUpdate as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
    "120363888888888888@g.us",
    "announcement",
  );

  const invite = await fetch(url(bridge, "/api/group/invite/120363888888888888@g.us"), {
    headers: authHeader,
  });
  expect(invite.status).toBe(200);
  expect(((await invite.json()) as { invite_code: string }).invite_code).toBe("CODE123");

  const leave = await fetch(url(bridge, "/api/group/leave"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ group_jid: "120363888888888888@g.us" }),
  });
  expect(leave.status).toBe(200);
  expect(socket.groupLeave as ReturnType<typeof vi.fn>).toHaveBeenCalledWith(
    "120363888888888888@g.us",
  );

  const badParticipants = await fetch(url(bridge, "/api/group/participants"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ group_jid: "g@g.us", jids: ["x"], action: "teleport" }),
  });
  expect(badParticipants.status).toBe(400);
  const badSettings = await fetch(url(bridge, "/api/group/settings"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ group_jid: "g@g.us", setting: "louder" }),
  });
  expect(badSettings.status).toBe(400);
});

test("POST /api/transcribe downloads if needed, caches and returns the transcript", async () => {
  const socket = makeFakeSocket();
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const mediaDir = mkdtempSync(join(tmpdir(), "wa-mcp-http-media-"));
  mediaDirs.push(mediaDir);
  storeMessage(store, {
    key: {
      remoteJid: GROUP_A,
      fromMe: false,
      id: "VOICE1",
      participant: "358401112222@s.whatsapp.net",
    },
    message: { audioMessage: { url: "https://mmg.example/1.oga", mimetype: "audio/ogg" } },
    messageTimestamp: 1000,
    pushName: "Vasilisa",
  } as never);
  const bridge = await createHttpServer(stubHandle("connected", null, socket), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
    mediaDir,
  });
  created.push(bridge);
  const res = await fetch(url(bridge, "/api/transcribe"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ message_id: "VOICE1" }),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { text: string; engine: string };
  expect(body.engine).toBe("mock");
  expect(typeof body.text).toBe("string");
  const row = store.db.prepare("SELECT media_path FROM messages WHERE id = 'VOICE1'").get() as {
    media_path: string;
  };
  expect(row.media_path).not.toBeNull();
  const again = await fetch(url(bridge, "/api/transcribe"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ message_id: "VOICE1" }),
  });
  const againBody = (await again.json()) as { text: string };
  expect(againBody.text).toBe(body.text);
  const transcript = store.db
    .prepare("SELECT text FROM transcripts WHERE message_id = 'VOICE1' AND engine = 'mock'")
    .get() as { text: string };
  expect(transcript.text).toBe(body.text);
  const missing = await fetch(url(bridge, "/api/transcribe"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ message_id: "NOPE" }),
  });
  expect(missing.status).toBe(404);
});

test("POST /api/tts synthesizes and optionally sends as voice", async () => {
  const socket = makeFakeSocket();
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const mediaDir = mkdtempSync(join(tmpdir(), "wa-mcp-http-media-"));
  mediaDirs.push(mediaDir);
  const bridge = await createHttpServer(stubHandle("connected", null, socket), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
    mediaDir,
  });
  created.push(bridge);
  const synth = await fetch(url(bridge, "/api/tts"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ text: "say this" }),
  });
  expect(synth.status).toBe(200);
  const synthBody = (await synth.json()) as { audio_base64: string; mime: string };
  expect(synthBody.mime).toBe("audio/ogg");
  expect(Buffer.from(synthBody.audio_base64, "base64").length).toBeGreaterThan(16);
  const sent = await fetch(url(bridge, "/api/tts"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ text: "send this", chat_jid: "358497773518@s.whatsapp.net" }),
  });
  expect(sent.status).toBe(200);
  const sentBody = (await sent.json()) as { message_id: string };
  expect(sentBody.message_id).toBe("SENTID1");
  const call = (socket.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
    audio?: Buffer;
    ptt?: boolean;
    mimetype?: string;
  };
  expect(Buffer.isBuffer(call.audio)).toBe(true);
  expect(call.ptt).toBe(true);
  expect(call.mimetype).toBe("audio/ogg");
  const empty = await fetch(url(bridge, "/api/tts"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(empty.status).toBe(400);
});

test("GET / serves the web ui shell unauthed; assets are confined", async () => {
  const uiDir = mkdtempSync(join(tmpdir(), "wa-mcp-ui-"));
  writeFileSync(join(uiDir, "index.html"), "<html><body>wa-mcp shell</body></html>");
  mkdirSync(join(uiDir, "assets"), { recursive: true });
  writeFileSync(join(uiDir, "assets", "app.js"), "console.log(1)");
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const bridge = await createHttpServer(stubHandle(), { token: "test-token", store, uiDir });
  created.push(bridge);
  const shell = await fetch(url(bridge, "/"));
  expect(shell.status).toBe(200);
  expect(shell.headers.get("content-type")).toContain("text/html");
  expect(await shell.text()).toContain("wa-mcp shell");
  const asset = await fetch(url(bridge, "/assets/app.js"));
  expect(asset.status).toBe(200);
  expect(await asset.text()).toBe("console.log(1)");
  const escape = await fetch(url(bridge, "/assets/..%2F..%2Findex.html"));
  expect(escape.status).toBe(400);
  const missing = await fetch(url(bridge, "/assets/nope.js"));
  expect(missing.status).toBe(404);
  const apiStillJson = await fetch(url(bridge, "/api/nope"), { headers: authHeader });
  expect(((await apiStillJson.json()) as { error: { code: string } }).error.code).toBe("NOT_FOUND");
  const noUi = await fetch(
    url(
      await (async () => {
        const b = await createHttpServer(stubHandle(), { token: "test-token", store });
        created.push(b);
        return b;
      })(),
      "/",
    ),
  );
  expect(noUi.status).toBe(404);
});

test("POST /api/pairing-code returns the formatted code while pairing", async () => {
  const socket = makeFakeSocket();
  (
    socket as unknown as { requestPairingCode: ReturnType<typeof vi.fn>; status: string }
  ).requestPairingCode = vi.fn(async () => "ABCD1234");
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-http-send-")));
  openedStores.push(store);
  const bridge = await createHttpServer(stubHandle("qr", null, socket), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
  });
  created.push(bridge);
  const res = await fetch(url(bridge, "/api/pairing-code"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ phone: "+358 497 773 518" }),
  });
  expect(res.status).toBe(200);
  expect(((await res.json()) as { code: string }).code).toBe("ABCD-1234");
  const bad = await fetch(url(bridge, "/api/pairing-code"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ phone: "1234567" }),
  });
  expect(bad.status).toBe(400);
  const wrongState = await createHttpServer(stubHandle("connected", null, socket), {
    token: "test-token",
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
  });
  created.push(wrongState);
  const conflict = await fetch(url(wrongState, "/api/pairing-code"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ phone: "358497773518" }),
  });
  expect(conflict.status).toBe(409);
  expect(((await conflict.json()) as { error: { code: string } }).error.code).toBe("PAIRING_STATE");
});

test("health exposes the pairing budget honestly (T46)", async () => {
  const bridge = await createHttpServer(
    stubHandle("pairing-blocked", null, undefined, false, {
      blocked: true,
      used: 3,
      limit: 3,
    }),
    { token: "test-token" },
  );
  created.push(bridge);
  const body = (await (await fetch(url(bridge, "/health"))).json()) as Record<string, unknown>;
  expect(body.pairingBlocked).toBe(true);
  expect(body.pairingAttempts).toEqual({ used: 3, limit: 3 });
});

test("GET /api/qr refuses with 429 PAIRING_BLOCKED when the budget is exhausted (T46)", async () => {
  const bridge = await createHttpServer(
    stubHandle("pairing-blocked", "STALE-QR", undefined, false, {
      blocked: true,
      used: 3,
      limit: 3,
    }),
    { token: "test-token" },
  );
  created.push(bridge);
  const res = await fetch(url(bridge, "/api/qr"), {
    headers: { authorization: "Bearer test-token" },
  });
  expect(res.status).toBe(429);
  const body = (await res.json()) as { error: { code: string; message: string } };
  expect(body.error.code).toBe("PAIRING_BLOCKED");
  expect(body.error.message).toContain("cooldown");
});

test("POST /api/pair/resume resets the budget (authed, T46)", async () => {
  let resumed = 0;
  const handle = stubHandle("pairing-blocked", null, undefined, false, {
    blocked: true,
    used: 3,
    limit: 3,
  });
  const baseResume = handle.resumePairing.bind(handle);
  handle.resumePairing = () => {
    resumed += 1;
    baseResume();
  };
  const bridge = await createHttpServer(handle, { token: "test-token" });
  created.push(bridge);
  const unauthed = await fetch(url(bridge, "/api/pair/resume"), { method: "POST" });
  expect(unauthed.status).toBe(401);
  expect(resumed).toBe(0);
  const res = await fetch(url(bridge, "/api/pair/resume"), {
    method: "POST",
    headers: { authorization: "Bearer test-token" },
  });
  expect(res.status).toBe(200);
  expect(resumed).toBe(1);
  const body = (await res.json()) as { resumed: boolean; pairingAttempts: unknown };
  expect(body.resumed).toBe(true);
  expect(body.pairingAttempts).toEqual({ used: 0, limit: 3 });
});

describe("cloud channel surface (T50)", () => {
  let crypto: typeof import("node:crypto");
  const APP_SECRET = "appsecret-hex";
  const cloudHandle = stubHandle("connected");

  beforeAll(async () => {
    crypto = await import("node:crypto");
  });

  async function startCloudServer() {
    const cloudStore = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-cloud-store-")));
    openedStores.push(cloudStore);
    const { CloudApiAdapter } = await import("../src/channels/cloud/adapter.ts");
    const { readCloudConfig } = await import("../src/channels/cloud/config.ts");
    const config = readCloudConfig({
      WA_CLOUD_ACCESS_TOKEN: "tok",
      WA_CLOUD_PHONE_NUMBER_ID: "109876543210987",
      WA_CLOUD_VERIFY_TOKEN: "verify-me",
      WA_CLOUD_APP_SECRET: APP_SECRET,
    }).config!;
    const cloudAdapter = new CloudApiAdapter(config);
    const bridge = await createHttpServer(cloudHandle, {
      token: "test-token",
      store: cloudStore,
      mediaDir: mkdtempSync(join(tmpdir(), "wa-mcp-cloud-")),
      cloud: { adapter: cloudAdapter, config },
    });
    created.push(bridge);
    return { bridge, config, store: cloudStore };
  }

  test("GET /webhooks/cloud echoes hub.challenge for the right verify token", async () => {
    const { bridge, config } = await startCloudServer();
    const res = await fetch(
      url(
        bridge,
        `/webhooks/cloud?hub.mode=subscribe&hub.verify_token=${encodeURIComponent(config.verifyToken)}&hub.challenge=CHAL1`,
      ),
    );
    expect(res.status).toBe(200);
    await expect(res.text()).resolves.toBe("CHAL1");
  });

  test("GET /webhooks/cloud rejects a wrong verify token with 403", async () => {
    const { bridge } = await startCloudServer();
    const res = await fetch(
      url(bridge, "/webhooks/cloud?hub.mode=subscribe&hub.verify_token=wrong&hub.challenge=CHAL1"),
    );
    expect(res.status).toBe(403);
  });

  test("POST /webhooks/cloud stores a signed inbound message and rejects bad signatures", async () => {
    const { bridge, config, store: cloudStore } = await startCloudServer();
    const cloudRows = (id: string) =>
      listMessages(cloudStore, { chatJid: "15551234567@s.whatsapp.net", limit: 10 }).filter(
        (r) => r.id === id,
      );
    const payload = {
      object: "whatsapp_business_account",
      entry: [
        {
          changes: [
            {
              field: "messages",
              value: {
                contacts: [{ profile: { name: "V" }, wa_id: "15551234567" }],
                messages: [
                  {
                    from: "15551234567",
                    id: "wamid.store1",
                    timestamp: "1700000000",
                    type: "text",
                    text: { body: "store me" },
                  },
                ],
              },
            },
          ],
        },
      ],
    };
    const body = JSON.stringify(payload);
    const signature = `sha256=${crypto.createHmac("sha256", config.appSecret).update(body).digest("hex")}`;
    const bad = await fetch(url(bridge, "/webhooks/cloud"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": "sha256=deadbeef" },
      body,
    });
    expect(bad.status).toBe(403);
    const good = await fetch(url(bridge, "/webhooks/cloud"), {
      method: "POST",
      headers: { "content-type": "application/json", "x-hub-signature-256": signature },
      body,
    });
    expect(good.status).toBe(200);
    const rows = cloudRows("wamid.store1");
    expect(rows.some((row) => row.id === "wamid.store1" && row.content === "store me")).toBe(true);
  });

  test("/health reports the channel and cloud credential validity", async () => {
    const { bridge } = await startCloudServer();
    const body = (await (await fetch(url(bridge, "/health"))).json()) as Record<string, unknown>;
    expect(body.channel).toBe("cloud");
    expect(body.credentialsValid).toBe(true);
  });

  test("/health reports the baileys channel by default", async () => {
    const bridge = await startServer();
    const body = (await (await fetch(url(bridge, "/health"))).json()) as Record<string, unknown>;
    expect(body.channel).toBe("baileys");
    expect(body.credentialsValid).toBeUndefined();
  });
});

test("/events accepts a token query param so EventSource can connect (T52)", async () => {
  const bridge = await startServer();
  const controller = new AbortController();
  try {
    const res = await fetch(url(bridge, "/events?token=test-token"), { signal: controller.signal });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    controller.abort();
  } finally {
    controller.abort();
  }
  const wrong = await fetch(url(bridge, "/events?token=wrong-token"));
  expect(wrong.status).toBe(401);
});

describe("T53 pairing token", () => {
  test("/health carries an ephemeral pairingToken", async () => {
    const bridge = await startServer();
    const body = (await (await fetch(url(bridge, "/health"))).json()) as Record<string, unknown>;
    expect(typeof body.pairingToken).toBe("string");
    expect((body.pairingToken as string).length).toBeGreaterThanOrEqual(32);
  });

  test("pairingToken opens the pairing endpoints without the session token", async () => {
    const bridge = await startServer();
    const health = (await (await fetch(url(bridge, "/health"))).json()) as Record<string, unknown>;
    const pairingToken = health.pairingToken as string;
    const qr = await fetch(url(bridge, "/api/qr"), {
      headers: { authorization: `Bearer ${pairingToken}` },
    });
    expect(qr.status).not.toBe(401);
    const resume = await fetch(url(bridge, "/api/pair/resume"), {
      method: "POST",
      headers: { authorization: `Bearer ${pairingToken}` },
    });
    expect(resume.status).toBe(200);
  });

  test("pairingToken is scoped: no account reads, no destructive/config mutations (T73 C1)", async () => {
    const bridge = await startServer();
    const health = (await (await fetch(url(bridge, "/health"))).json()) as Record<string, unknown>;
    const chats = await fetch(url(bridge, "/api/chats"), {
      headers: { authorization: `Bearer ${health.pairingToken as string}` },
    });
    expect(chats.status).toBe(401);
    const privacy = await fetch(url(bridge, "/api/privacy"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${health.pairingToken as string}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ privacy_key: "read_receipts", value: "none" }),
    });
    expect(privacy.status).toBe(401);
  });

  test("the session token still works on pairing endpoints", async () => {
    const bridge = await startServer();
    const qr = await fetch(url(bridge, "/api/qr"), {
      headers: { authorization: "Bearer test-token" },
    });
    expect(qr.status).not.toBe(401);
  });
});

describe("T73 C1: ephemeral UI token scope — pairing surface only", () => {
  function uiToken(bridge: Awaited<ReturnType<typeof startServer>>): Promise<string> {
    return (async () => {
      const health = (await (await fetch(url(bridge, "/health"))).json()) as {
        pairingToken: string;
      };
      return health.pairingToken;
    })();
  }

  test("ui token reads NO account data (chats 401)", async () => {
    const bridge = await startServer();
    const token = await uiToken(bridge);
    const res = await fetch(url(bridge, "/api/chats"), {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(401);
  });

  test("ui token may NOT send or mark read (messaging needs the session token)", async () => {
    const bridge = await startServer();
    const token = await uiToken(bridge);
    const send = await fetch(url(bridge, "/api/send"), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ chat_jid: "1@s.whatsapp.net", text: "x" }),
    });
    expect(send.status).toBe(401);
    const read = await fetch(url(bridge, "/api/read"), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ chat_jid: "1@s.whatsapp.net", message_ids: ["m1"] }),
    });
    expect(read.status).toBe(401);
  });

  test("ui token is REFUSED for destructive/config mutations", async () => {
    const bridge = await startServer();
    const token = await uiToken(bridge);
    const cases: Array<[string, string, string]> = [
      ["/api/block", "POST", JSON.stringify({ chat_jid: "1@s.whatsapp.net", block: true })],
      ["/api/privacy", "POST", JSON.stringify({ privacy_key: "read_receipts", value: "none" })],
      ["/api/profile", "POST", JSON.stringify({ name: "x" })],
      ["/api/group/leave", "POST", JSON.stringify({ group_jid: "1@g.us" })],
      ["/api/group/create", "POST", JSON.stringify({ subject: "x", participants: [] })],
    ];
    for (const [path, method, body] of cases) {
      const res = await fetch(url(bridge, path), {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body,
      });
      expect(res.status).toBe(401);
    }
    const del = await fetch(url(bridge, "/api/notifications/rule-1"), {
      method: "DELETE",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(del.status).toBe(401);
  });

  test("the session token keeps full access", async () => {
    const bridge = await startServer();
    const res = await fetch(url(bridge, "/api/privacy"), {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ privacy_key: "read_receipts", value: "all" }),
    });
    expect(res.status).not.toBe(401);
  });
});

test("send failures are LOGGED before the 500 (T56: silent failures forbidden)", async () => {
  const errors: Array<unknown> = [];
  const logger = { error: (obj: unknown) => errors.push(obj), warn: () => {}, info: () => {} };
  const socket = makeFakeSocket();
  (socket.sendMessage as ReturnType<typeof vi.fn>).mockRejectedValue(
    new Error("NoMatchingSessions failed to send"),
  );
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-sendlog-")));
  openedStores.push(store);
  const bridge = await createHttpServer(stubHandle("connected", null, socket), {
    token: "test-token",
    store,
    mediaDir: mkdtempSync(join(tmpdir(), "wa-mcp-sendlog-media-")),
    sendGuard: new SendGuard(store),
    logger,
  });
  created.push(bridge);
  const res = await fetch(url(bridge, "/api/send"), {
    method: "POST",
    headers: { authorization: "Bearer test-token", "content-type": "application/json" },
    body: JSON.stringify({ chat_jid: "1@s.whatsapp.net", text: "x" }),
  });
  const bodyText = await res.text();
  console.log("501 body:", bodyText);
  expect(res.status).toBe(500);
  expect(errors.length).toBeGreaterThan(0);
  const first = errors[0] as { err?: { message?: string } };
  expect(first.err?.message).toContain("NoMatchingSessions");
});

describe("T57 wire content shapes (AnyMessageContent, engine dispatch)", () => {
  async function makeWireServer(): Promise<{
    bridge: Awaited<ReturnType<typeof startServer>>;
    socket: WASocket;
  }> {
    const socket = makeFakeSocket();
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-wire-")));
    openedStores.push(store);
    const bridge = await createHttpServer(stubHandle("connected", null, socket), {
      token: "test-token",
      store,
      mediaDir: mkdtempSync(join(tmpdir(), "wa-mcp-wire-media-")),
      sendGuard: new SendGuard(store),
    });
    created.push(bridge);
    return { bridge, socket };
  }
  function wireContent(socket: WASocket): Record<string, unknown> {
    const calls = (socket.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
    return (calls[calls.length - 1]?.[1] ?? {}) as Record<string, unknown>;
  }
  async function post(
    bridge: Awaited<ReturnType<typeof startServer>>,
    body: unknown,
  ): Promise<Response> {
    return fetch(url(bridge, "/api/send"), {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify(body),
    });
  }

  test("text sends {text} — not a built proto conversation", async () => {
    const { bridge, socket } = await makeWireServer();
    const res = await post(bridge, { chat_jid: "1@s.whatsapp.net", text: "hi" });
    expect(res.status).toBe(200);
    const content = wireContent(socket);
    expect(content.text).toBe("hi");
    expect(content.conversation).toBeUndefined();
  });

  test("reaction sends {react: {key, text}}", async () => {
    const { bridge, socket } = await makeWireServer();
    await post(bridge, {
      chat_jid: "1@s.whatsapp.net",
      kind: "reaction",
      message_id: "m1",
      emote: "👍",
    });
    const content = wireContent(socket);
    expect((content.react as { text?: string })?.text).toBe("👍");
    expect((content.react as { key?: { id?: string } })?.key?.id).toBe("m1");
    expect(content.reactionMessage).toBeUndefined();
  });

  test("edit sends {edit: key, text}", async () => {
    const { bridge, socket } = await makeWireServer();
    await post(bridge, {
      chat_jid: "1@s.whatsapp.net",
      kind: "edit",
      message_id: "m1",
      text: "edited",
    });
    const content = wireContent(socket);
    expect((content.edit as { id?: string })?.id).toBe("m1");
    expect(content.text).toBe("edited");
    expect(content.protocolMessage).toBeUndefined();
  });

  test("forward sends {forward: <original message>}", async () => {
    const socket = makeFakeSocket();
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-wire-fwd-")));
    openedStores.push(store);
    seedRow(store, "m1", "1@s.whatsapp.net", 1, "original");
    const bridge = await createHttpServer(stubHandle("connected", null, socket), {
      token: "test-token",
      store,
      sendGuard: new SendGuard(store),
    });
    created.push(bridge);
    const res = await post(bridge, {
      chat_jid: "1@s.whatsapp.net",
      kind: "forward",
      message_id: "m1",
    });
    expect(res.status).toBe(200);
    const content = wireContent(socket);
    expect((content.forward as { key?: { id?: string } })?.key?.id).toBe("m1");
    expect(content.forwardedMessage).toBeUndefined();
  });

  test("location sends {location: {degreesLatitude, degreesLongitude, name}}", async () => {
    const { bridge, socket } = await makeWireServer();
    await post(bridge, {
      chat_jid: "1@s.whatsapp.net",
      kind: "location",
      latitude: 60.17,
      longitude: 24.94,
      label: "home",
    });
    const content = wireContent(socket);
    const location = content.location as { degreesLatitude?: number; name?: string } | undefined;
    expect(location?.degreesLatitude).toBe(60.17);
    expect(location?.name).toBe("home");
    expect(content.locationMessage).toBeUndefined();
  });

  test("contact sends {contacts: {displayName, contacts: [{vcard}]}}", async () => {
    const { bridge, socket } = await makeWireServer();
    await post(bridge, {
      chat_jid: "1@s.whatsapp.net",
      kind: "contact",
      contact_name: "V",
      phones: ["+358123"],
    });
    const content = wireContent(socket);
    const contacts = content.contacts as {
      displayName?: string;
      contacts?: Array<{ vcard?: string }>;
    };
    expect(contacts?.displayName).toBe("V");
    expect(contacts?.contacts?.[0]?.vcard).toContain("VCARD");
    expect(content.contactMessage).toBeUndefined();
  });

  test("poll sends {poll: {name, values}}", async () => {
    const { bridge, socket } = await makeWireServer();
    await post(bridge, {
      chat_jid: "1@s.whatsapp.net",
      kind: "poll",
      poll_name: "Lunch?",
      options: ["a", "b"],
    });
    const content = wireContent(socket);
    const poll = content.poll as { name?: string; values?: string[] } | undefined;
    expect(poll?.name).toBe("Lunch?");
    expect(poll?.values).toEqual(["a", "b"]);
    expect(content.pollCreationMessageV3).toBeUndefined();
  });
});

describe("T62 delete_message", () => {
  async function deleteServer(): Promise<{
    bridge: Awaited<ReturnType<typeof startServer>>;
    socket: WASocket;
    store: Store;
  }> {
    const socket = makeFakeSocket();
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-del-")));
    openedStores.push(store);
    seedRow(store, "TARGET5", "351930017568@s.whatsapp.net", 1, "delete me");
    const bridge = await createHttpServer(stubHandle("connected", null, socket), {
      token: "test-token",
      store,
      sendGuard: new SendGuard(store),
    });
    created.push(bridge);
    return { bridge, socket, store };
  }

  test("POST /api/delete sends a revoke and tombstones the local row", async () => {
    const { bridge, socket, store } = await deleteServer();
    const res = await fetch(url(bridge, "/api/delete"), {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ chat_jid: "351930017568@s.whatsapp.net", message_id: "TARGET5" }),
    });
    expect(res.status).toBe(200);
    const content = (socket.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[1] as {
      delete?: { remoteJid?: string; id?: string; fromMe?: boolean };
    };
    expect(content.delete?.remoteJid).toBe("351930017568@s.whatsapp.net");
    expect(content.delete?.id).toBe("TARGET5");
    expect(content.delete?.fromMe).toBe(false);
    const row = store.db
      .prepare("SELECT deleted, content FROM messages WHERE id = ?")
      .get("TARGET5") as { deleted: number; content: string };
    expect(row.deleted).toBe(1);
    expect(row.content).toBe("[revoked]");
  });

  test("POST /api/delete 404s an unknown message", async () => {
    const { bridge } = await deleteServer();
    const res = await fetch(url(bridge, "/api/delete"), {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ chat_jid: "1@s.whatsapp.net", message_id: "NOPE" }),
    });
    expect(res.status).toBe(404);
  });

  test("POST /api/delete requires the session token (destructive)", async () => {
    const { bridge } = await deleteServer();
    const store2 = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-del2-")));
    openedStores.push(store2);
    const res = await fetch(url(bridge, "/api/delete"), {
      method: "POST",
      headers: {
        authorization: `Bearer ${
          ((await (await fetch(url(bridge, "/health"))).json()) as { pairingToken: string })
            .pairingToken
        }`,
        "content-type": "application/json",
      },
      body: JSON.stringify({ chat_jid: "1@s.whatsapp.net", message_id: "X" }),
    });
    expect(res.status).toBe(401);
  });
});

describe("T62/I GET /api/group/info (on-demand metadata fetch + persist)", () => {
  async function infoServer(): Promise<{
    bridge: Awaited<ReturnType<typeof startServer>>;
    socket: WASocket;
    store: Store;
  }> {
    const socket = makeFakeSocket();
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-ginfo-")));
    openedStores.push(store);
    Object.assign(socket, {
      groupMetadata: vi.fn(async (jid: string) => ({
        id: jid,
        subject: "Fresh Subject",
        participants: [
          { id: "358497773518@s.whatsapp.net", admin: "admin" },
          { id: "351930017568@s.whatsapp.net" },
        ],
      })),
    });
    const bridge = await createHttpServer(stubHandle("connected", null, socket), {
      token: "test-token",
      store,
      sendGuard: new SendGuard(store),
    });
    created.push(bridge);
    return { bridge, socket, store };
  }

  test("fetches fresh metadata, persists chats.name + participants, returns 200", async () => {
    const { bridge, socket, store } = await infoServer();
    const res = await fetch(url(bridge, "/api/group/info?jid=120363428874442773%40g.us"), {
      headers: { authorization: "Bearer test-token" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { subject?: string; participants?: unknown[] };
    expect(body.subject).toBe("Fresh Subject");
    expect(body.participants?.length).toBe(2);
    expect((socket.groupMetadata as ReturnType<typeof vi.fn>).mock.calls[0]?.[0]).toBe(
      "120363428874442773@g.us",
    );
    const chat = store.db
      .prepare("SELECT name FROM chats WHERE jid = ?")
      .get("120363428874442773@g.us") as { name: string };
    expect(chat.name).toBe("Fresh Subject");
    const participants = store.db
      .prepare("SELECT COUNT(*) AS n FROM group_participants WHERE group_jid = ?")
      .get("120363428874442773@g.us") as { n: number };
    expect(participants.n).toBe(2);
  });

  test("GET /api/group/info without a jid is a validation error", async () => {
    const { bridge } = await infoServer();
    const res = await fetch(url(bridge, "/api/group/info"), {
      headers: { authorization: "Bearer test-token" },
    });
    expect(res.status).toBe(400);
  });
});

describe("T65 alias resolution on sends", () => {
  test("POST /api/send with an alias chat_jid resolves and sends to the mapped jid", async () => {
    const socket = makeFakeSocket();
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-alias-send-")));
    openedStores.push(store);
    setAlias(store, "351930017568@s.whatsapp.net", "vasilisa");
    const bridge = await createHttpServer(stubHandle("connected", null, socket), {
      token: "test-token",
      store,
      sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
    });
    created.push(bridge);
    const res = await fetch(url(bridge, "/api/send"), {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ chat_jid: "vasilisa", text: "via alias" }),
    });
    expect(res.status).toBe(200);
    const jid = (socket.sendMessage as ReturnType<typeof vi.fn>).mock.calls[0]?.[0];
    expect(jid).toBe("351930017568@s.whatsapp.net");
    const row = store.db.prepare("SELECT chat_jid FROM messages WHERE id = ?").get("SENTID1") as {
      chat_jid: string;
    };
    expect(row.chat_jid).toBe("351930017568@s.whatsapp.net");
  });

  test("POST /api/send with an unknown name → INVALID_JID suggesting the closest alias, nothing sent", async () => {
    const socket = makeFakeSocket();
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-alias-sug-")));
    openedStores.push(store);
    setAlias(store, "351930017568@s.whatsapp.net", "vasilisa");
    const bridge = await createHttpServer(stubHandle("connected", null, socket), {
      token: "test-token",
      store,
      sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
    });
    created.push(bridge);
    const res = await fetch(url(bridge, "/api/send"), {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ chat_jid: "vasil", text: "should not send" }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error: { code: string; message: string } };
    expect(body.error.code).toBe("INVALID_JID");
    expect(body.error.message).toContain("vasilisa");
    expect((socket.sendMessage as ReturnType<typeof vi.fn>).mock.calls.length).toBe(0);
  });

  test("POST /api/read resolves an alias chat_jid", async () => {
    const socket = makeFakeSocket();
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-alias-read-")));
    openedStores.push(store);
    seedRow(store, "R1", "351930017568@s.whatsapp.net", 1, "x");
    setAlias(store, "351930017568@s.whatsapp.net", "vasilisa");
    const bridge = await createHttpServer(stubHandle("connected", null, socket), {
      token: "test-token",
      store,
      sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 10 }),
    });
    created.push(bridge);
    const res = await fetch(url(bridge, "/api/read"), {
      method: "POST",
      headers: { authorization: "Bearer test-token", "content-type": "application/json" },
      body: JSON.stringify({ chat_jid: "vasilisa", message_ids: ["R1"] }),
    });
    expect(res.status).toBe(200);
  });
});

test("T68: GET /api/media/:id accepts a query token (browser <img>/<audio> cannot set headers)", async () => {
  const socket = makeFakeSocket();
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-mediaqt-")));
  openedStores.push(store);
  seedRow(store, "MEDIAQ1", "1@s.whatsapp.net", 1, "x");
  store.db
    .prepare("UPDATE messages SET media_path = ?, media_type = 'image' WHERE id = ?")
    .run(join(mkdtempSync(join(tmpdir(), "wa-mcp-mq-")), "f.png"), "MEDIAQ1");
  const mediaDir = mkdtempSync(join(tmpdir(), "wa-mcp-mediadir-"));
  writeFileSync(join(mediaDir, "f.png"), Buffer.from([137, 80, 78, 71]));
  store.db
    .prepare("UPDATE messages SET media_path = ?, media_type = 'image' WHERE id = ?")
    .run(join(mediaDir, "f.png"), "MEDIAQ1");
  const bridge = await createHttpServer(stubHandle("connected", null, socket), {
    token: "test-token",
    store,
    mediaDir,
  });
  created.push(bridge);
  const res = await fetch(url(bridge, "/api/media/MEDIAQ1?token=test-token"));
  expect(res.status).toBe(200);
  const noToken = await fetch(url(bridge, "/api/media/MEDIAQ1"));
  expect(noToken.status).toBe(401);
});

describe("T73 C1 — scoped pairing token + Host/Origin validation", () => {
  function pairingTokenOf(bridge: Awaited<ReturnType<typeof startServer>>): Promise<string> {
    return (async () => {
      const health = (await (await fetch(url(bridge, "/health"))).json()) as {
        pairingToken: string;
      };
      return health.pairingToken;
    })();
  }

  test("the ephemeral token does NOT read account data (scope reverted)", async () => {
    const bridge = await startServer();
    const token = await pairingTokenOf(bridge);
    const chats = await fetch(url(bridge, "/api/chats"), {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(chats.status).toBe(401);
    const send = await fetch(url(bridge, "/api/send"), {
      method: "POST",
      headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      body: JSON.stringify({ chat_jid: "1@s.whatsapp.net", text: "x" }),
    });
    expect(send.status).toBe(401);
  });

  test("the ephemeral token still opens the pairing surface", async () => {
    const bridge = await startServer();
    const token = await pairingTokenOf(bridge);
    const qr = await fetch(url(bridge, "/api/qr"), {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(qr.status).not.toBe(401);
    const resume = await fetch(url(bridge, "/api/pair/resume"), {
      method: "POST",
      headers: { authorization: `Bearer ${token}` },
    });
    expect(resume.status).toBe(200);
  });

  test("GET /api/ui-token exchanges the scoped token for the real one on localhost", async () => {
    const bridge = await startServer();
    const token = await pairingTokenOf(bridge);
    const res = await fetch(url(bridge, "/api/ui-token"), {
      headers: { authorization: `Bearer ${token}` },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { token: string };
    expect(body.token).not.toBe(token);
    const chats = await fetch(url(bridge, "/api/chats"), {
      headers: { authorization: `Bearer ${body.token}` },
    });
    expect(chats.status).not.toBe(401);
  });

  // fetch (undici) silently DROPS the forbidden `host` header — a forged Host
  // must go over a raw socket to actually reach the guard
  function rawGet(
    bridge: BridgeHttp,
    path: string,
    headers: Record<string, string>,
  ): Promise<number> {
    return new Promise((resolve, reject) => {
      const req = httpRequest({ host: "127.0.0.1", port: bridge.port, path, headers }, (res) => {
        res.resume();
        res.on("end", () => resolve(res.statusCode ?? 0));
      });
      req.on("error", reject);
      req.end();
    });
  }

  test("GET /api/ui-token refuses a Host that is not loopback (DNS rebinding)", async () => {
    const bridge = await startServer();
    const token = await pairingTokenOf(bridge);
    const status = await rawGet(bridge, "/api/ui-token", {
      authorization: `Bearer ${token}`,
      host: "evil.example:8080",
    });
    expect(status).toBe(403);
  });

  test("GET /api/ui-token refuses a cross-site Origin", async () => {
    const bridge = await startServer();
    const token = await pairingTokenOf(bridge);
    const res = await fetch(url(bridge, "/api/ui-token"), {
      headers: { authorization: `Bearer ${token}`, origin: "https://evil.example" },
    });
    expect(res.status).toBe(403);
  });

  test("non-loopback Host is rejected on /api routes even with the real token", async () => {
    const bridge = await startServer();
    const status = await rawGet(bridge, "/api/chats", {
      authorization: "Bearer test-token",
      host: "evil.example:8080",
    });
    expect(status).toBe(403);
  });

  test("absent Origin (non-browser) with a loopback Host is allowed", async () => {
    const bridge = await startServer();
    const res = await fetch(url(bridge, "/api/chats"), {
      headers: { authorization: "Bearer test-token" },
    });
    expect(res.status).not.toBe(403);
  });
});

describe("T73 C2 — content-security-policy on web UI responses", () => {
  function uiServer(): ReturnType<typeof startServer> {
    const uiDir = mkdtempSync(join(tmpdir(), "wa-mcp-ui-"));
    writeFileSync(join(uiDir, "index.html"), "<html><body>wa-mcp shell</body></html>");
    return startServer({ uiDir });
  }

  test("GET / ships a CSP that defaults to self", async () => {
    const bridge = await uiServer();
    const res = await fetch(url(bridge, "/"));
    expect(res.status).toBe(200);
    const csp = res.headers.get("content-security-policy") ?? "";
    expect(csp).toContain("default-src 'self'");
  });

  test("API responses carry the CSP too (defense in depth)", async () => {
    const bridge = await startServer();
    const res = await fetch(url(bridge, "/health"));
    expect(res.headers.get("content-security-policy") ?? "").toContain("default-src 'self'");
  });
});

describe("T73 C3 — no unhandled rejections from the body-read callback", () => {
  test("a throwing route handler becomes a 500 + log, not a hang", async () => {
    const errors: unknown[] = [];
    const handle = stubHandle("connected", null, makeFakeSocket(), false, {
      blocked: false,
      used: 0,
      limit: 3,
    });
    handle.resumePairing = () => {
      throw new Error("boom");
    };
    const bridge = await createHttpServer(handle, {
      token: "test-token",
      logger: {
        error: (obj) => errors.push(obj),
        warn: () => undefined,
      },
    });
    created.push(bridge);
    const res = await fetch(url(bridge, "/api/pair/resume"), {
      method: "POST",
      headers: { authorization: "Bearer test-token" },
      signal: AbortSignal.timeout(8000),
    });
    expect(res.status).toBe(500);
    expect(errors.length).toBeGreaterThan(0);
  });
});

describe("T73 H2 — SSE never streams credential-bearing events", () => {
  function streamEvents(bridge: BridgeHttp, controller: AbortController): Promise<string> {
    return (async () => {
      const res = await fetch(url(bridge, "/events?token=test-token"), {
        signal: controller.signal,
      });
      const reader = (res.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let text = "";
      try {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          text += decoder.decode(value, { stream: true });
        }
      } catch {
        // aborted — expected
      }
      return text;
    })();
  }

  test("creds.update payloads never reach the stream; safe events do", async () => {
    const handle = stubHandle();
    const bridge = await createHttpServer(handle, { token: "test-token" });
    created.push(bridge);
    const controller = new AbortController();
    const streamDone = streamEvents(bridge, controller);
    await new Promise((resolve) => setTimeout(resolve, 150));
    handle.events.emit({
      type: "creds.update",
      payload: {
        me: { id: "1:1@s.whatsapp.net", name: "x" },
        account: { details: "SECRET-ACCOUNT" },
        advSecretKey: "SECRET-ADV-KEY",
        signalIdentities: [
          { identifier: { name: "SECRET-IDENTITY", uuid: "u" }, identifierKey: null },
        ],
      },
    } as never);
    handle.events.emit({ type: "connection.update", payload: { connection: "open" } });
    await new Promise((resolve) => setTimeout(resolve, 300));
    controller.abort();
    const text = await streamDone;
    expect(text).toContain("connection.update");
    expect(text).not.toContain("creds.update");
    expect(text).not.toContain("SECRET-ADV-KEY");
    expect(text).not.toContain("SECRET-ACCOUNT");
  });
});

describe("T74 — health-poll and SSE never starve the API rate bucket", () => {
  function tightServer(): ReturnType<typeof createHttpServer> {
    return createHttpServer(stubHandle("connected"), {
      token: "test-token",
      // refill 0: deterministic — no token ever comes back mid-test
      rateLimit: { capacity: 2, refillPerMinute: 0 },
    });
  }

  test("capacity=2: two /health polls then /api/chats still reaches the route", async () => {
    const bridge = await tightServer();
    created.push(bridge);
    for (let i = 0; i < 2; i += 1) {
      const health = await fetch(url(bridge, "/health"));
      expect(health.status).toBe(200);
    }
    const chats = await fetch(url(bridge, "/api/chats"), { headers: authHeader });
    // RED today: health spent both tokens -> 429; GREEN: reaches the route (501 on the fixture)
    expect(chats.status).toBe(501);
  });

  test("capacity=2: an open SSE /events connection does not consume the bucket", async () => {
    const bridge = await tightServer();
    created.push(bridge);
    const controllers = [new AbortController(), new AbortController()];
    try {
      // both buckets spent on streams before any API call
      for (const controller of controllers) {
        const events = await fetch(url(bridge, "/events?token=test-token"), {
          signal: controller.signal,
        });
        expect(events.status).toBe(200);
      }
      const chats = await fetch(url(bridge, "/api/chats"), { headers: authHeader });
      expect(chats.status).toBe(501);
    } finally {
      for (const controller of controllers) {
        controller.abort();
      }
    }
  });

  test("the API bucket still enforces: 3rd API call at capacity=2 is 429", async () => {
    const bridge = await tightServer();
    created.push(bridge);
    expect((await fetch(url(bridge, "/api/chats"), { headers: authHeader })).status).toBe(501);
    expect((await fetch(url(bridge, "/api/chats"), { headers: authHeader })).status).toBe(501);
    const third = await fetch(url(bridge, "/api/chats"), { headers: authHeader });
    expect(third.status).toBe(429);
    const body = (await third.json()) as { error: { code: string } };
    expect(body.error.code).toBe("RATE_LIMITED");
  });
});
