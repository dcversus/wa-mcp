import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "vite-plus/test";
import { createEventBus } from "../src/events.ts";
import { createHttpServer, type BridgeHttp, type HttpServerOptions } from "../src/http.ts";
import type { BridgeHandle, BridgeStatus } from "../src/lifecycle.ts";
import { saveQrPng } from "../src/qr.ts";

const created: BridgeHttp[] = [];
const authHeader = { authorization: "Bearer test-token" };

function stubHandle(
  status: BridgeStatus = "connected",
  lastQr: string | null = null,
): BridgeHandle {
  return { status, events: createEventBus(), close: async () => {}, getLastQr: () => lastQr };
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
});

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
  expect(res.status).toBe(501);
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
