import { createHash, timingSafeEqual } from "node:crypto";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { join } from "node:path";
import type { BridgeHandle } from "./lifecycle.ts";

export interface HttpServerOptions {
  token: string;
  host?: string;
  port?: number;
  version?: string;
  rateLimit?: { capacity: number; refillPerMinute: number };
  qrPngPath?: string;
  qrDir?: string;
}

export interface BridgeHttp {
  readonly server: Server;
  readonly port: number;
  close(): Promise<void>;
}

const MAX_BODY_BYTES = 1_000_000;
const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_RATE = { capacity: 60, refillPerMinute: 60 };
const API_PATHS = new Set([
  "/api/messages",
  "/api/chats",
  "/api/send",
  "/api/download",
  "/events",
  "/mcp",
]);

interface TokenBucket {
  tokens: number;
  lastRefill: number;
}

function digest(value: string): Buffer {
  return createHash("sha256").update(value).digest();
}

function presentedBearer(req: IncomingMessage): string | null {
  const header = req.headers.authorization;
  if (header === undefined) {
    return null;
  }
  const [scheme, presented] = header.split(" ");
  if (scheme === undefined || presented === undefined || scheme.toLowerCase() !== "bearer") {
    return null;
  }
  return presented;
}

function tokenMatches(presented: string, expected: string): boolean {
  return timingSafeEqual(digest(presented), digest(expected));
}

function createRateLimiter(capacity: number, refillPerMinute: number) {
  const buckets = new Map<string, TokenBucket>();
  return (ip: string, now: number): { ok: boolean; retryAfterSeconds: number } => {
    const bucket = buckets.get(ip) ?? { tokens: capacity, lastRefill: now };
    bucket.tokens = Math.min(
      capacity,
      bucket.tokens + ((now - bucket.lastRefill) / 60_000) * refillPerMinute,
    );
    bucket.lastRefill = now;
    const perSecond = refillPerMinute / 60;
    if (bucket.tokens >= 1) {
      bucket.tokens -= 1;
      buckets.set(ip, bucket);
      return { ok: true, retryAfterSeconds: 0 };
    }
    const retryAfterSeconds =
      perSecond <= 0 ? capacity : Math.ceil((1 - bucket.tokens) / perSecond);
    buckets.set(ip, bucket);
    return { ok: false, retryAfterSeconds };
  };
}

function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, { "content-type": "application/json; charset=utf-8", ...headers });
  res.end(JSON.stringify(payload));
}

function readBodyWithCap(req: IncomingMessage, cap: number): Promise<boolean> {
  return new Promise((resolve) => {
    let total = 0;
    let decided = false;
    const finish = (fits: boolean) => {
      if (decided) {
        return;
      }
      decided = true;
      req.removeAllListeners("data");
      resolve(fits);
    };
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total > cap) {
        finish(false);
        req.resume();
      }
    });
    req.on("end", () => finish(true));
    req.on("error", () => finish(false));
  });
}

export async function createHttpServer(
  handle: BridgeHandle,
  opts: HttpServerOptions,
): Promise<BridgeHttp> {
  const startedAt = Date.now();
  const rate = opts.rateLimit ?? DEFAULT_RATE;
  const checkRate = createRateLimiter(rate.capacity, rate.refillPerMinute);
  const serveQr = (req: IncomingMessage, res: ServerResponse): void => {
    const qr = handle.getLastQr();
    if (qr === null) {
      sendJson(res, 404, { error: { code: "NO_QR", message: "no qr code available yet" } });
      return;
    }
    const fileParam = new URL(req.url ?? "/", "http://localhost").searchParams.get("file");
    let target: string | null;
    if (fileParam !== null) {
      if (
        fileParam.length === 0 ||
        fileParam.includes("..") ||
        fileParam.includes("/") ||
        fileParam.includes("\\")
      ) {
        sendJson(res, 400, {
          error: { code: "INVALID_PATH", message: "file must be a bare filename" },
        });
        return;
      }
      if (opts.qrDir === undefined) {
        sendJson(res, 404, { error: { code: "NOT_FOUND", message: "no qr directory configured" } });
        return;
      }
      target = join(opts.qrDir, fileParam);
    } else {
      target = opts.qrPngPath ?? null;
    }
    if (target === null) {
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: "no qr image configured" } });
      return;
    }
    void readFile(target)
      .then((bytes) => {
        sendJson(res, 200, { qr, png: bytes.toString("base64") });
      })
      .catch(() => {
        if (fileParam !== null) {
          sendJson(res, 404, { error: { code: "NOT_FOUND", message: "qr file not found" } });
        } else {
          sendJson(res, 200, { qr, png: null });
        }
      });
  };
  const server: Server = createServer((req, res) => {
    const ip = req.socket.remoteAddress ?? "unknown";
    const gate = checkRate(ip, Date.now());
    if (!gate.ok) {
      sendJson(
        res,
        429,
        { error: { code: "RATE_LIMITED", message: "rate limit exceeded" } },
        {
          "retry-after": String(gate.retryAfterSeconds),
        },
      );
      return;
    }
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    if (req.method === "GET" && path === "/health") {
      sendJson(res, 200, {
        status: handle.status,
        connected: handle.status === "connected",
        loggedIn: handle.status === "connected" || handle.status === "reconnecting",
        version: opts.version ?? "0.0.0",
        uptime: Math.floor((Date.now() - startedAt) / 1000),
      });
      return;
    }
    const presented = presentedBearer(req);
    if (presented === null || !tokenMatches(presented, opts.token)) {
      sendJson(res, 401, {
        error: { code: "UNAUTHORIZED", message: "missing or invalid bearer token" },
      });
      return;
    }
    const contentLength = Number(req.headers["content-length"] ?? 0);
    if (contentLength > MAX_BODY_BYTES) {
      req.resume();
      sendJson(res, 413, {
        error: { code: "PAYLOAD_TOO_LARGE", message: `body exceeds ${MAX_BODY_BYTES} bytes` },
      });
      return;
    }
    void readBodyWithCap(req, MAX_BODY_BYTES).then((fits) => {
      if (!fits) {
        sendJson(res, 413, {
          error: { code: "PAYLOAD_TOO_LARGE", message: `body exceeds ${MAX_BODY_BYTES} bytes` },
        });
        return;
      }
      if (path === "/api/qr") {
        serveQr(req, res);
        return;
      }
      if (API_PATHS.has(path)) {
        sendJson(res, 501, { error: { code: "NOT_IMPLEMENTED", message: "route not wired yet" } });
        return;
      }
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: "unknown route" } });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(opts.port ?? 0, opts.host ?? DEFAULT_HOST, () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address();
  const port = typeof address === "object" && address !== null ? address.port : (opts.port ?? 0);
  return {
    server,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
