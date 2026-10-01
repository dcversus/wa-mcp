import { createHash, timingSafeEqual } from "node:crypto";
import type { proto } from "@whiskeysockets/baileys";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { join } from "node:path";
import type { BridgeHandle } from "./lifecycle.ts";
import { isValidRecipientJid } from "@wa-mcp/shared";
import {
  fetchMessageFromStore,
  getMessageContext,
  listChats,
  listMessages,
  searchMessages,
} from "./store/queries.ts";
import type { Store } from "./store/schema.ts";
import {
  buildContactMessage,
  buildEditMessage,
  buildForwardMessage,
  buildLocationMessage,
  buildPollMessage,
  buildReactionMessage,
  buildTextMessage,
} from "./send/build.ts";
import { SendError, sendViaSocket } from "./send/send.ts";
import type { SendGuard } from "./send/safety.ts";

export interface HttpServerOptions {
  token: string;
  host?: string;
  port?: number;
  version?: string;
  rateLimit?: { capacity: number; refillPerMinute: number };
  qrPngPath?: string;
  qrDir?: string;
  store?: Store;
  sendGuard?: SendGuard;
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

function readBodyWithCap(
  req: IncomingMessage,
  cap: number,
): Promise<{ fits: boolean; body: Buffer }> {
  return new Promise((resolve) => {
    const chunks: Buffer[] = [];
    let total = 0;
    let decided = false;
    const finish = (fits: boolean) => {
      if (decided) {
        return;
      }
      decided = true;
      req.removeAllListeners("data");
      resolve({ fits, body: Buffer.concat(chunks) });
    };
    req.on("data", (chunk: Buffer) => {
      total += chunk.length;
      if (total <= cap) {
        chunks.push(chunk);
      }
      if (total > cap) {
        finish(false);
        req.resume();
      }
    });
    req.on("end", () => finish(true));
    req.on("error", () => finish(false));
  });
}

function validationError(res: ServerResponse, message: string): void {
  sendJson(res, 400, { error: { code: "VALIDATION_ERROR", message } });
}

type ParamResult<T> = { ok: true; value: T | undefined } | { ok: false };

function intParam(params: URLSearchParams, name: string): ParamResult<number> {
  const raw = params.get(name);
  if (raw === null) {
    return { ok: true, value: undefined };
  }
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? { ok: true, value: parsed } : { ok: false };
}

function dateParam(params: URLSearchParams, name: string): ParamResult<Date> {
  const raw = params.get(name);
  if (raw === null) {
    return { ok: true, value: undefined };
  }
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? { ok: false } : { ok: true, value: parsed };
}

function boolParam(params: URLSearchParams, name: string): boolean {
  const raw = params.get(name);
  return raw === "true" || raw === "1";
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
  const serveReadRoute = (
    route: string,
    store: Store,
    params: URLSearchParams,
    res: ServerResponse,
  ): void => {
    if (route === "/api/chats") {
      const limit = intParam(params, "limit");
      const offset = intParam(params, "offset");
      if (!limit.ok || !offset.ok) {
        validationError(res, "limit and offset must be numbers");
        return;
      }
      const includeLast = params.get("include_last_message") !== "false";
      sendJson(res, 200, {
        chats: listChats(store, {
          limit: limit.value,
          offset: offset.value,
          includeLastMessage: includeLast,
          archived: boolParam(params, "archived"),
        }),
      });
      return;
    }
    if (route === "/api/messages") {
      const limit = intParam(params, "limit");
      const offset = intParam(params, "offset");
      const after = dateParam(params, "after");
      const before = dateParam(params, "before");
      if (!limit.ok || !offset.ok || !after.ok || !before.ok) {
        validationError(res, "invalid query parameters");
        return;
      }
      sendJson(res, 200, {
        messages: listMessages(store, {
          chatJid: params.get("chat_jid") ?? undefined,
          sender: params.get("sender") ?? undefined,
          after: after.value,
          before: before.value,
          limit: limit.value,
          offset: offset.value,
        }),
      });
      return;
    }
    if (route === "/api/context") {
      const messageId = params.get("message_id");
      if (messageId === null || messageId.length === 0) {
        validationError(res, "message_id is required");
        return;
      }
      const radius = intParam(params, "radius");
      if (!radius.ok) {
        validationError(res, "radius must be a number");
        return;
      }
      const context = getMessageContext(store, messageId, radius.value ?? 3);
      if (context === null) {
        sendJson(res, 404, { error: { code: "NOT_FOUND", message: "message not found" } });
        return;
      }
      sendJson(res, 200, { messages: [...context.before, context.target, ...context.after] });
      return;
    }
    if (route === "/api/search") {
      const query = params.get("q");
      if (query === null || query.length === 0) {
        validationError(res, "q is required");
        return;
      }
      const limit = intParam(params, "limit");
      const offset = intParam(params, "offset");
      if (!limit.ok || !offset.ok) {
        validationError(res, "limit and offset must be numbers");
        return;
      }
      sendJson(res, 200, {
        messages: searchMessages(store, query, {
          chatJid: params.get("chat_jid") ?? undefined,
          limit: limit.value,
          offset: offset.value,
        }),
      });
      return;
    }
  };

  const serveSend = (req: IncomingMessage, res: ServerResponse, body: Buffer): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf8")) as unknown;
    } catch {
      validationError(res, "body must be valid JSON");
      return;
    }
    if (parsed === null || typeof parsed !== "object") {
      validationError(res, "body must be a JSON object");
      return;
    }
    const input = parsed as {
      kind?: unknown;
      chat_jid?: unknown;
      text?: unknown;
      mentions?: unknown;
      reply_to_message_id?: unknown;
      link_preview?: unknown;
      media?: unknown;
      message_id?: unknown;
      emote?: unknown;
      latitude?: unknown;
      longitude?: unknown;
      label?: unknown;
      contact_name?: unknown;
      phones?: unknown;
      poll_name?: unknown;
      options?: unknown;
      selectable_count?: unknown;
    };
    if (typeof input.chat_jid !== "string" || input.chat_jid.length === 0) {
      validationError(res, "chat_jid is required");
      return;
    }
    const chatJid = input.chat_jid;
    const kind = typeof input.kind === "string" ? input.kind : "text";
    let builder: () => Promise<proto.IMessage>;
    switch (kind) {
      case "text": {
        if (typeof input.text !== "string" || input.text.length === 0) {
          validationError(res, "text is required");
          return;
        }
        if (input.mentions !== undefined && !Array.isArray(input.mentions)) {
          validationError(res, "mentions must be an array");
          return;
        }
        if (
          input.reply_to_message_id !== undefined &&
          typeof input.reply_to_message_id !== "string"
        ) {
          validationError(res, "reply_to_message_id must be a string");
          return;
        }
        if (input.link_preview !== undefined && typeof input.link_preview !== "boolean") {
          validationError(res, "link_preview must be a boolean");
          return;
        }
        if (input.media !== undefined) {
          sendJson(res, 501, {
            error: { code: "NOT_IMPLEMENTED", message: "media send not wired yet" },
          });
          return;
        }
        const text: string = input.text;
        const quoted = input.reply_to_message_id as string | undefined;
        const linkPreview = input.link_preview as boolean | undefined;
        builder = () =>
          buildTextMessage({
            text,
            mentions: input.mentions as string[] | undefined,
            quotedMessageId: quoted,
            linkPreview,
          });
        break;
      }
      case "reaction": {
        if (typeof input.message_id !== "string" || input.message_id.length === 0) {
          validationError(res, "message_id is required");
          return;
        }
        if (typeof input.emote !== "string" || input.emote.length === 0) {
          validationError(res, "emote is required");
          return;
        }
        const messageId = input.message_id;
        const emote = input.emote;
        builder = () => buildReactionMessage(chatJid, messageId, emote);
        break;
      }
      case "edit": {
        if (typeof input.message_id !== "string" || input.message_id.length === 0) {
          validationError(res, "message_id is required");
          return;
        }
        if (typeof input.text !== "string" || input.text.length === 0) {
          validationError(res, "text is required");
          return;
        }
        const messageId = input.message_id;
        const text: string = input.text;
        builder = () => Promise.resolve(buildEditMessage(chatJid, messageId, text));
        break;
      }
      case "forward": {
        if (typeof input.message_id !== "string" || input.message_id.length === 0) {
          validationError(res, "message_id is required");
          return;
        }
        if (opts.store === undefined) {
          sendJson(res, 501, { error: { code: "NOT_IMPLEMENTED", message: "store not attached" } });
          return;
        }
        const messageId = input.message_id;
        const original = fetchMessageFromStore(opts.store, messageId);
        if (original === null) {
          sendJson(res, 404, { error: { code: "NOT_FOUND", message: "message not found" } });
          return;
        }
        builder = () => buildForwardMessage(original);
        break;
      }
      case "location": {
        if (typeof input.latitude !== "number" || typeof input.longitude !== "number") {
          validationError(res, "latitude and longitude are required numbers");
          return;
        }
        if (input.label !== undefined && typeof input.label !== "string") {
          validationError(res, "label must be a string");
          return;
        }
        const latitude = input.latitude;
        const longitude = input.longitude;
        builder = () =>
          buildLocationMessage(latitude, longitude, input.label as string | undefined);
        break;
      }
      case "contact": {
        if (typeof input.contact_name !== "string" || input.contact_name.length === 0) {
          validationError(res, "contact_name is required");
          return;
        }
        if (
          !Array.isArray(input.phones) ||
          input.phones.some((phone) => typeof phone !== "string")
        ) {
          validationError(res, "phones must be an array of strings");
          return;
        }
        const contactName = input.contact_name;
        const phones = input.phones as string[];
        builder = () => Promise.resolve(buildContactMessage(contactName, phones));
        break;
      }
      case "poll": {
        if (typeof input.poll_name !== "string" || input.poll_name.length === 0) {
          validationError(res, "poll_name is required");
          return;
        }
        if (
          !Array.isArray(input.options) ||
          input.options.length === 0 ||
          input.options.some((option) => typeof option !== "string")
        ) {
          validationError(res, "options must be a non-empty array of strings");
          return;
        }
        if (input.selectable_count !== undefined && typeof input.selectable_count !== "number") {
          validationError(res, "selectable_count must be a number");
          return;
        }
        const pollName = input.poll_name;
        const options = input.options as string[];
        builder = () =>
          buildPollMessage(pollName, options, input.selectable_count as number | undefined);
        break;
      }
      default:
        validationError(res, `unknown send kind: ${kind}`);
        return;
    }
    if (!isValidRecipientJid(chatJid)) {
      sendJson(res, 400, {
        error: { code: "INVALID_JID", message: `cannot resolve recipient: ${chatJid}` },
      });
      return;
    }
    const socket = handle.socket;
    if (socket === undefined || socket === null || opts.sendGuard === undefined) {
      sendJson(res, 501, {
        error: { code: "NOT_IMPLEMENTED", message: "send not configured on this server" },
      });
      return;
    }
    const verdict = opts.sendGuard.check(Date.now());
    if (!verdict.ok) {
      if (verdict.code === "RATE_LIMITED") {
        sendJson(res, 429, {
          error: {
            code: "RATE_LIMITED",
            message: "sending too fast",
            retryAfterMs: verdict.retryAfterMs,
          },
        });
      } else {
        sendJson(res, 429, {
          error: {
            code: "DAILY_CAP_EXCEEDED",
            message: `daily send cap of ${verdict.cap} reached`,
          },
        });
      }
      return;
    }
    void builder()
      .then((content) => sendViaSocket(socket, chatJid, content, opts))
      .then((result) => {
        opts.sendGuard?.record(Date.now());
        sendJson(res, 200, { message_id: result.messageId });
      })
      .catch((err: unknown) => {
        if (err instanceof SendError) {
          const status = err.code === "SENDS_DISABLED" ? 403 : 400;
          sendJson(res, status, { error: { code: err.code, message: err.message } });
          return;
        }
        sendJson(res, 500, { error: { code: "INTERNAL", message: "send failed" } });
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
    void readBodyWithCap(req, MAX_BODY_BYTES).then(({ fits, body }) => {
      if (!fits) {
        sendJson(res, 413, {
          error: { code: "PAYLOAD_TOO_LARGE", message: `body exceeds ${MAX_BODY_BYTES} bytes` },
        });
        return;
      }
      if (path === "/api/send") {
        serveSend(req, res, body);
        return;
      }
      if (path === "/api/qr") {
        serveQr(req, res);
        return;
      }
      if (
        path === "/api/chats" ||
        path === "/api/messages" ||
        path === "/api/context" ||
        path === "/api/search"
      ) {
        if (opts.store === undefined) {
          sendJson(res, 501, {
            error: { code: "NOT_IMPLEMENTED", message: "route not wired yet" },
          });
          return;
        }
        serveReadRoute(
          path,
          opts.store,
          new URL(req.url ?? "/", "http://localhost").searchParams,
          res,
        );
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
