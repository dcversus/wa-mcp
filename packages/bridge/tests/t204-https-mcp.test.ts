import { mkdtempSync, rmSync } from "node:fs";
import { request as httpsRequest } from "node:https";
import { connect as netConnect } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { connect as tlsConnect } from "node:tls";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { ensureLocalCert } from "@wa-mcp/shared/tls-cert";
import { createEventBus } from "../src/events.ts";
import { createHttpServer, type BridgeHttp, type HttpServerOptions } from "../src/http.ts";
import type { BridgeHandle } from "../src/lifecycle.ts";

const TOKEN = "t204-token";
const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) await fn();
});

const dir = mkdtempSync(join(tmpdir(), "wa-mcp-t204-"));
const { cert, key } = ensureLocalCert(dir);
cleanups.push(() => {});
process.on("exit", () => rmSync(dir, { recursive: true, force: true }));

function handle(): BridgeHandle {
  return {
    status: "connected",
    events: createEventBus(),
    close: async () => {},
    getLastQr: () => null,
    hasPairedAccount: () => true,
    pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
    connectionQuality: () => ({ reconnects: 0, lastDisconnectAt: null }),
    fetchHistory: async () => ({ requested: false, request_id: "" }),
    contactsWarm: () => false,
    logout: async () => {},
    resumePairing: () => {},
  } as unknown as BridgeHandle;
}

async function serve(extra: Partial<HttpServerOptions> = {}): Promise<BridgeHttp> {
  const bridge = await createHttpServer(handle(), {
    token: TOKEN,
    tls: { cert, key },
    ...extra,
  });
  cleanups.push(() => bridge.close());
  return bridge;
}

interface Reply {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: string;
}

function https(
  bridge: BridgeHttp,
  path: string,
  init: { method?: string; headers?: Record<string, string>; body?: string; ca?: string } = {},
): Promise<Reply> {
  return new Promise((resolve, reject) => {
    const req = httpsRequest(
      {
        host: "127.0.0.1",
        port: bridge.port,
        path,
        method: init.method ?? "GET",
        headers: init.headers ?? {},
        ca: init.ca ?? cert,
        agent: false,
      },
      (res) => {
        let body = "";
        res.setEncoding("utf8");
        res.on("data", (chunk: string) => (body += chunk));
        res.on("end", () => resolve({ status: res.statusCode ?? 0, headers: res.headers, body }));
      },
    );
    req.on("error", reject);
    req.end(init.body);
  });
}

const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };
const rpc = (method: string, id: number | undefined, params: unknown = {}) =>
  JSON.stringify({ jsonrpc: "2.0", ...(id === undefined ? {} : { id }), method, params });
const INIT = rpc("initialize", 1, {
  protocolVersion: "2025-06-18",
  capabilities: {},
  clientInfo: { name: "t204", version: "0" },
});

test("the same port answers both plain HTTP and TLS", async () => {
  const bridge = await serve();
  const plain = await fetch(`http://127.0.0.1:${bridge.port}/health`);
  expect(plain.status).toBe(200);
  const secure = await https(bridge, "/health");
  expect(secure.status).toBe(200);
});

test("the certificate presented is the generated one, valid for 127.0.0.1", async () => {
  const bridge = await serve();
  const authorized = await new Promise<boolean>((resolve, reject) => {
    const socket = tlsConnect({ host: "127.0.0.1", port: bridge.port, ca: cert }, () => {
      resolve(socket.authorized);
      socket.destroy();
    });
    socket.on("error", reject);
  });
  expect(authorized).toBe(true);
});

test("an untrusted client is refused at the handshake and the server stays up", async () => {
  const bridge = await serve();
  await expect(https(bridge, "/health", { ca: "" })).rejects.toThrow();
  expect((await https(bridge, "/health")).status).toBe(200);
});

test("without tls options a TLS client is not served (WA_TLS=0)", async () => {
  const bridge = await createHttpServer(handle(), { token: TOKEN });
  cleanups.push(() => bridge.close());
  await expect(https(bridge, "/health")).rejects.toThrow();
  expect((await fetch(`http://127.0.0.1:${bridge.port}/health`)).status).toBe(200);
});

test("a connection that never speaks is dropped instead of held open", async () => {
  const bridge = await serve({ tls: { cert, key, sniffTimeoutMs: 40 } });
  const closed = await new Promise<boolean>((resolve) => {
    const socket = netConnect(bridge.port, "127.0.0.1");
    const timer = setTimeout(() => {
      socket.destroy();
      resolve(false);
    }, 2000);
    socket.on("close", () => {
      clearTimeout(timer);
      resolve(true);
    });
    socket.on("error", () => {});
  });
  expect(closed).toBe(true);
});

test("close() finishes while a TLS keep-alive connection is open", async () => {
  const bridge = await createHttpServer(handle(), { token: TOKEN, tls: { cert, key } });
  const socket = tlsConnect({ host: "127.0.0.1", port: bridge.port, ca: cert });
  await new Promise((resolve) => socket.once("secureConnect", resolve));
  socket.write("GET /health HTTP/1.1\r\nHost: 127.0.0.1\r\nConnection: keep-alive\r\n\r\n");
  await new Promise((resolve) => socket.once("data", resolve));
  socket.on("error", () => {});
  await bridge.close();
  socket.destroy();
});

test("POST /mcp over TLS: 401 without a token, then initialize and tools/list", async () => {
  const bridge = await serve();
  const anon = await https(bridge, "/mcp", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: INIT,
  });
  expect(anon.status).toBe(401);
  const init = await https(bridge, "/mcp", { method: "POST", headers: auth, body: INIT });
  expect(init.status).toBe(200);
  expect(init.headers["mcp-session-id"]).toBeTypeOf("string");
  expect(JSON.parse(init.body).result.serverInfo.name).toBe("wa-mcp");
  const list = await https(bridge, "/mcp", {
    method: "POST",
    headers: { ...auth, "mcp-session-id": String(init.headers["mcp-session-id"]) },
    body: rpc("tools/list", 2),
  });
  expect(JSON.parse(list.body).result.tools.length).toBeGreaterThan(50);
});

test("a notification is accepted with 202 and no body", async () => {
  const bridge = await serve();
  const init = await https(bridge, "/mcp", { method: "POST", headers: auth, body: INIT });
  const res = await https(bridge, "/mcp", {
    method: "POST",
    headers: { ...auth, "mcp-session-id": String(init.headers["mcp-session-id"]) },
    body: rpc("notifications/initialized", undefined),
  });
  expect(res.status).toBe(202);
  expect(res.body).toBe("");
});

test("a session the daemon doesn't know gets 404, so the client re-initializes after a restart", async () => {
  const bridge = await serve();
  const res = await https(bridge, "/mcp", {
    method: "POST",
    headers: { ...auth, "mcp-session-id": "from-before-the-restart" },
    body: rpc("tools/list", 2),
  });
  expect(res.status).toBe(404);
});

test("DELETE ends a session", async () => {
  const bridge = await serve();
  const init = await https(bridge, "/mcp", { method: "POST", headers: auth, body: INIT });
  const session = String(init.headers["mcp-session-id"]);
  const del = await https(bridge, "/mcp", {
    method: "DELETE",
    headers: { ...auth, "mcp-session-id": session },
  });
  expect(del.status).toBe(204);
  const after = await https(bridge, "/mcp", {
    method: "POST",
    headers: { ...auth, "mcp-session-id": session },
    body: rpc("tools/list", 3),
  });
  expect(after.status).toBe(404);
});

test("GET /mcp without a session id is a 400", async () => {
  const bridge = await serve();
  const res = await https(bridge, "/mcp", { headers: auth });
  expect(res.status).toBe(400);
});

test("sessions are capped: the oldest is evicted, the newest survive", async () => {
  const bridge = await serve();
  const ids: string[] = [];
  for (let index = 0; index < 257; index += 1) {
    const init = await fetch(`http://127.0.0.1:${bridge.port}/mcp`, {
      method: "POST",
      headers: auth,
      body: INIT,
    });
    ids.push(init.headers.get("mcp-session-id") ?? "");
  }
  const probe = (session: string) =>
    fetch(`http://127.0.0.1:${bridge.port}/mcp`, {
      method: "POST",
      headers: { ...auth, "mcp-session-id": session },
      body: rpc("ping", 9),
    }).then((res) => res.status);
  expect(await probe(ids[0] ?? "")).toBe(404);
  expect(await probe(ids.at(-1) ?? "")).toBe(200);
}, 15_000);

test("an https page from the same origin passes the guard; another origin doesn't", async () => {
  const bridge = await serve();
  const same = await https(bridge, "/health", {
    headers: { origin: `https://127.0.0.1:${bridge.port}` },
  });
  expect(same.status).toBe(200);
  const other = await https(bridge, "/health", { headers: { origin: "https://evil.example" } });
  expect(other.status).toBe(403);
});

test("X-WA-Agent names the agent on the calls a tool makes to the bridge", async () => {
  const fetchFn = vi.fn(async () => Response.json({ chats: [] }));
  const bridge = await serve({ fetchFn: fetchFn as unknown as typeof fetch });
  const res = await https(bridge, "/mcp", {
    method: "POST",
    headers: { ...auth, "x-wa-agent": "codex" },
    body: rpc("tools/call", 4, { name: "list_chats", arguments: {} }),
  });
  expect(res.status).toBe(200);
  const init = fetchFn.mock.calls.at(-1)?.[1 as never] as unknown as RequestInit;
  expect(new Headers(init.headers).get("x-wa-agent")).toBe("codex");
});

test("channel delivery over HTTP is refused: channels need the stdio plugin", async () => {
  const fetchFn = vi.fn(async () => Response.json({ id: "sub1" }));
  const bridge = await serve({ fetchFn: fetchFn as unknown as typeof fetch });
  const res = await https(bridge, "/mcp", {
    method: "POST",
    headers: auth,
    body: rpc("tools/call", 5, {
      name: "subscribe_events",
      arguments: { all_chats: true, channel: true },
    }),
  });
  const payload = JSON.parse(res.body) as {
    result: { isError?: boolean; content: Array<{ text: string }> };
  };
  expect(payload.result.isError).toBe(true);
  expect(payload.result.content[0]?.text).toContain("plugin");
  expect(fetchFn).not.toHaveBeenCalled();
});
