import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AnyMessageContent, WAMessage } from "baileys";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { join, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";
import type { BridgeHandle } from "./lifecycle.ts";
import { isSafePublicEvent } from "./events.ts";
import type { LookupFn } from "./media/resolve.ts";
import { parseWebhookEvent, verifyWebhook } from "./channels/cloud/webhooks.ts";
import type { CloudChannelConfig } from "./channels/cloud/config.ts";
import { storeMessage, upsertChatMeta } from "./store/messages.ts";
import { upsertGroupParticipants } from "./store/groups.ts";
import { isValidRecipientJid } from "@wa-mcp/shared";
import {
  getUnreadCounts,
  markMessagesRead,
  setChatArchived,
  setChatMuted,
  setChatPinned,
} from "./store/chats.ts";
import { listContacts, setAlias } from "./store/contacts.ts";
import { PRESENCE_TYPES, sendPresenceUpdate, sendReadReceipt } from "./presence.ts";
import { requestPairingCode } from "./pairing-code.ts";
import {
  createGroup,
  getGroupInviteCode,
  groupSettingUpdate,
  leaveGroup,
  updateGroupDescription,
  updateGroupParticipants,
  updateGroupSubject,
  type GroupParticipantAction,
  type GroupSetting,
} from "./groups.ts";
import { GroupValidationError } from "./groups.ts";
import { createRule, deleteRule, listRules } from "./notifications.ts";
import {
  ValidationError,
  blockUnblock,
  getBlocklist,
  setProfilePicture,
  updatePrivacy,
  updateProfile,
} from "./profile.ts";
import {
  fetchMessageFromStore,
  getMessageContext,
  listChats,
  listMessages,
  searchMessages,
} from "./store/queries.ts";
import type { Store } from "./store/schema.ts";
import {
  MediaError,
  resolveMedia,
  saveOutboundMedia,
  sniffMimeType,
  type MediaInput,
  type ResolvedMedia,
} from "./media/resolve.ts";
import { downloadMessageMedia } from "./media/download.ts";
import { createTranscriptionEngine, saveTranscript, getTranscript } from "./media/transcribe.ts";
import { MockTtsEngine } from "./media/tts.ts";
import { TOOLS, handleRpcMessage, type ServerContext } from "@wa-mcp/mcp-server";
import { buildVcard } from "./send/build.ts";
import { resolveRecipient, SendError, sendViaSocket } from "./send/send.ts";
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
  mediaDir?: string;
  fetchFn?: typeof fetch;
  /** T73 H3: DNS resolver for the media-url SSRF guard (tests inject a stub) */
  lookupFn?: LookupFn;
  eventsHeartbeatMs?: number;
  uiDir?: string;
  rateLimitNow?: () => number;
  /** pino-style logger for server-side diagnostics (send failures etc.) */
  logger?: { error(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void };
  /** ephemeral per-boot token for the public pairing surface (T53):
   * /health publishes it; it authorizes /api/qr, /api/pairing-code and
   * /api/pair/resume ONLY — never account data. */
  pairingToken?: string;
  /** GOAL §18: when present, the daemon serves the cloud channel surface
   * (webhooks) and /health reports the cloud channel. */
  cloud?: {
    adapter: {
      ingestWebhookMessage(m: { id: string; from: string; text: string; timestamp?: number }): void;
    };
    config: { verifyToken: string; appSecret: string };
  };
}

const MEDIA_KINDS = new Set(["image", "video", "audio", "document", "sticker"]);

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

function sepChar(): string {
  return process.platform === "win32" ? "\\" : "/";
}

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

/** T73 C1 (ADR 0012): the daemon serves loopback only. A Host header that is
 * not loopback means the request arrived via a DNS-rebinding name (an external
 * page resolving its own hostname to 127.0.0.1); a cross-site Origin means a
 * foreign web page is driving the user's browser. Hosts browsers cannot forge:
 * fetch/XHR set Host and Origin themselves, so both checks are trustworthy. */
function isLoopbackHost(header: string): boolean {
  const value = header.trim().toLowerCase();
  if (value.startsWith("[")) {
    const end = value.indexOf("]");
    return end !== -1 && value.slice(0, end + 1) === "[::1]";
  }
  const host = value.includes(":") ? value.slice(0, value.indexOf(":")) : value;
  return host === "127.0.0.1" || host === "localhost";
}

function hostOriginGuard(req: IncomingMessage): string | null {
  const host = (req.headers.host ?? "").trim();
  if (host === "" || !isLoopbackHost(host)) {
    return "host header must be loopback (127.0.0.1 / localhost / [::1])";
  }
  const origin = req.headers.origin;
  if (origin !== undefined) {
    if (origin.trim().toLowerCase() === "null") {
      return "cross-site origin refused";
    }
    let parsed: URL;
    try {
      parsed = new URL(origin);
    } catch {
      return "malformed origin refused";
    }
    if (parsed.protocol !== "http:" || parsed.host.toLowerCase() !== host.toLowerCase()) {
      return "cross-site origin refused";
    }
  }
  return null;
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

/** T73 C2: every response (UI shell, assets, JSON errors) carries a CSP that
 * defaults to self. `img-src data:` keeps the pairing QR working; the inline
 * style allowance covers the style attributes the vanilla UI renders with. */
const CSP_HEADER = "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'";

function sendJson(
  res: ServerResponse,
  status: number,
  payload: unknown,
  headers: Record<string, string> = {},
): void {
  res.writeHead(status, {
    "content-type": "application/json; charset=utf-8",
    "content-security-policy": CSP_HEADER,
    ...headers,
  });
  res.end(JSON.stringify(payload));
}

/** T73 C3: a void'd body-read chain must never reject unhandled — log the
 * failure and finish the response (500 while headers are not out, else end). */
function respondOrLog(
  res: ServerResponse,
  logger:
    | { error(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void }
    | undefined,
): (err: unknown) => void {
  return (err: unknown) => {
    logger?.error({ err }, "request handler failed");
    if (!res.headersSent) {
      sendJson(res, 500, { error: { code: "INTERNAL", message: "request handler failed" } });
      return;
    }
    res.end();
  };
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
  // per-boot pairing token: opts wins (bin), otherwise self-generated
  const pairingToken = opts.pairingToken ?? randomBytes(24).toString("hex");
  const rate = opts.rateLimit ?? DEFAULT_RATE;
  const now = opts.rateLimitNow ?? Date.now;
  const checkRate = createRateLimiter(rate.capacity, rate.refillPerMinute);
  const serveQr = async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (handle.pairingBudget().blocked) {
      sendJson(res, 429, {
        error: {
          code: "PAIRING_BLOCKED",
          message:
            "pairing attempts exhausted — WhatsApp anti-abuse cooldown is active; wait or call POST /api/pair/resume to retry",
        },
      });
      return;
    }
    const qr = handle.getLastQr();
    if (qr === null) {
      sendJson(res, 404, { error: { code: "NO_QR", message: "no qr code available yet" } });
      return;
    }
    const fileParam = new URL(req.url ?? "/", "http://localhost").searchParams.get("file");
    let target: string | null;
    if (fileParam !== null) {
      if (fileParam !== "qr.png") {
        sendJson(res, 400, {
          error: { code: "INVALID_PATH", message: "file must be qr.png" },
        });
        return;
      }
      if (opts.qrDir === undefined) {
        sendJson(res, 404, { error: { code: "NOT_FOUND", message: "no qr directory configured" } });
        return;
      }
      const allowlisted = join(opts.qrDir, fileParam);
      const realDir = await realpath(opts.qrDir).catch(() => null);
      const realFile = await realpath(allowlisted).catch(() => null);
      if (realDir === null || realFile === null || !realFile.startsWith(realDir + sep)) {
        sendJson(res, 403, {
          error: { code: "PATH_FORBIDDEN", message: "qr file escapes the qr directory" },
        });
        return;
      }
      target = allowlisted;
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
      const contextJidRaw = params.get("chat_jid");
      if (
        opts.store !== undefined &&
        contextJidRaw !== null &&
        !isValidRecipientJid(contextJidRaw)
      ) {
        const resolution = resolveRecipient(opts.store, contextJidRaw);
        if (!resolution.ok) {
          sendJson(res, 400, { error: { code: resolution.code, message: resolution.message } });
          return;
        }
        params.set("chat_jid", resolution.jid);
      }
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
      caption?: unknown;
      file_name?: unknown;
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
    if (
      input.media !== undefined &&
      !(typeof input.kind === "string" && MEDIA_KINDS.has(input.kind))
    ) {
      validationError(res, "media requires an image, video, audio, document or sticker kind");
      return;
    }
    let chatJid: string = input.chat_jid;
    const kind = typeof input.kind === "string" ? input.kind : "text";
    let mediaToSave: ResolvedMedia | null = null;
    let quotedForWire: WAMessage | undefined;
    let builder: () => Promise<AnyMessageContent>;
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
          validationError(res, "media requires an image, video, audio, document or sticker kind");
          return;
        }
        const text: string = input.text;
        const mentions = input.mentions as string[] | undefined;
        const quotedId = input.reply_to_message_id as string | undefined;
        if (quotedId !== undefined && opts.store === undefined) {
          sendJson(res, 501, { error: { code: "NOT_IMPLEMENTED", message: "store not attached" } });
          return;
        }
        const quotedMessage =
          quotedId !== undefined ? fetchMessageFromStore(opts.store!, quotedId) : null;
        if (quotedId !== undefined && quotedMessage === null) {
          sendJson(res, 404, { error: { code: "NOT_FOUND", message: "quoted message not found" } });
          return;
        }
        quotedForWire = quotedMessage ?? undefined;
        builder = () => Promise.resolve({ text, ...(mentions !== undefined ? { mentions } : {}) });
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
        builder = () =>
          Promise.resolve({
            react: { key: { remoteJid: chatJid, id: messageId, fromMe: false }, text: emote },
          });
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
        builder = () =>
          Promise.resolve({ edit: { remoteJid: chatJid, id: messageId, fromMe: true }, text });
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
        builder = () => Promise.resolve({ forward: original });
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
        const label = input.label as string | undefined;
        builder = () =>
          Promise.resolve({
            location: {
              degreesLatitude: latitude,
              degreesLongitude: longitude,
              ...(label !== undefined ? { name: label } : {}),
            },
          });
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
        builder = () =>
          Promise.resolve({
            contacts: {
              displayName: contactName,
              contacts: [{ vcard: buildVcard(contactName, phones) }],
            },
          });
        break;
      }
      case "image":
      case "video":
      case "audio":
      case "document":
      case "sticker": {
        if (input.media === undefined || typeof input.media !== "object") {
          validationError(res, "media is required");
          return;
        }
        const mediaInput = input.media as {
          base64?: unknown;
          path?: unknown;
          url?: unknown;
        };
        const provided = (["base64", "path", "url"] as const).filter(
          (key) => mediaInput[key] !== undefined,
        );
        if (provided.length !== 1) {
          validationError(res, "media needs exactly one of base64, path or url");
          return;
        }
        if (input.caption !== undefined && typeof input.caption !== "string") {
          validationError(res, "caption must be a string");
          return;
        }
        if (input.file_name !== undefined && typeof input.file_name !== "string") {
          validationError(res, "file_name must be a string");
          return;
        }
        if (opts.mediaDir === undefined) {
          sendJson(res, 501, {
            error: { code: "NOT_IMPLEMENTED", message: "media dir not configured" },
          });
          return;
        }
        const mediaArg: MediaInput =
          provided[0] === "base64"
            ? {
                base64: mediaInput.base64 as string,
                fileName: input.file_name as string | undefined,
              }
            : provided[0] === "path"
              ? { path: mediaInput.path as string, fileName: input.file_name as string | undefined }
              : { url: mediaInput.url as string, fileName: input.file_name as string | undefined };
        const caption = input.caption as string | undefined;
        const mediaKind: string = kind;
        const mediaDirForSend: string = opts.mediaDir;
        builder = async () => {
          const resolved = await resolveMedia(mediaArg, {
            mediaDir: mediaDirForSend,
            fetchFn: opts.fetchFn,
            lookupFn: opts.lookupFn,
          });
          mediaToSave = resolved;
          return {
            [mediaKind]: resolved.buffer,
            mimetype: resolved.mimeType,
            fileName: resolved.fileName,
            caption,
          } as unknown as AnyMessageContent;
        };
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
          Promise.resolve({
            poll: {
              name: pollName,
              values: options,
              selectableCount: (input.selectable_count as number | undefined) ?? options.length - 1,
            },
          });
        break;
      }
      default:
        validationError(res, `unknown send kind: ${kind}`);
        return;
    }
    if (opts.store !== undefined) {
      const resolution = resolveRecipient(opts.store, chatJid);
      if (!resolution.ok) {
        sendJson(res, 400, { error: { code: resolution.code, message: resolution.message } });
        return;
      }
      chatJid = resolution.jid;
    } else if (!isValidRecipientJid(chatJid)) {
      sendJson(res, 400, {
        error: { code: "INVALID_JID", message: `cannot resolve recipient: ${chatJid}` },
      });
      return;
    }
    const socket = handle.socket;
    const needsStore = input.media !== undefined;
    if (
      socket === undefined ||
      socket === null ||
      opts.sendGuard === undefined ||
      (needsStore && opts.store === undefined)
    ) {
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
      .then((content) =>
        sendViaSocket(socket, chatJid, content, { ...opts, quoted: quotedForWire }),
      )
      .then(async (result) => {
        const saved: ResolvedMedia | null = mediaToSave;
        if (saved !== null && opts.mediaDir !== undefined && opts.store !== undefined) {
          await saveOutboundMedia(
            opts.store,
            opts.mediaDir,
            result.messageId,
            saved.buffer,
            saved.mimeType,
            kind,
            typeof input.caption === "string" ? input.caption : undefined,
          );
        }
        opts.sendGuard?.record(Date.now());
        sendJson(res, 200, { message_id: result.messageId });
      })
      .catch((err: unknown) => {
        if (err instanceof SendError) {
          const status = err.code === "SENDS_DISABLED" ? 403 : 400;
          sendJson(res, status, { error: { code: err.code, message: err.message } });
          return;
        }
        if (err instanceof MediaError) {
          const status =
            err.code === "TOO_LARGE"
              ? 413
              : err.code === "FETCH_FAILED"
                ? 502
                : err.code === "NOT_FOUND"
                  ? 404
                  : 400;
          sendJson(res, status, { error: { code: err.code, message: err.message } });
          return;
        }
        opts.logger?.error(
          { err: err instanceof Error ? { message: err.message, stack: err.stack } : err },
          "send failed",
        );
        sendJson(res, 500, { error: { code: "INTERNAL", message: "send failed" } });
      });
  };

  let selfPort = 0;
  const serveMcp = (req: IncomingMessage, res: ServerResponse, body: Buffer): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf8")) as unknown;
    } catch {
      sendJson(res, 200, {
        jsonrpc: "2.0",
        id: null,
        error: { code: -32700, message: "invalid JSON" },
      });
      return;
    }
    const selfUrl = `http://${opts.host ?? "127.0.0.1"}:${selfPort}`;
    const ctx: ServerContext = {
      tools: TOOLS,
      bridgeUrl: selfUrl,
      token: opts.token,
      fetchFn: opts.fetchFn,
      lookupFn: opts.lookupFn,
    };
    void handleRpcMessage(parsed, ctx).then(
      (response) => {
        sendJson(res, 200, response ?? {});
      },
      (err: unknown) => {
        sendJson(res, 200, {
          jsonrpc: "2.0",
          id: null,
          error: { code: -32603, message: String(err) },
        });
      },
    );
  };

  const serveReadPost = (
    route: string,
    req: IncomingMessage,
    res: ServerResponse,
    body: Buffer,
  ): void => {
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
      chat_jid?: unknown;
      message_ids?: unknown;
      presence?: unknown;
      archived?: unknown;
      pinned?: unknown;
      muted_until?: unknown;
      alias?: unknown;
      jid?: unknown;
      title?: unknown;
      body?: unknown;
      unread_only?: unknown;
      from_jid?: unknown;
    };
    const needsChatJid = route !== "/api/alias";
    if (needsChatJid && (typeof input.chat_jid !== "string" || input.chat_jid.length === 0)) {
      validationError(res, "chat_jid is required");
      return;
    }
    let chatJid = input.chat_jid as string;
    const hasChatJid = typeof chatJid === "string" && chatJid.length > 0;
    if (opts.store !== undefined && hasChatJid && !isValidRecipientJid(chatJid)) {
      const resolution = resolveRecipient(opts.store, chatJid);
      if (!resolution.ok) {
        sendJson(res, 400, { error: { code: resolution.code, message: resolution.message } });
        return;
      }
      chatJid = resolution.jid;
    }
    if (route === "/api/read") {
      if (
        !Array.isArray(input.message_ids) ||
        input.message_ids.some((id) => typeof id !== "string")
      ) {
        validationError(res, "message_ids must be an array of strings");
        return;
      }
      const socket = handle.socket;
      if (socket === undefined || socket === null) {
        sendJson(res, 501, { error: { code: "NOT_IMPLEMENTED", message: "bridge not connected" } });
        return;
      }
      const messageIds = input.message_ids as string[];
      if (opts.store === undefined) {
        sendJson(res, 501, { error: { code: "NOT_IMPLEMENTED", message: "store not attached" } });
        return;
      }
      const store = opts.store;
      void sendReadReceipt(socket, chatJid, messageIds)
        .then(() => {
          markMessagesRead(store, chatJid, messageIds);
          sendJson(res, 200, { read: messageIds.length });
        })
        .catch(() => {
          sendJson(res, 500, { error: { code: "INTERNAL", message: "receipt failed" } });
        });
      return;
    }
    if (route === "/api/presence") {
      if (typeof input.presence !== "string" || !PRESENCE_TYPES.includes(input.presence as never)) {
        validationError(
          res,
          "presence must be one of available, unavailable, composing, recording, paused",
        );
        return;
      }
      const socket = handle.socket;
      if (socket === undefined || socket === null) {
        sendJson(res, 501, { error: { code: "NOT_IMPLEMENTED", message: "bridge not connected" } });
        return;
      }
      void sendPresenceUpdate(socket, chatJid, input.presence as (typeof PRESENCE_TYPES)[number])
        .then(() => {
          sendJson(res, 200, { ok: true });
        })
        .catch(() => {
          sendJson(res, 500, { error: { code: "INTERNAL", message: "presence failed" } });
        });
      return;
    }
    if (route === "/api/chat/state") {
      const flags: Array<boolean> = [];
      if (input.archived !== undefined) {
        if (typeof input.archived !== "boolean") {
          validationError(res, "archived must be a boolean");
          return;
        }
        flags.push(true);
      }
      if (input.pinned !== undefined) {
        if (typeof input.pinned !== "boolean") {
          validationError(res, "pinned must be a boolean");
          return;
        }
        flags.push(true);
      }
      if (
        input.muted_until !== undefined &&
        typeof input.muted_until !== "string" &&
        input.muted_until !== null
      ) {
        validationError(res, "muted_until must be a string or null");
        return;
      }
      const mutedUntil = input.muted_until as string | null | undefined;
      if (flags.length === 0 && mutedUntil === undefined) {
        validationError(res, "at least one of archived, pinned, muted_until is required");
        return;
      }
      if (opts.store === undefined) {
        sendJson(res, 501, { error: { code: "NOT_IMPLEMENTED", message: "store not attached" } });
        return;
      }
      if (input.archived !== undefined) {
        setChatArchived(opts.store, chatJid, input.archived);
      }
      if (input.pinned !== undefined) {
        setChatPinned(opts.store, chatJid, input.pinned);
      }
      if (mutedUntil !== undefined) {
        setChatMuted(opts.store, chatJid, mutedUntil);
      }
      sendJson(res, 200, { ok: true });
      return;
    }
    if (route === "/api/notifications") {
      if (typeof input.title !== "string" || input.title.length === 0) {
        validationError(res, "title is required");
        return;
      }
      if (input.chat_jid !== undefined && typeof input.chat_jid !== "string") {
        validationError(res, "chat_jid must be a string");
        return;
      }
      if (input.unread_only !== undefined && typeof input.unread_only !== "boolean") {
        validationError(res, "unread_only must be a boolean");
        return;
      }
      const rule = createRule(opts.store as Store, {
        title: input.title,
        body: typeof input.body === "string" ? input.body : undefined,
        chatJid: typeof input.chat_jid === "string" ? input.chat_jid : undefined,
        fromJid: typeof input.from_jid === "string" ? input.from_jid : undefined,
        unreadOnly: input.unread_only === true,
      });
      sendJson(res, 200, { rule });
      return;
    }
    if (route === "/api/alias") {
      if (typeof input.alias !== "string" || input.alias.length === 0) {
        validationError(res, "alias is required");
        return;
      }
      if (typeof input.jid !== "string" || input.jid.length === 0) {
        validationError(res, "jid is required");
        return;
      }
      if (opts.store === undefined) {
        sendJson(res, 501, { error: { code: "NOT_IMPLEMENTED", message: "store not attached" } });
        return;
      }
      setAlias(opts.store, input.jid, input.alias);
      sendJson(res, 200, { ok: true });
      return;
    }
  };

  const serveGroup = (
    route: string,
    req: IncomingMessage,
    res: ServerResponse,
    body: Buffer,
  ): void => {
    const socket = handle.socket;
    if (socket === undefined || socket === null) {
      sendJson(res, 501, { error: { code: "NOT_IMPLEMENTED", message: "bridge not connected" } });
      return;
    }
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
      subject?: unknown;
      participants?: unknown;
      group_jid?: unknown;
      jids?: unknown;
      action?: unknown;
      description?: unknown;
      setting?: unknown;
    };
    const run = <T>(work: () => Promise<T>): void => {
      void work()
        .then((result) => {
          sendJson(res, 200, result as Record<string, unknown>);
        })
        .catch((err: unknown) => {
          if (err instanceof GroupValidationError || err instanceof ValidationError) {
            sendJson(res, 400, { error: { code: err.code, message: err.message } });
            return;
          }
          sendJson(res, 500, { error: { code: "INTERNAL", message: "group operation failed" } });
        });
    };
    if (route === "/api/group/create") {
      if (typeof input.subject !== "string" || input.subject.length === 0) {
        validationError(res, "subject is required");
        return;
      }
      if (
        !Array.isArray(input.participants) ||
        input.participants.some((p) => typeof p !== "string")
      ) {
        validationError(res, "participants must be an array of strings");
        return;
      }
      run(() =>
        createGroup(socket, input.subject as string, input.participants as string[]).then(
          (group) => ({ group }),
        ),
      );
      return;
    }
    if (route === "/api/group/participants") {
      if (typeof input.group_jid !== "string" || input.group_jid.length === 0) {
        validationError(res, "group_jid is required");
        return;
      }
      if (!Array.isArray(input.jids) || input.jids.some((jid) => typeof jid !== "string")) {
        validationError(res, "jids must be an array of strings");
        return;
      }
      if (typeof input.action !== "string") {
        validationError(res, "action is required");
        return;
      }
      run(() =>
        updateGroupParticipants(
          socket,
          input.group_jid as string,
          input.jids as string[],
          input.action as GroupParticipantAction,
        ).then((results) => ({ results })),
      );
      return;
    }
    if (route === "/api/group/meta") {
      if (typeof input.group_jid !== "string" || input.group_jid.length === 0) {
        validationError(res, "group_jid is required");
        return;
      }
      if (input.subject === undefined && input.description === undefined) {
        validationError(res, "subject or description is required");
        return;
      }
      if (input.subject !== undefined && typeof input.subject !== "string") {
        validationError(res, "subject must be a string");
        return;
      }
      run(() => {
        const subjectWork =
          input.subject !== undefined
            ? updateGroupSubject(socket, input.group_jid as string, input.subject as string)
            : Promise.resolve();
        const descriptionWork =
          input.description !== undefined
            ? updateGroupDescription(socket, input.group_jid as string, input.description as string)
            : Promise.resolve();
        return Promise.all([subjectWork, descriptionWork]).then(() => ({ ok: true }));
      });
      return;
    }
    if (route === "/api/group/settings") {
      if (typeof input.group_jid !== "string" || input.group_jid.length === 0) {
        validationError(res, "group_jid is required");
        return;
      }
      if (typeof input.setting !== "string") {
        validationError(res, "setting is required");
        return;
      }
      run(() =>
        groupSettingUpdate(socket, input.group_jid as string, input.setting as GroupSetting).then(
          () => ({ ok: true }),
        ),
      );
      return;
    }
    if (route === "/api/group/leave") {
      if (typeof input.group_jid !== "string" || input.group_jid.length === 0) {
        validationError(res, "group_jid is required");
        return;
      }
      run(() => leaveGroup(socket, input.group_jid as string).then(() => ({ ok: true })));
      return;
    }
  };

  const serveProfile = (
    route: string,
    req: IncomingMessage,
    res: ServerResponse,
    body: Buffer,
  ): void => {
    const socket = handle.socket;
    if (socket === undefined || socket === null) {
      sendJson(res, 501, { error: { code: "NOT_IMPLEMENTED", message: "bridge not connected" } });
      return;
    }
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
      name?: unknown;
      status?: unknown;
      image_base64?: unknown;
      jid?: unknown;
      block?: unknown;
      title?: unknown;
      unread_only?: unknown;
      from_jid?: unknown;
    };
    const runProfile = <T>(work: () => Promise<T>): void => {
      void work()
        .then((result) => {
          sendJson(res, 200, result as Record<string, unknown>);
        })
        .catch((err: unknown) => {
          if (err instanceof ValidationError) {
            sendJson(res, 400, { error: { code: err.code, message: err.message } });
            return;
          }
          sendJson(res, 500, { error: { code: "INTERNAL", message: "profile update failed" } });
        });
    };
    if (route === "/api/profile") {
      const update: { name?: string; status?: string } = {};
      if (input.name !== undefined) {
        if (typeof input.name !== "string" || input.name.length === 0) {
          validationError(res, "name must be a non-empty string");
          return;
        }
        update.name = input.name;
      }
      if (input.status !== undefined) {
        if (typeof input.status !== "string") {
          validationError(res, "status must be a string");
          return;
        }
        update.status = input.status;
      }
      if (update.name === undefined && update.status === undefined) {
        validationError(res, "name or status is required");
        return;
      }
      runProfile(() => updateProfile(socket, update).then(() => ({ ok: true })));
      return;
    }
    if (route === "/api/profile/picture") {
      if (typeof input.image_base64 !== "string" || input.image_base64.length === 0) {
        validationError(res, "image_base64 is required");
        return;
      }
      const buffer = Buffer.from(input.image_base64, "base64");
      if (buffer.length === 0) {
        validationError(res, "image_base64 is not valid base64");
        return;
      }
      runProfile(() => setProfilePicture(socket, buffer).then(() => ({ ok: true })));
      return;
    }
    if (route === "/api/privacy") {
      if (parsed === null || typeof parsed !== "object") {
        validationError(res, "privacy patch is required");
        return;
      }
      runProfile(() =>
        updatePrivacy(socket, parsed as Record<string, string>).then((applied) => ({ applied })),
      );
      return;
    }
    if (route === "/api/block") {
      if (typeof input.jid !== "string" || input.jid.length === 0) {
        validationError(res, "jid is required");
        return;
      }
      if (typeof input.block !== "boolean") {
        validationError(res, "block must be a boolean");
        return;
      }
      runProfile(() =>
        blockUnblock(socket, input.jid as string, input.block as boolean).then(() => ({
          ok: true,
        })),
      );
      return;
    }
  };

  const mediaRoute = (method: string, rawId: string, res: ServerResponse): void => {
    let id: string;
    try {
      id = decodeURIComponent(rawId);
    } catch {
      sendJson(res, 400, {
        error: { code: "PATH_FORBIDDEN", message: "invalid message id encoding" },
      });
      return;
    }
    if (!/^[A-Za-z0-9_-]+$/.test(id)) {
      sendJson(res, 400, {
        error: {
          code: "PATH_FORBIDDEN",
          message: "message id may only contain letters, digits, _ and -",
        },
      });
      return;
    }
    if (method === "GET") {
      if (opts.store === undefined) {
        sendJson(res, 501, { error: { code: "NOT_IMPLEMENTED", message: "store not attached" } });
        return;
      }
      const row = opts.store.db.prepare("SELECT media_path FROM messages WHERE id = ?").get(id) as
        | { media_path: string | null }
        | undefined;
      if (row === undefined || row.media_path === null) {
        sendJson(res, 404, {
          error: { code: "NOT_FOUND", message: "no stored media for this message" },
        });
        return;
      }
      void readFile(row.media_path)
        .then((bytes) => {
          res.writeHead(200, { "content-type": sniffMimeType(bytes) });
          res.end(bytes);
        })
        .catch(() => {
          sendJson(res, 404, {
            error: { code: "NOT_FOUND", message: "stored media file is gone" },
          });
        });
      return;
    }
    if (method === "POST") {
      const socket = handle.socket;
      if (
        socket === undefined ||
        socket === null ||
        opts.store === undefined ||
        opts.mediaDir === undefined
      ) {
        sendJson(res, 501, {
          error: { code: "NOT_IMPLEMENTED", message: "download not configured" },
        });
        return;
      }
      const original = fetchMessageFromStore(opts.store, id);
      if (original === null) {
        sendJson(res, 404, { error: { code: "NOT_FOUND", message: "message not found" } });
        return;
      }
      void downloadMessageMedia(socket, original, {
        store: opts.store,
        mediaDir: opts.mediaDir,
        messageId: id,
      })
        .then((result) => {
          sendJson(res, 200, { path: result.path, mime: result.mime, size: result.size });
        })
        .catch((err: unknown) => {
          if (err instanceof MediaError) {
            if (err.code === "EMPTY") {
              sendJson(res, 404, {
                error: { code: "NOT_FOUND", message: "message has no downloadable media" },
              });
              return;
            }
            const status =
              err.code === "TOO_LARGE"
                ? 413
                : err.code === "FETCH_FAILED"
                  ? 502
                  : err.code === "NOT_FOUND"
                    ? 404
                    : 400;
            sendJson(res, status, { error: { code: err.code, message: err.message } });
            return;
          }
          sendJson(res, 500, { error: { code: "INTERNAL", message: "download failed" } });
        });
      return;
    }
    sendJson(res, 405, { error: { code: "VALIDATION_ERROR", message: "method not allowed" } });
  };

  const serveTranscribe = (req: IncomingMessage, res: ServerResponse, body: Buffer): void => {
    const socket = handle.socket;
    if (
      socket === undefined ||
      socket === null ||
      opts.store === undefined ||
      opts.mediaDir === undefined
    ) {
      sendJson(res, 501, {
        error: { code: "NOT_IMPLEMENTED", message: "transcribe not configured" },
      });
      return;
    }
    const store = opts.store;
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf8")) as unknown;
    } catch {
      validationError(res, "body must be valid JSON");
      return;
    }
    const messageId = (parsed as { message_id?: unknown }).message_id;
    if (typeof messageId !== "string" || !/^[A-Za-z0-9_-]+$/.test(messageId)) {
      validationError(res, "message_id is required");
      return;
    }
    const engineName = process.env.WA_TRANSCRIBE_ENGINE ?? "mock";
    void (async () => {
      const original = fetchMessageFromStore(store, messageId);
      if (original === null) {
        sendJson(res, 404, { error: { code: "NOT_FOUND", message: "message not found" } });
        return null;
      }
      const cached = getTranscript(store, original.key.remoteJid ?? "", messageId, engineName);
      if (cached !== null) {
        sendJson(res, 200, {
          text: cached.text,
          language: cached.language ?? undefined,
          engine: engineName,
          cached: true,
        });
        return null;
      }
      const row = store.db
        .prepare("SELECT media_path FROM messages WHERE id = ?")
        .get(messageId) as { media_path: string | null } | undefined;
      let buffer: Buffer;
      if (row?.media_path !== null && row?.media_path !== undefined) {
        buffer = await readFile(row.media_path);
      } else {
        const downloaded = await downloadMessageMedia(socket, original, {
          store,
          mediaDir: opts.mediaDir as string,
          messageId,
        });
        buffer = await readFile(downloaded.path);
      }
      const engine = createTranscriptionEngine(engineName);
      const result = await engine.transcribe(buffer, "audio/ogg");
      saveTranscript(
        store,
        original.key.remoteJid ?? "",
        messageId,
        engineName,
        result.text,
        result.language,
      );
      return { text: result.text, language: result.language, engine: engineName, cached: false };
    })()
      .then((payload) => {
        if (payload !== null) {
          sendJson(res, 200, payload);
        }
      })
      .catch((err: unknown) => {
        if (err instanceof MediaError && err.code === "EMPTY") {
          sendJson(res, 404, {
            error: { code: "NOT_FOUND", message: "message has no downloadable media" },
          });
          return;
        }
        sendJson(res, 500, { error: { code: "INTERNAL", message: "transcription failed" } });
      });
  };

  const serveTts = (req: IncomingMessage, res: ServerResponse, body: Buffer): void => {
    let parsed: unknown;
    try {
      parsed = JSON.parse(body.toString("utf8")) as unknown;
    } catch {
      validationError(res, "body must be valid JSON");
      return;
    }
    const text = (parsed as { text?: unknown }).text;
    const chatJid = (parsed as { chat_jid?: unknown }).chat_jid;
    if (typeof text !== "string" || text.length === 0) {
      validationError(res, "text is required");
      return;
    }
    if (chatJid !== undefined && typeof chatJid !== "string") {
      validationError(res, "chat_jid must be a string");
      return;
    }
    const engine = new MockTtsEngine();
    void engine
      .synthesize(text)
      .then(async (audio) => {
        if (chatJid === undefined) {
          sendJson(res, 200, { audio_base64: audio.buffer.toString("base64"), mime: audio.mime });
          return;
        }
        const socket = handle.socket;
        if (socket === undefined || socket === null) {
          sendJson(res, 501, {
            error: { code: "NOT_IMPLEMENTED", message: "bridge not connected" },
          });
          return;
        }
        const result = await sendViaSocket(socket, chatJid, {
          audio: audio.buffer,
          ptt: true,
          mimetype: audio.mime,
        } as AnyMessageContent);
        sendJson(res, 200, { message_id: result.messageId });
      })
      .catch((err: unknown) => {
        if (err instanceof SendError) {
          const status = err.code === "SENDS_DISABLED" ? 403 : 400;
          sendJson(res, status, { error: { code: err.code, message: err.message } });
          return;
        }
        sendJson(res, 500, { error: { code: "INTERNAL", message: "tts failed" } });
      });
  };

  const serveStatic = (path: string, res: ServerResponse): void => {
    const uiDir = opts.uiDir;
    if (uiDir === undefined) {
      sendJson(res, 404, { error: { code: "NOT_FOUND", message: "web ui not configured" } });
      return;
    }
    const relative = path === "/" ? "index.html" : path.slice(1);
    if (relative.includes("..") || relative.includes("\\")) {
      sendJson(res, 400, {
        error: { code: "PATH_FORBIDDEN", message: "path escapes the ui directory" },
      });
      return;
    }
    const candidate = join(uiDir, relative);
    if (!resolve(candidate).startsWith(resolve(uiDir) + sepChar())) {
      sendJson(res, 400, {
        error: { code: "PATH_FORBIDDEN", message: "path escapes the ui directory" },
      });
      return;
    }
    readFile(candidate)
      .then((bytes) => {
        const mime = candidate.endsWith(".html")
          ? "text/html"
          : candidate.endsWith(".js")
            ? "text/javascript"
            : candidate.endsWith(".css")
              ? "text/css"
              : "application/octet-stream";
        res.writeHead(200, { "content-type": mime, "content-security-policy": CSP_HEADER });
        res.end(bytes);
      })
      .catch(() => {
        sendJson(res, 404, { error: { code: "NOT_FOUND", message: "file not found" } });
      });
  };

  const server: Server = createServer(async (req, res) => {
    const ip = req.socket.remoteAddress ?? "unknown";
    const gate = checkRate(ip, now());
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
    // T73 C1 (ADR 0012): refuse DNS-rebinding Hosts and cross-site Origins on
    // the whole API surface before auth is even evaluated.
    if (path.startsWith("/api/") || path === "/events" || path === "/mcp") {
      const guard = hostOriginGuard(req);
      if (guard !== null) {
        sendJson(res, 403, { error: { code: "FORBIDDEN_HOST", message: guard } });
        return;
      }
    }
    if (req.method === "GET" && path === "/health") {
      const budget = handle.pairingBudget();
      sendJson(res, 200, {
        status: handle.status,
        connected: handle.status === "connected",
        loggedIn:
          handle.status === "connected" ||
          (handle.status === "reconnecting" && handle.hasPairedAccount()),
        pairingBlocked: budget.blocked,
        pairingAttempts: { used: budget.used, limit: budget.limit },
        pairingToken,
        channel: opts.cloud ? "cloud" : "baileys",
        credentialsValid: opts.cloud ? opts.cloud.config.verifyToken.length > 0 : undefined,
        version: opts.version ?? "0.0.0",
        uptime: Math.floor((Date.now() - startedAt) / 1000),
      });
      return;
    }
    if (opts.cloud && path === "/webhooks/cloud") {
      if (req.method === "GET") {
        const query: Record<string, string> = {};
        for (const [key, value] of new URL(req.url ?? "/", "http://localhost").searchParams) {
          query[key] = value;
        }
        const challenge = verifyWebhook(query, opts.cloud.config as CloudChannelConfig);
        if (challenge === null) {
          sendJson(res, 403, {
            error: { code: "FORBIDDEN", message: "webhook verification failed" },
          });
          return;
        }
        res.writeHead(200, { "content-type": "text/plain" });
        res.end(challenge);
        return;
      }
      if (req.method === "POST") {
        void readBodyWithCap(req, MAX_BODY_BYTES)
          .then(({ fits, body }) => {
            if (!fits) {
              sendJson(res, 413, {
                error: { code: "PAYLOAD_TOO_LARGE", message: "webhook body exceeds 1MB" },
              });
              return;
            }
            const signature = req.headers["x-hub-signature-256"] as string | undefined;
            let events;
            try {
              events = parseWebhookEvent(
                body.toString(),
                signature,
                opts.cloud!.config as CloudChannelConfig,
              );
            } catch {
              sendJson(res, 403, {
                error: { code: "FORBIDDEN", message: "webhook signature validation failed" },
              });
              return;
            }
            for (const event of events) {
              if (event.type !== "message") {
                continue;
              }
              opts.cloud!.adapter.ingestWebhookMessage({
                id: event.message.id,
                from: event.message.from,
                text: event.message.text ?? "",
                timestamp: event.message.timestamp,
              });
              if (opts.store !== undefined) {
                storeMessage(opts.store, {
                  key: { remoteJid: event.message.chatJid, fromMe: false, id: event.message.id },
                  message:
                    event.message.text === null ? undefined : { conversation: event.message.text },
                  messageTimestamp: event.message.timestamp,
                  pushName: undefined,
                } as never);
              }
            }
            sendJson(res, 200, { received: events.length });
          })
          .catch(respondOrLog(res, opts.logger));
        return;
      }
    }
    if (req.method === "GET" && (path === "/" || path.startsWith("/assets/"))) {
      serveStatic(path, res);
      return;
    }
    // EventSource cannot set headers: the SSE endpoint may carry the token
    // as a query parameter instead (constant-time compared below like the header)
    let presented = presentedBearer(req);
    if (
      presented === null &&
      req.method === "GET" &&
      (path === "/events" || path.startsWith("/api/media/"))
    ) {
      // EventSource and <img>/<audio> elements cannot set Authorization
      // headers — these read-only GETs may carry the token as a query param
      presented = new URL(req.url ?? "/", "http://localhost").searchParams.get("token");
    }
    // T73 C1 (ADR 0012): the ephemeral pairing token is scoped to the pairing
    // surface ONLY — /health publishes it, so it must never authorize account
    // data or messaging. The local web UI exchanges it once for the daemon
    // token via GET /api/ui-token (loopback Host + same-origin enforced above).
    const PAIRING_SURFACE: ReadonlySet<string> = new Set([
      "/api/qr",
      "/api/pairing-code",
      "/api/pair/resume",
      "/api/ui-token",
    ]);
    const pairingTokenAuthorized =
      presented !== null && tokenMatches(presented, pairingToken) && PAIRING_SURFACE.has(path);
    if (!pairingTokenAuthorized && (presented === null || !tokenMatches(presented, opts.token))) {
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
    void readBodyWithCap(req, MAX_BODY_BYTES)
      .then(async ({ fits, body }) => {
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
        if (path === "/mcp") {
          serveMcp(req, res, body);
          return;
        }
        if (path === "/events" && req.method === "GET") {
          const socket = handle.socket;
          if (socket === undefined || socket === null) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "bridge not connected" },
            });
            return;
          }
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          });
          res.write(": connected\n\n");
          const unsubscribe = handle.events.subscribe((event) => {
            // T73 H2: credential-bearing events (creds.update et al) never
            // reach the public SSE stream — safe-set whitelist
            if (!isSafePublicEvent(event)) {
              return;
            }
            res.write(`data: ${JSON.stringify({ type: event.type, payload: event.payload })}\n\n`);
          });
          const heartbeat = setInterval(() => {
            res.write(": heartbeat\n\n");
          }, opts.eventsHeartbeatMs ?? 25_000);
          res.on("close", () => {
            unsubscribe();
            clearInterval(heartbeat);
          });
          return;
        }
        if (path.startsWith("/api/media/") && path.length > "/api/media/".length) {
          mediaRoute(req.method ?? "GET", path.slice("/api/media/".length), res);
          return;
        }
        if (path.startsWith("/api/group/invite/")) {
          const groupJid = decodeURIComponent(path.slice("/api/group/invite/".length));
          const socket = handle.socket;
          if (socket === undefined || socket === null) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "bridge not connected" },
            });
            return;
          }
          void getGroupInviteCode(socket, groupJid)
            .then((invite_code) => {
              sendJson(res, 200, { invite_code: invite_code ?? null });
            })
            .catch(() => {
              sendJson(res, 500, { error: { code: "INTERNAL", message: "invite code failed" } });
            });
          return;
        }
        if (
          path === "/api/group/create" ||
          path === "/api/group/participants" ||
          path === "/api/group/meta" ||
          path === "/api/group/settings" ||
          path === "/api/group/leave"
        ) {
          serveGroup(path, req, res, body);
          return;
        }
        if (path === "/api/group/info" && req.method === "GET") {
          const jid = new URL(req.url ?? "/", "http://localhost").searchParams.get("jid");
          if (jid === null || jid.length === 0) {
            validationError(res, "jid is required");
            return;
          }
          const socket = handle.socket;
          if (socket === undefined || socket === null) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "bridge not connected" },
            });
            return;
          }
          const metadata = (await socket.groupMetadata(jid)) as {
            id: string;
            subject?: string;
            participants?: Array<{ id: string; admin?: string | null }>;
          };
          if (opts.store !== undefined) {
            upsertChatMeta(opts.store, { id: metadata.id, name: metadata.subject });
            upsertGroupParticipants(
              opts.store,
              metadata.id,
              (metadata.participants ?? []).map((p) => ({ id: p.id, admin: p.admin ?? null })),
            );
          }
          sendJson(res, 200, metadata);
          return;
        }
        if (path === "/api/delete" && req.method === "POST") {
          const input = JSON.parse(body.toString("utf8")) as {
            chat_jid?: unknown;
            message_id?: unknown;
          };
          if (typeof input.chat_jid !== "string" || input.chat_jid.length === 0) {
            validationError(res, "chat_jid is required");
            return;
          }
          if (typeof input.message_id !== "string" || input.message_id.length === 0) {
            validationError(res, "message_id is required");
            return;
          }
          const socket = handle.socket;
          if (socket === undefined || socket === null) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "bridge not connected" },
            });
            return;
          }
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          const target = opts.store.db
            .prepare("SELECT is_from_me, deleted FROM messages WHERE chat_jid = ? AND id = ?")
            .get(input.chat_jid, input.message_id) as
            | { is_from_me: number; deleted: number }
            | undefined;
          if (target === undefined) {
            sendJson(res, 404, { error: { code: "NOT_FOUND", message: "message not found" } });
            return;
          }
          if (target.deleted === 1) {
            sendJson(res, 200, { deleted: true, already: true });
            return;
          }
          await socket.sendMessage(input.chat_jid, {
            delete: {
              remoteJid: input.chat_jid,
              id: input.message_id,
              fromMe: target.is_from_me === 1,
            },
          });
          opts.store.db
            .prepare(
              "UPDATE messages SET deleted = 1, content = '[revoked]', media_type = NULL, media_path = NULL WHERE chat_jid = ? AND id = ?",
            )
            .run(input.chat_jid, input.message_id);
          sendJson(res, 200, { deleted: true });
          return;
        }
        if (path === "/api/pair/resume" && req.method === "POST") {
          handle.resumePairing();
          const budget = handle.pairingBudget();
          sendJson(res, 200, {
            resumed: true,
            pairingAttempts: { used: budget.used, limit: budget.limit },
          });
          return;
        }
        if (path === "/api/pairing-code" && req.method === "POST") {
          const socket = handle.socket;
          if (socket === undefined || socket === null) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "bridge not connected" },
            });
            return;
          }
          if (handle.status !== "qr" && handle.status !== "connecting") {
            sendJson(res, 409, {
              error: {
                code: "PAIRING_STATE",
                message: `pairing code requires qr/connecting state (current: ${handle.status})`,
              },
            });
            return;
          }
          let parsed: unknown;
          try {
            parsed = JSON.parse(body.toString("utf8")) as unknown;
          } catch {
            validationError(res, "body must be valid JSON");
            return;
          }
          const phone = (parsed as { phone?: unknown }).phone;
          if (
            typeof phone !== "string" ||
            phone.replace(/\D/g, "").length < 8 ||
            phone.replace(/\D/g, "").length > 15
          ) {
            validationError(res, "phone must be 8-15 digits after stripping +/spaces");
            return;
          }
          void requestPairingCode(socket, phone)
            .then((code) => {
              sendJson(res, 200, { code });
            })
            .catch((err: unknown) => {
              sendJson(res, 500, {
                error: {
                  code: "INTERNAL",
                  message: err instanceof Error ? err.message : "pairing code failed",
                },
              });
            });
          return;
        }
        if (path === "/api/transcribe" && req.method === "POST") {
          serveTranscribe(req, res, body);
          return;
        }
        if (path === "/api/tts" && req.method === "POST") {
          serveTts(req, res, body);
          return;
        }
        if (
          path === "/api/read" ||
          path === "/api/presence" ||
          path === "/api/chat/state" ||
          path === "/api/alias"
        ) {
          serveReadPost(path, req, res, body);
          return;
        }
        if (
          path === "/api/profile" ||
          path === "/api/profile/picture" ||
          path === "/api/privacy" ||
          path === "/api/block"
        ) {
          serveProfile(path, req, res, body);
          return;
        }
        if (path === "/api/blocklist") {
          const socket = handle.socket;
          if (socket === undefined || socket === null) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "bridge not connected" },
            });
            return;
          }
          void getBlocklist(socket)
            .then((blocklist) => {
              sendJson(res, 200, { blocklist });
            })
            .catch(() => {
              sendJson(res, 500, { error: { code: "INTERNAL", message: "blocklist failed" } });
            });
          return;
        }
        if (path === "/api/notifications" && req.method === "GET") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          sendJson(res, 200, { rules: listRules(opts.store) });
          return;
        }
        if (path === "/api/notifications" && req.method === "POST") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          serveReadPost("/api/notifications", req, res, body);
          return;
        }
        if (path.startsWith("/api/notifications/") && req.method === "DELETE") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          const rawId = path.slice("/api/notifications/".length);
          const id = Number(rawId);
          if (!Number.isInteger(id) || id <= 0) {
            validationError(res, "notification rule id must be a positive integer");
            return;
          }
          const existing = listRules(opts.store).some((rule) => rule.id === id);
          if (!existing) {
            sendJson(res, 404, { error: { code: "NOT_FOUND", message: "rule not found" } });
            return;
          }
          deleteRule(opts.store, id);
          sendJson(res, 200, { ok: true });
          return;
        }
        if (path === "/api/contacts") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          const params = new URL(req.url ?? "/", "http://localhost").searchParams;
          const limit = intParam(params, "limit");
          if (!limit.ok) {
            validationError(res, "limit must be a number");
            return;
          }
          sendJson(res, 200, {
            contacts: listContacts(opts.store, {
              query: params.get("query") ?? undefined,
              limit: limit.value,
            }),
          });
          return;
        }
        if (path === "/api/unread") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          sendJson(res, 200, { unread: getUnreadCounts(opts.store) });
          return;
        }
        if (path === "/api/qr") {
          void serveQr(req, res).catch((err) => {
            opts.logger?.warn({ err }, "qr route failed");
            sendJson(res, 500, { error: { code: "INTERNAL", message: "qr failed" } });
          });
          return;
        }
        if (path === "/api/ui-token" && req.method === "GET") {
          // ADR 0012: one-time exchange so the loopback web UI can hold the real
          // token. Double-gated: the loopback Host + same-origin guard above,
          // and the scoped pairing token itself.
          sendJson(res, 200, { token: opts.token });
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
          sendJson(res, 501, {
            error: { code: "NOT_IMPLEMENTED", message: "route not wired yet" },
          });
          return;
        }
        sendJson(res, 404, { error: { code: "NOT_FOUND", message: "unknown route" } });
      })
      .catch(respondOrLog(res, opts.logger));
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
  selfPort = port;
  return {
    server,
    port,
    close: () =>
      new Promise<void>((resolve) => {
        server.close(() => resolve());
      }),
  };
}
