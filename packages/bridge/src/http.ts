import { createHash, randomBytes, timingSafeEqual } from "node:crypto";
import type { AnyMessageContent, proto, WAMessage } from "baileys";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import type { IncomingMessage, Server, ServerResponse } from "node:http";
import { join, resolve, sep } from "node:path";
import { realpath } from "node:fs/promises";
import type { BridgeHandle } from "./lifecycle.ts";
import { isSafePublicEvent } from "./events.ts";
import { spawn } from "node:child_process";
import { toVoiceOgg } from "./media/voice.ts";
import type { LookupFn } from "./media/resolve.ts";
import {
  addSendRule,
  evaluateSendRules,
  listSendRules,
  removeSendRule,
} from "./store/send-rules.ts";
import { deleteTemplate, listTemplates, upsertTemplate } from "./store/templates.ts";
import { cancelScheduled, listScheduled, scheduleMessage } from "./store/scheduled.ts";

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
import { getContact, listContacts, setAlias } from "./store/contacts.ts";
import { assignChatLabel, chatLabels, addLabel, listLabels, removeLabel } from "./store/labels.ts";
import { exportMessages } from "./store/export.ts";
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
import { createRule, deleteRule, evaluateRules, listRules } from "./notifications.ts";
import {
  createSubscription,
  deleteSubscription,
  listSubscriptions,
  matchSubscription,
  subscriptionDir,
} from "./subscriptions.ts";
import { openInbox } from "./inbox.ts";
import { toMcpNotifications, createToolsChangedWatcher } from "./mcp-notify.ts";
import { randomUUID as sessionIdGen } from "node:crypto";
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
  countMessages,
  getMessageContext,
  pollVotesAggregate,
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
import { viewMedia } from "./media/view.ts";
import { extractDocumentText } from "./media/document.ts";
import {
  createTranscriptionEngine,
  saveTranscript,
  getTranscript,
  resolveTranscriptionSettings,
  readBridgeConfig,
  writeTranscriptionSection,
  extractAudio,
} from "./media/transcribe.ts";
import { MockTtsEngine } from "./media/tts.ts";
import {
  TOOLS,
  handleRpcMessage,
  shouldForward,
  type ServerContext,
  type McpSession,
} from "@wa-mcp/mcp-server";
import { buildVcard } from "./send/build.ts";
import { buildButtonsMessage, buildListMessage } from "./send/build.ts";
import {
  canonicalChatJid,
  resolveRecipient,
  SendError,
  sendProtoViaSocket,
  sendViaSocket,
} from "./send/send.ts";
import type { SendGuard } from "./send/safety.ts";

export interface HttpServerOptions {
  token: string;
  dataDir?: string;
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
  /** T81 line72: process spawner for the voice-note ffmpeg conversion */
  spawnFn?: typeof spawn;
  eventsHeartbeatMs?: number;
  uiDir?: string;
  rateLimitNow?: () => number;
  /** pino-style logger for server-side diagnostics (send failures etc.) */
  logger?: { error(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void };
  /** ephemeral per-boot token for the public pairing surface (T53):
   * /health publishes it; it authorizes /api/qr, /api/pairing-code and
   * /api/pair/resume ONLY — never account data. */
  pairingToken?: string;
  /** T93-C2: the credential minted for the web UI — own rate bucket */
  uiToken?: string;
  /** T94-G: STABLE bootstrap credential persisted in the data dir (0600) —
   * survives daemon restarts so a fresh browser bootstraps on a paired
   * daemon without any user action */
  uiBootstrapToken?: string;
  /** T107: root directory for subscription inboxes; when present with a
   * store, the daemon serves /api/subscriptions and wires bus events to
   * matching inboxes. */
  subscriptionsDir?: string;
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

/** T74: /health is polled by every open web UI tab (5s cadence) but is cheap
 * and public. A dedicated, more generous bucket keeps it anti-abuse-safe
 * (a poll every 500ms from one IP survives 10 tabs) without letting it eat
 * the API bucket. */
const HEALTH_RATE = { capacity: 120, refillPerMinute: 120 };

/** T93-C2: the web UI polls chats/messages/health every few seconds per tab.
 * It mints its own credential at /api/ui-token; requests presenting it ride
 * THIS bucket, so open UI tabs can never starve the per-IP API bucket that
 * agent clients share (and vice versa). Same anti-abuse posture as the
 * health bucket: generous transport, no engine risk (sends stay guarded by
 * the T82 send-guard). */
const UI_RATE = { capacity: 240, refillPerMinute: 240 };

/** ADR 0012: the pairing surface serves one flow — the pairing page polls
 * /health and /api/qr alternately at ~3s. T75: it rides the same generous
 * bucket as /health; engine-side abuse is already capped by the T56 pairing
 * budget, so transport generosity adds no engine risk, and the 60/min API
 * bucket stays entirely for authenticated API work. */
const PAIRING_SURFACE: ReadonlySet<string> = new Set([
  "/api/qr",
  "/api/pairing-code",
  // T94-E H3 (RUNTIME review): /api/pair/resume LEFT this surface — the
  // public pairing token could drop the session, reset the anti-abuse
  // budget and stack sockets. Resume now needs the account token (the UI
  // holds it after the first pairing).
  "/api/ui-token",
]);
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

/** T94-F Runtime-M1: when the caller names a chat, the media row must belong
 * to it — an id alone must not be replayable across chat contexts. */
function mediaChatMismatch(rowChatJid: string | null | undefined, claimed: unknown): boolean {
  if (typeof claimed !== "string" || claimed.length === 0) {
    return false;
  }
  return rowChatJid !== claimed;
}

/** T94-C2: the ONE send-policy gate — restrict rules + send budget — shared
 * by every secondary send path (tts, voice, newsletter, batch forward).
 * Returns the refusal to send, or null when the send may proceed. */
function sendPolicyRefusal(
  store: Store | undefined,
  guard: SendGuard | undefined,
  target: string,
  now: number,
): { status: number; payload: Record<string, unknown> } | null {
  if (store !== undefined) {
    const verdict = evaluateSendRules(store, target);
    if (!verdict.allowed) {
      return {
        status: 403,
        payload: {
          error: {
            code: "SEND_BLOCKED",
            message: `sending to ${target} is blocked by rule #${verdict.rule?.id} (${verdict.rule?.target})`,
          },
        },
      };
    }
  }
  if (guard !== undefined) {
    const check = guard.check(now);
    if (!check.ok) {
      return check.code === "RATE_LIMITED"
        ? {
            status: 429,
            payload: {
              error: {
                code: "RATE_LIMITED",
                message: "sending too fast",
                retryAfterMs: check.retryAfterMs,
              },
            },
          }
        : {
            status: 429,
            payload: {
              error: {
                code: "DAILY_CAP_EXCEEDED",
                message: `daily send cap of ${check.cap} reached`,
              },
            },
          };
    }
  }
  return null;
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
  // T93-C2: a distinct UI credential — full API surface, own rate bucket
  const uiToken = opts.uiToken ?? randomBytes(24).toString("hex");
  const uiBootstrapToken = opts.uiBootstrapToken ?? randomBytes(24).toString("hex");
  const rate = opts.rateLimit ?? DEFAULT_RATE;
  const now = opts.rateLimitNow ?? Date.now;
  const checkRate = createRateLimiter(rate.capacity, rate.refillPerMinute);
  const checkHealthRate = createRateLimiter(HEALTH_RATE.capacity, HEALTH_RATE.refillPerMinute);
  const checkUiRate = createRateLimiter(UI_RATE.capacity, UI_RATE.refillPerMinute);
  const subscriptions = (() => {
    if (opts.subscriptionsDir === undefined || opts.store === undefined) {
      return null;
    }
    const inboxes = new Map<string, ReturnType<typeof openInbox>>();
    const writer = (id: string): ReturnType<typeof openInbox> => {
      const existing = inboxes.get(id);
      if (existing !== undefined) {
        return existing;
      }
      const fresh = openInbox(subscriptionDir(opts.subscriptionsDir as string, id));
      inboxes.set(id, fresh);
      return fresh;
    };
    const unsubscribeBus = handle.events.subscribe((event) => {
      if (event.type !== "messages.upsert" || event.payload.type === "notify") {
        return;
      }
      const ruleMatches = evaluateRules(opts.store as Store, event);
      for (const match of ruleMatches) {
        if (match.deliver.includes("ui")) {
          const frame = `data: ${JSON.stringify({ type: "wa.rule", payload: { ruleId: match.ruleId, title: match.title, body: match.body } })}\n\n`;
          for (const write of eventsWriters) {
            write(frame);
          }
        }
        if (match.deliver.includes("file") && match.subId !== null) {
          const target = listSubscriptions(opts.store as Store).find(
            (sub) => sub.id === match.subId,
          );
          if (target !== undefined) {
            writer(target.id).append({
              ts: new Date().toISOString(),
              kind: "rule",
              chat: target.chatJid ?? "",
              from: "rule",
              text: match.title,
              media: false,
            });
          }
        }
      }
      const subs = listSubscriptions(opts.store as Store);
      for (const upsert of event.payload.messages) {
        const chatJid = upsert.key.remoteJid ?? "";
        const fromJid = upsert.key.participant ?? upsert.key.remoteJid ?? "";
        const content = upsert.message ?? {};
        const text =
          (content as { conversation?: string }).conversation ??
          (content as { extendedTextMessage?: { text?: string } }).extendedTextMessage?.text ??
          "";
        const presentKeys = Object.keys(content as Record<string, unknown>);
        const mediaKeys = [
          "imageMessage",
          "videoMessage",
          "audioMessage",
          "documentMessage",
          "stickerMessage",
        ];
        const media = presentKeys.some((k) => mediaKeys.includes(k));
        for (const sub of subs) {
          if (
            matchSubscription(sub, { chatJid, fromJid, kind: "message", hasMedia: media }) &&
            (sub.includeMedia || !media)
          ) {
            writer(sub.id).append({
              ts: new Date().toISOString(),
              kind: "message",
              chat: chatJid,
              from: fromJid,
              text,
              media,
            });
          }
        }
      }
    });
    return {
      unsubscribeBus,
      writer,
      dropped(): number {
        let total = 0;
        for (const inbox of inboxes.values()) {
          total += inbox.dropped();
        }
        return total;
      },
    };
  })();

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
      const limitValue = limit.value;
      const offsetValue = offset.value ?? 0;
      const messages = listMessages(store, {
        chatJid: params.get("chat_jid") ?? undefined,
        sender: params.get("sender") ?? undefined,
        after: after.value,
        before: before.value,
        limit: limitValue,
        offset: offsetValue,
      });
      // T87 line121: truncation metadata for capped pages
      const total = countMessages(store, {
        chatJid: params.get("chat_jid") ?? undefined,
        sender: params.get("sender") ?? undefined,
        after: after.value,
        before: before.value,
      });
      const returned = messages.length;
      const truncated = offsetValue + returned < total;
      sendJson(res, 200, {
        messages,
        meta: {
          truncated,
          total,
          returned,
          nextOffset: truncated ? offsetValue + returned : offsetValue,
        },
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

  const serveSend = async (
    req: IncomingMessage,
    res: ServerResponse,
    body: Buffer,
  ): Promise<void> => {
    // T82 line91: per-target blocklist rules gate every send
    let parsedSend: unknown;
    try {
      parsedSend = JSON.parse(body.toString("utf8")) as unknown;
    } catch {
      parsedSend = {};
    }
    if (parsedSend === null || typeof parsedSend !== "object") {
      parsedSend = {};
    }
    const sendTarget = (parsedSend as { chat_jid?: unknown }).chat_jid;
    // T94-C2(a): the rules gate runs AFTER recipient resolution (below) so an
    // alias or +phone form cannot dodge a rule written on the resolved jid —
    // and a rule written as an alias still blocks when the jid is passed

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
      reply_to_ids?: unknown;
      link_preview?: unknown;
      media?: unknown;
      caption?: unknown;
      file_name?: unknown;
      message_id?: unknown;
      ids?: unknown;
      emote?: unknown;
      latitude?: unknown;
      longitude?: unknown;
      label?: unknown;
      contact_name?: unknown;
      phones?: unknown;
      poll_name?: unknown;
      options?: unknown;
      selectable_count?: unknown;
      url?: unknown;
      buttons?: unknown;
      sections?: unknown;
    };
    // T90 line77: status broadcasts need no recipient — status@broadcast is implied
    if (
      input.kind !== "status-text" &&
      (typeof input.chat_jid !== "string" || input.chat_jid.length === 0)
    ) {
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
    let chatJid: string =
      input.kind === "status-text" ? "status@broadcast" : (input.chat_jid as string);
    const kind = typeof input.kind === "string" ? input.kind : "text";
    let mediaToSave: ResolvedMedia | null = null;
    let quotedForWire: WAMessage | undefined;
    let builder: (() => Promise<AnyMessageContent>) | null = null;
    // T92: raw-interactive kinds (buttons/list) build protos for the relay path —
    // sendMessage rejects raw protos (engine truth: Invalid media type)
    let protoBuilder: (() => proto.IMessage) | null = null;
    let broadcastStatus = false;
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
      case "status-text": {
        if (typeof input.text !== "string" || input.text.length === 0) {
          validationError(res, "text is required");
          return;
        }
        builder = () => Promise.resolve({ text: input.text } as AnyMessageContent);
        broadcastStatus = true;
        break;
      }
      case "link_preview": {
        // T92 engine truth: the fork's text branch merges a WAUrlInfo linkPreview
        // into extendedTextMessage — a raw extendedTextMessage proto would fall
        // through to prepareWAMessageMedia and throw Invalid media type
        if (typeof input.text !== "string" || input.text.length === 0) {
          validationError(res, "text is required");
          return;
        }
        if (typeof input.url !== "string" || input.url.length === 0) {
          validationError(res, "url is required");
          return;
        }
        const text: string = input.text;
        const url: string = input.url;
        builder = () =>
          Promise.resolve({
            text,
            linkPreview: { "canonical-url": url, "matched-text": url, title: "" },
          } as AnyMessageContent);
        break;
      }
      case "buttons": {
        if (typeof input.text !== "string" || input.text.length === 0) {
          validationError(res, "text is required");
          return;
        }
        if (!Array.isArray(input.buttons) || input.buttons.length === 0) {
          validationError(res, "buttons must be a non-empty array");
          return;
        }
        const text: string = input.text;
        const buttons = (input.buttons as unknown[])
          .map((button) => {
            if (typeof button === "string") {
              return button;
            }
            if (typeof button === "object" && button !== null && "title" in button) {
              const title = (button as { title?: unknown }).title;
              if (typeof title === "string") {
                return title;
              }
            }
            return null;
          })
          .filter((label): label is string => label !== null);
        if (buttons.length === 0) {
          validationError(res, "buttons entries must carry a title");
          return;
        }
        const footer: string | undefined =
          typeof input.caption === "string" ? input.caption : undefined;
        protoBuilder = () => buildButtonsMessage(text, buttons, footer);
        break;
      }
      case "list": {
        if (typeof input.text !== "string" || input.text.length === 0) {
          validationError(res, "text is required");
          return;
        }
        const rawSections = input.sections;
        if (!Array.isArray(rawSections) || rawSections.length === 0) {
          validationError(res, "sections must be a non-empty array");
          return;
        }
        const text: string = input.text;
        const sections = (rawSections as unknown[]).map((section) => {
          const s = section as { title?: unknown; rows?: unknown };
          const rows = (Array.isArray(s.rows) ? s.rows : []).map((row) => {
            const r = row as {
              title?: unknown;
              row_id?: unknown;
              rowId?: unknown;
              description?: unknown;
            };
            const rowId: string =
              typeof r.row_id === "string" ? r.row_id : typeof r.rowId === "string" ? r.rowId : "";
            return {
              title: typeof r.title === "string" ? r.title : "",
              rowId,
              description: typeof r.description === "string" ? r.description : undefined,
            };
          });
          return {
            title: typeof s.title === "string" ? s.title : "",
            rows,
          };
        });
        if (sections.every((section) => section.rows.length === 0)) {
          validationError(res, "sections must contain at least one row");
          return;
        }
        protoBuilder = () => buildListMessage(text, text, sections);
        break;
      }
      case "forward": {
        // T85 line96: batch forward — one engine call per id, sequential
        if (Array.isArray(input.ids)) {
          const socket = handle.socket;
          if (socket === undefined || socket === null) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "bridge not connected" },
            });
            return;
          }
          const ids = (input.ids as unknown[]).filter(
            (id): id is string => typeof id === "string" && id.length > 0,
          );
          if (ids.length === 0) {
            validationError(res, "ids must contain at least one message id");
            return;
          }
          void (async () => {
            const messageIds: string[] = [];
            for (const id of ids) {
              const original = fetchMessageFromStore(opts.store!, id);
              if (original === null) {
                sendJson(res, 404, {
                  error: { code: "NOT_FOUND", message: `message ${id} not found` },
                });
                return;
              }
            }
            // T94-C2(b): the batch rides the SAME gate as the single send —
            // recipient resolution, restrict rules, the send budget, and
            // persistence were all skipped on this path
            const batchRaw = chatJid as string;
            let batchTarget = batchRaw;
            if (opts.store !== undefined) {
              const resolution = resolveRecipient(opts.store, batchRaw);
              if (!resolution.ok) {
                sendJson(res, 400, {
                  error: { code: resolution.code, message: resolution.message },
                });
                return;
              }
              batchTarget = resolution.jid;
            } else if (!isValidRecipientJid(batchRaw)) {
              sendJson(res, 400, {
                error: { code: "INVALID_JID", message: `cannot resolve recipient: ${batchRaw}` },
              });
              return;
            }
            const refusal = sendPolicyRefusal(opts.store, opts.sendGuard, batchTarget, Date.now());
            if (refusal !== null) {
              sendJson(res, refusal.status, refusal.payload);
              return;
            }
            // T94-E H2: a batch of N draws N from the budget BEFORE sending;
            // a refusal mid-reservation releases what was reserved
            let reserved = 1;
            let budgetRefused = false;
            for (let index = 1; index < ids.length; index += 1) {
              const verdict = opts.sendGuard?.check(Date.now());
              if (verdict === undefined || verdict.ok) {
                reserved += 1;
              } else {
                budgetRefused = true;
                break;
              }
            }
            if (budgetRefused) {
              for (let index = 0; index < reserved; index += 1) {
                opts.sendGuard?.release(Date.now());
              }
              sendJson(res, 429, {
                error: {
                  code: "DAILY_CAP_EXCEEDED",
                  message: `batch of ${ids.length} exceeds the remaining daily budget`,
                },
              });
              return;
            }
            for (const id of ids) {
              const original = fetchMessageFromStore(opts.store!, id);
              const result = await sendViaSocket(
                socket,
                batchTarget,
                {
                  forward: original,
                } as unknown as AnyMessageContent,
                { store: opts.store },
              );
              messageIds.push(result.messageId);
            }
            sendJson(res, 200, { message_ids: messageIds });
          })().catch((err: unknown) => {
            if (err instanceof SendError) {
              sendJson(res, err.code === "SEND_FAILED" ? 500 : 400, {
                error: { code: err.code, message: err.message },
              });
              return;
            }
            sendJson(res, 500, { error: { code: "INTERNAL", message: "batch forward failed" } });
          });
          return;
        }
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
    // T94-C2(a): rules against BOTH the caller's form and the resolved jid —
    // either match blocks the send. Alias-authored rules are included via the
    // jid->alias inverse so the resolved form cannot dodge them either.
    if (opts.store !== undefined) {
      const candidates = new Set<string>([chatJid]);
      if (typeof sendTarget === "string" && sendTarget.length > 0) {
        candidates.add(sendTarget);
      }
      try {
        const aliasRows = opts.store.db
          .prepare("SELECT alias FROM aliases WHERE jid = ?")
          .all(chatJid) as Array<{ alias: string }>;
        for (const row of aliasRows) {
          if (typeof row.alias === "string" && row.alias.length > 0) {
            candidates.add(row.alias);
          }
        }
      } catch {
        // the aliases table is best-effort here — rules on the jid itself
        // already evaluated below
      }
      const liveSocket = handle.socket;
      const refuseIfBlocked = (extra?: string): boolean => {
        const checks = extra === undefined ? [...candidates] : [...candidates, extra];
        for (const candidate of checks) {
          const refusal = sendPolicyRefusal(opts.store, undefined, candidate, Date.now());
          if (refusal !== null) {
            sendJson(res, refusal.status, refusal.payload);
            return true;
          }
        }
        return false;
      };
      if (refuseIfBlocked()) {
        return;
      }
      if (liveSocket !== undefined && liveSocket !== null && chatJid.includes("@lid")) {
        try {
          const canonical = await canonicalChatJid(liveSocket as never, chatJid);
          if (canonical !== chatJid) {
            candidates.add(canonical);
            if (refuseIfBlocked()) {
              return;
            }
          }
        } catch {
          // canonicalization is best-effort — the raw forms already evaluated
        }
      }
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
    if (protoBuilder !== null) {
      const buildProto = protoBuilder;
      void (async () => {
        const result = await sendProtoViaSocket(socket, chatJid, buildProto(), {
          store: opts.store,
          quoted: quotedForWire,
        });
        sendJson(res, 200, { message_id: result.messageId });
      })().catch((err: unknown) => {
        if (err instanceof SendError) {
          opts.logger?.error({ code: err.code, message: err.message }, "send failed");
          const status =
            err.code === "SENDS_DISABLED" ? 403 : err.code === "SEND_FAILED" ? 500 : 400;
          sendJson(res, status, { error: { code: err.code, message: err.message } });
          return;
        }
        sendJson(res, 500, { error: { code: "INTERNAL", message: "send failed" } });
      });
      return;
    }
    const contentBuilder = builder;
    if (contentBuilder === null) {
      // unreachable — every non-relay kind branch assigns a builder
      validationError(res, `unknown send kind: ${kind}`);
      return;
    }
    void contentBuilder()
      .then((content) =>
        sendViaSocket(socket, broadcastStatus ? "status@broadcast" : chatJid, content, {
          ...opts,
          quoted: quotedForWire,
        }),
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
        sendJson(res, 200, { message_id: result.messageId });
      })
      .catch((err: unknown) => {
        // T94-E H2: the failed send gives its reservation back
        opts.sendGuard?.release(Date.now());
        if (err instanceof SendError) {
          // T56/T84: structured errors are still LOGGED — silent failures forbidden
          opts.logger?.error(
            {
              code: err.code,
              message: err.message,
              retryAfterSeconds: err.retryAfterSeconds,
              hint: err.hint,
            },
            "send failed",
          );
          const status =
            err.code === "SENDS_DISABLED" ? 403 : err.code === "SEND_FAILED" ? 500 : 400;
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
  const mcpSessions = new Map<string, McpSession>();
  const eventsWriters = new Set<(frame: string) => void>();
  const toolsChanged = createToolsChangedWatcher(() => TOOLS.map((tool) => tool.name));
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
    const sessionHeader = Array.isArray(req.headers["mcp-session-id"])
      ? (req.headers["mcp-session-id"][0] as string)
      : (req.headers["mcp-session-id"] as string | undefined);
    const existingSession =
      sessionHeader !== undefined ? mcpSessions.get(sessionHeader) : undefined;
    const session = existingSession ?? { subscriptions: new Set<string>() };
    const ctx: ServerContext = {
      tools: TOOLS,
      bridgeUrl: selfUrl,
      token: opts.token,
      // no lookupFn here: MCP tools relay over HTTP and the BRIDGE resolves
      // media urls (send route) with its own SSRF guard — the RPC layer
      // never resolves DNS itself
      fetchFn: opts.fetchFn,
      session,
    };
    const isInitialize =
      parsed !== null &&
      typeof parsed === "object" &&
      (parsed as { method?: unknown }).method === "initialize";
    const sessionId = isInitialize ? sessionIdGen() : sessionHeader;
    if (sessionId !== undefined) {
      mcpSessions.set(sessionId, session);
    }
    void handleRpcMessage(parsed, ctx).then(
      (response) => {
        if (sessionId !== undefined) {
          res.setHeader("Mcp-Session-Id", sessionId);
        }
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
      deliver?: unknown;
      sub_id?: unknown;
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
      let deliver: string[] | undefined;
      if (input.deliver !== undefined) {
        if (!Array.isArray(input.deliver) || !input.deliver.every((d) => typeof d === "string")) {
          validationError(res, "deliver must be an array of strings");
          return;
        }
        const channels = input.deliver as string[];
        const known = ["mcp", "file", "ui"];
        for (const channel of channels) {
          if (!known.includes(channel)) {
            validationError(res, `unknown deliver channel: ${channel}`);
            return;
          }
        }
        if (channels.includes("file") && typeof input.sub_id !== "string") {
          validationError(res, "sub_id is required when deliver includes file");
          return;
        }
        deliver = channels;
      }
      const rule = createRule(opts.store as Store, {
        title: input.title,
        body: typeof input.body === "string" ? input.body : undefined,
        chatJid: typeof input.chat_jid === "string" ? input.chat_jid : undefined,
        fromJid: typeof input.from_jid === "string" ? input.from_jid : undefined,
        unreadOnly: input.unread_only === true,
        deliver,
        subId: typeof input.sub_id === "string" ? input.sub_id : undefined,
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
    const settings = resolveTranscriptionSettings(opts.dataDir);
    const engineName = settings.engine;
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
        .prepare("SELECT media_path, media_type FROM messages WHERE id = ?")
        .get(messageId) as { media_path: string | null; media_type: string | null } | undefined;
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
      const engine = createTranscriptionEngine(engineName, {
        apiKey: settings.apiKey,
        baseUrl: settings.baseUrl,
        model: settings.model,
      });
      const mime =
        row?.media_type !== null && row?.media_type !== undefined && row.media_type.length > 0
          ? row.media_type
          : "audio/ogg";
      let audioBuffer = buffer;
      if (mime.startsWith("video/")) {
        audioBuffer = await extractAudio(buffer, mime, {
          ffmpegPath: process.env.WA_FFMPEG_BIN ?? "ffmpeg",
        });
      }
      const result = await engine.transcribe(
        audioBuffer,
        mime.startsWith("video/") ? "audio/wav" : mime,
      );
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
        if (err instanceof MediaError && err.code === "ENGINE_NOT_CONFIGURED") {
          sendJson(res, 422, {
            error: { code: err.code, message: err.message, setup: err.message },
          });
          return;
        }
        if (err instanceof MediaError && err.code === "ENGINE_UNAVAILABLE") {
          sendJson(res, 422, {
            error: { code: err.code, message: err.message, setup: err.message },
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
    // T81 line72: real-audio voice notes — a file path or URL converts via
    // ffmpeg to ogg/opus PTT; the text path (and its mock-engine refusal)
    // is untouched
    const audioPath = (parsed as { audio_path?: unknown }).audio_path;
    const audioUrl = (parsed as { audio_url?: unknown }).audio_url;
    if (audioPath !== undefined || audioUrl !== undefined) {
      if (typeof audioPath !== "string" && typeof audioUrl !== "string") {
        validationError(res, "audio_path or audio_url must be a string");
        return;
      }
      if (chatJid === undefined) {
        validationError(res, "chat_jid is required when sending a voice file");
        return;
      }
      void toVoiceOgg(
        typeof audioPath === "string" ? { path: audioPath } : { url: audioUrl as string },
        { spawnFn: opts.spawnFn, fetchFn: opts.fetchFn, lookupFn: opts.lookupFn },
      )
        .then(async (ogg) => {
          const socket = handle.socket;
          if (socket === undefined || socket === null) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "bridge not connected" },
            });
            return;
          }
          // T94-C2(d): the tts send leg rides the same gate
          const ttsRefusal = sendPolicyRefusal(
            opts.store,
            opts.sendGuard,
            chatJid as string,
            Date.now(),
          );
          if (ttsRefusal !== null) {
            sendJson(res, ttsRefusal.status, ttsRefusal.payload);
            return;
          }
          const result = await sendViaSocket(
            socket,
            chatJid as string,
            {
              audio: ogg,
              ptt: true,
              mimetype: "audio/ogg",
            } as AnyMessageContent,
          );
          sendJson(res, 200, { message_id: result.messageId });
        })
        .catch((err: unknown) => {
          if (err instanceof MediaError) {
            const status = err.code === "FFMPEG_UNAVAILABLE" ? 422 : 400;
            sendJson(res, status, { error: { code: err.code, message: err.message } });
            return;
          }
          if (err instanceof SendError) {
            sendJson(res, err.code === "SENDS_DISABLED" ? 403 : 400, {
              error: { code: err.code, message: err.message },
            });
            return;
          }
          sendJson(res, 500, { error: { code: "INTERNAL", message: "voice send failed" } });
        });
      return;
    }
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
        // T76 H10: the bundled engine is a mock — silent mock audio in real
        // chats is worse than an error. Synth-only stays a dry run; sending
        // requires an explicit opt-in.
        if (process.env.WA_TTS_ALLOW_MOCK !== "1") {
          sendJson(res, 400, {
            error: {
              code: "MOCK_TTS",
              message:
                "tts engine is a mock — configure WA_TTS_* for live voice or set WA_TTS_ALLOW_MOCK=1 to send mock audio deliberately",
            },
          });
          return;
        }
        const socket = handle.socket;
        if (socket === undefined || socket === null) {
          sendJson(res, 501, {
            error: { code: "NOT_IMPLEMENTED", message: "bridge not connected" },
          });
          return;
        }
        // T94-C2(d): the voice-file send leg rides the same gate
        const voiceRefusal = sendPolicyRefusal(opts.store, opts.sendGuard, chatJid, Date.now());
        if (voiceRefusal !== null) {
          sendJson(res, voiceRefusal.status, voiceRefusal.payload);
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
          const status =
            err.code === "SENDS_DISABLED" ? 403 : err.code === "SEND_FAILED" ? 500 : 400;
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
    const path = new URL(req.url ?? "/", "http://localhost").pathname;
    // T74: neither /health (cheap, polled by every UI tab) nor /events (one
    // long-lived SSE connection) may consume the shared API bucket — a single
    // open web UI would otherwise starve API probes and agent clients. /events
    // gets no bucket at all: a 429 makes EventSource reconnect on a tight
    // loop, re-burning the very bucket it was refused from.
    const bearer =
      typeof req.headers.authorization === "string" &&
      req.headers.authorization.startsWith("Bearer ")
        ? req.headers.authorization.slice("Bearer ".length)
        : null;
    // T94-F Runtime-M2 (RUNTIME review): the API bucket is keyed per-token
    // (hashed bearer), not per-IP — on loopback every client shares
    // 127.0.0.1, so a tokenless flood (401s) or another credential must not
    // starve legitimate traffic. /health stays unauthenticated with its own
    // per-IP bucket.
    const gateKey =
      bearer !== null
        ? `${ip}:${createHash("sha256").update(bearer).digest("hex").slice(0, 16)}`
        : `${ip}:anon`;
    const gate =
      path === "/health" || PAIRING_SURFACE.has(path)
        ? checkHealthRate(ip, now())
        : path === "/events"
          ? null
          : bearer !== null && tokenMatches(bearer, uiToken)
            ? checkUiRate(ip, now())
            : checkRate(gateKey, now());
    if (gate !== null && !gate.ok) {
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
        // T94-E CR1 (RUNTIME review): /health is PUBLIC — the pairing token
        // may only leave it while pairing is actually possible. Once paired,
        // any local process could read it here and exchange it for a
        // full-surface credential at /api/ui-token.
        pairingToken: handle.hasPairedAccount() ? undefined : pairingToken,
        // T94-G: the STABLE bootstrap credential — the pairing token rotates
        // per boot, so a paired daemon would strand fresh browsers without it
        uiBootstrapToken,
        channel: opts.cloud ? "cloud" : "baileys",
        credentialsValid: opts.cloud ? opts.cloud.config.verifyToken.length > 0 : undefined,
        version: opts.version ?? "0.0.0",
        uptime: Math.floor((Date.now() - startedAt) / 1000),
        // T107: subscription delivery health
        subscriptions: {
          count:
            opts.store !== undefined && subscriptions !== null
              ? listSubscriptions(opts.store).length
              : 0,
          dropped: subscriptions?.dropped() ?? 0,
        },
        // T79 line49: connection-quality counters
        reconnects: handle.connectionQuality().reconnects,
        contactsWarm: handle.contactsWarm(),
        lastDisconnectAt: handle.connectionQuality().lastDisconnectAt,
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
    const pairingTokenAuthorized =
      presented !== null && tokenMatches(presented, pairingToken) && PAIRING_SURFACE.has(path);
    // T94-G: the STABLE bootstrap token opens exactly the exchange route
    const bootstrapAuthorized =
      presented !== null && tokenMatches(presented, uiBootstrapToken) && path === "/api/ui-token";
    if (
      !pairingTokenAuthorized &&
      !bootstrapAuthorized &&
      (presented === null ||
        (!tokenMatches(presented, opts.token) && !tokenMatches(presented, uiToken)))
    ) {
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
          void serveSend(req, res, body);
          return;
        }
        if (path === "/mcp" && req.method === "POST") {
          serveMcp(req, res, body);
          return;
        }
        if (path === "/mcp" && req.method === "GET") {
          const sessionHeader = Array.isArray(req.headers["mcp-session-id"])
            ? (req.headers["mcp-session-id"][0] as string)
            : (req.headers["mcp-session-id"] as string | undefined);
          const session = sessionHeader !== undefined ? mcpSessions.get(sessionHeader) : undefined;
          if (session === undefined) {
            sendJson(res, 404, {
              error: { code: "SESSION_NOT_FOUND", message: "unknown Mcp-Session-Id" },
            });
            return;
          }
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          });
          res.write(": connected\n\n");
          const unsubscribeMcp = handle.events.subscribe((event) => {
            for (const notification of toMcpNotifications(event)) {
              if (shouldForward(session, notification)) {
                res.write(`data: ${JSON.stringify(notification)}\n\n`);
              }
            }
            if (event.type === "connection.update") {
              for (const notification of toolsChanged()) {
                if (shouldForward(session, notification)) {
                  res.write(`data: ${JSON.stringify(notification)}\n\n`);
                }
              }
            }
          });
          req.on("close", () => {
            unsubscribeMcp();
          });
          return;
        }
        if (path === "/api/mcp-notify" && req.method === "GET") {
          res.writeHead(200, {
            "content-type": "text/event-stream",
            "cache-control": "no-cache",
            connection: "keep-alive",
          });
          res.write(": connected\n\n");
          const unsubscribeNotify = handle.events.subscribe((event) => {
            for (const notification of toMcpNotifications(event)) {
              res.write(`data: ${JSON.stringify(notification)}\n\n`);
            }
            if (event.type === "connection.update") {
              for (const notification of toolsChanged()) {
                res.write(`data: ${JSON.stringify(notification)}\n\n`);
              }
            }
          });
          req.on("close", () => {
            unsubscribeNotify();
          });
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
          const eventsWrite = (frame: string): void => {
            res.write(frame);
          };
          eventsWriters.add(eventsWrite);
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
            eventsWriters.delete(eventsWrite);
            unsubscribe();
            clearInterval(heartbeat);
          });
          return;
        }
        if (path.startsWith("/api/media/") && path.length > "/api/media/".length) {
          if (path.endsWith("/view") && path.startsWith("/api/media/") && req.method === "POST") {
            const messageId = path.slice("/api/media/".length, -"/view".length);
            if (!/^[A-Za-z0-9_-]+$/.test(messageId)) {
              validationError(res, "invalid message id");
              return;
            }
            const store = opts.store;
            const socketOk = handle.socket !== undefined && handle.socket !== null;
            if (store === undefined || !socketOk) {
              sendJson(res, 404, { error: { code: "NOT_FOUND", message: "message not found" } });
              return;
            }
            const original = fetchMessageFromStore(store, messageId);
            if (original === null) {
              sendJson(res, 404, { error: { code: "NOT_FOUND", message: "message not found" } });
              return;
            }
            // T94-F Runtime-M1: chat-scoped when the caller names one
            let viewChat: unknown;
            try {
              viewChat = JSON.parse(body.toString("utf8"))?.chat_jid;
            } catch {
              viewChat = undefined;
            }
            if (mediaChatMismatch(original.key.remoteJid, viewChat)) {
              sendJson(res, 404, { error: { code: "NOT_FOUND", message: "message not found" } });
              return;
            }
            const row = store.db
              .prepare("SELECT media_path, media_type FROM messages WHERE id = ?")
              .get(messageId) as
              | { media_path: string | null; media_type: string | null }
              | undefined;
            void (async () => {
              let path: string;
              let mime: string;
              if (row?.media_path) {
                path = row.media_path;
                mime = row.media_type === "image" ? "image/jpeg" : "video/mp4";
              } else {
                const downloaded = await downloadMessageMedia(handle.socket as never, original, {
                  store,
                  mediaDir: opts.mediaDir ?? ".",
                  messageId,
                });
                path = downloaded.path;
                mime = downloaded.mime;
              }
              const result = await viewMedia({ path, mime }, { spawnFn: opts.spawnFn });
              sendJson(res, 200, result);
            })().catch((err: unknown) => {
              if (err instanceof MediaError) {
                const status = err.code === "PAYLOAD_TOO_LARGE" ? 413 : 422;
                sendJson(res, status, { error: { code: err.code, message: err.message } });
                return;
              }
              sendJson(res, 500, { error: { code: "INTERNAL", message: "view failed" } });
            });
            return;
          }
          if (path.endsWith("/text") && path.startsWith("/api/media/") && req.method === "POST") {
            const messageId = path.slice("/api/media/".length, -"/text".length);
            if (!/^[A-Za-z0-9_-]+$/.test(messageId)) {
              validationError(res, "invalid message id");
              return;
            }
            const store = opts.store;
            if (store === undefined) {
              sendJson(res, 501, {
                error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
              });
              return;
            }
            const original = fetchMessageFromStore(store, messageId);
            if (original === null) {
              sendJson(res, 404, { error: { code: "NOT_FOUND", message: "message not found" } });
              return;
            }
            void (async () => {
              const row = store.db
                .prepare("SELECT media_path, media_type FROM messages WHERE id = ?")
                .get(messageId) as
                | { media_path: string | null; media_type: string | null }
                | undefined;
              let mediaPath = row?.media_path ?? null;
              let mime = row?.media_type ?? null;
              if (mediaPath === null || mime === null) {
                if (handle.socket === undefined || handle.socket === null) {
                  throw new MediaError("NOT_FOUND", "message has no downloaded media");
                }
                const downloaded = await downloadMessageMedia(handle.socket as never, original, {
                  store,
                  mediaDir: opts.mediaDir ?? ".",
                  messageId,
                });
                mediaPath = downloaded.path;
                mime = downloaded.mime;
              }
              const result = await extractDocumentText(mediaPath, mime);
              saveTranscript(
                store,
                original.key.remoteJid ?? "",
                messageId,
                result.engine,
                result.text,
                undefined,
                "document",
              );
              sendJson(res, 200, {
                text: result.text,
                engine: result.engine,
                truncated: result.truncated,
                cached: false,
              });
            })().catch((err: unknown) => {
              if (err instanceof MediaError) {
                const status =
                  err.code === "TOO_LARGE" ? 413 : err.code === "VALIDATION_ERROR" ? 422 : 422;
                sendJson(res, status, { error: { code: err.code, message: err.message } });
                return;
              }
              sendJson(res, 500, { error: { code: "INTERNAL", message: "document text failed" } });
            });
            return;
          }
          if (
            path.endsWith("/download") &&
            path.startsWith("/api/media/") &&
            req.method === "POST"
          ) {
            const messageId = path.slice("/api/media/".length, -"/download".length);
            if (!/^[A-Za-z0-9_-]+$/.test(messageId)) {
              validationError(res, "invalid message id");
              return;
            }
            const socket = handle.socket;
            const original =
              opts.store !== undefined ? fetchMessageFromStore(opts.store, messageId) : null;
            // T94-F Runtime-M1: chat-scoped when the caller names one
            let downloadChat: unknown;
            try {
              downloadChat = JSON.parse(body.toString("utf8"))?.chat_jid;
            } catch {
              downloadChat = undefined;
            }
            if (mediaChatMismatch(original?.key.remoteJid, downloadChat)) {
              sendJson(res, 404, { error: { code: "NOT_FOUND", message: "message not found" } });
              return;
            }
            if (
              socket === undefined ||
              socket === null ||
              opts.store === undefined ||
              original === null
            ) {
              sendJson(res, 404, { error: { code: "NOT_FOUND", message: "message not found" } });
              return;
            }
            const existing = opts.store.db
              .prepare("SELECT media_path FROM messages WHERE id = ?")
              .get(messageId) as { media_path: string | null } | undefined;
            if (existing?.media_path) {
              sendJson(res, 200, { path: existing.media_path, downloaded: false });
              return;
            }
            void downloadMessageMedia(socket, original, {
              store: opts.store,
              mediaDir: opts.mediaDir as string,
              messageId,
            })
              .then((downloaded) => {
                opts.store?.db
                  .prepare("UPDATE messages SET media_path = ? WHERE id = ?")
                  .run(downloaded.path, messageId);
                sendJson(res, 200, { path: downloaded.path, downloaded: true });
              })
              .catch((err: unknown) => {
                opts.logger?.error({ err }, "forced media download failed");
                sendJson(res, 500, { error: { code: "INTERNAL", message: "download failed" } });
              });
            return;
          }
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
        if (path === "/api/fetch-history" && req.method === "POST") {
          const input = JSON.parse(body.toString("utf8")) as {
            chat_jid?: unknown;
            count?: unknown;
          };
          if (typeof input.chat_jid !== "string" || input.chat_jid.length === 0) {
            validationError(res, "chat_jid is required");
            return;
          }
          const count = typeof input.count === "number" ? input.count : 25;
          const result = await handle.fetchHistory(input.chat_jid, count);
          sendJson(res, 200, result);
          return;
        }
        // T93-B: per-chat digest for the digest_group tool — counts, top
        // participants, open questions and media since a date
        if (path === "/api/digest" && req.method === "GET") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          const params = new URL(req.url ?? "/", "http://localhost").searchParams;
          const chatJid = params.get("chat_jid");
          const since = params.get("since");
          if (chatJid === null || chatJid.length === 0) {
            validationError(res, "chat_jid is required");
            return;
          }
          if (since === null || since.length === 0) {
            validationError(res, "since is required (ISO timestamp)");
            return;
          }
          const rows = opts.store.db
            .prepare(
              "SELECT sender_jid, sender_name, content, media_type, timestamp FROM messages WHERE chat_jid = ? AND timestamp >= ? ORDER BY timestamp",
            )
            .all(chatJid, since) as Array<{
            sender_jid: string | null;
            sender_name: string | null;
            content: string | null;
            media_type: string | null;
            timestamp: string;
          }>;
          const counts = new Map<
            string,
            { participant: string; name: string | null; count: number }
          >();
          let mediaCount = 0;
          const questions: Array<{
            sender: string;
            name: string | null;
            excerpt: string;
            at: string;
          }> = [];
          for (const row of rows) {
            const participant = row.sender_jid ?? "unknown";
            const entry = counts.get(participant) ?? {
              participant,
              name: row.sender_name,
              count: 0,
            };
            entry.count += 1;
            counts.set(participant, entry);
            if (row.media_type !== null && row.media_type !== undefined) {
              mediaCount += 1;
            }
            if (row.content !== null && row.content.includes("?")) {
              questions.push({
                sender: participant,
                name: row.sender_name,
                excerpt: row.content.slice(0, 140),
                at: row.timestamp,
              });
            }
          }
          const chatRow = opts.store.db
            .prepare("SELECT name FROM chats WHERE jid = ?")
            .get(chatJid) as { name?: string } | undefined;
          sendJson(res, 200, {
            chat_jid: chatJid,
            name: chatRow?.name ?? null,
            since,
            message_count: rows.length,
            media_count: mediaCount,
            top_participants: [...counts.values()].sort((a, b) => b.count - a.count).slice(0, 5),
            questions: questions.slice(0, 10),
          });
          return;
        }
        if (path === "/api/catch-up" && req.method === "GET") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          const params = new URL(req.url ?? "/", "http://localhost").searchParams;
          const since = params.get("since");
          if (since === null || since.length === 0) {
            validationError(res, "since is required (ISO timestamp)");
            return;
          }
          const rows = opts.store.db
            .prepare(
              "SELECT chat_jid, content, media_type, timestamp, is_from_me FROM messages WHERE timestamp >= ? ORDER BY timestamp",
            )
            .all(since) as Array<{
            chat_jid: string;
            content: string | null;
            media_type: string | null;
            timestamp: string;
            is_from_me: number;
          }>;
          const byChat = new Map<
            string,
            { jid: string; name: string | null; messageCount: number; lastActivity: string }
          >();
          let mediaCount = 0;
          const questions: Array<{ chat: string; excerpt: string; at: string }> = [];
          const names = opts.store.db.prepare("SELECT name FROM chats WHERE jid = ?");
          for (const row of rows) {
            const entry = byChat.get(row.chat_jid) ?? {
              jid: row.chat_jid,
              name: (names.get(row.chat_jid) as { name?: string } | undefined)?.name ?? null,
              messageCount: 0,
              lastActivity: row.timestamp,
            };
            entry.messageCount += 1;
            entry.lastActivity = row.timestamp;
            byChat.set(row.chat_jid, entry);
            if (row.media_type !== null) {
              mediaCount += 1;
            }
            if (
              row.is_from_me !== 1 &&
              typeof row.content === "string" &&
              row.content.includes("?")
            ) {
              questions.push({
                chat: row.chat_jid,
                excerpt: row.content.slice(0, 120),
                at: row.timestamp,
              });
            }
          }
          sendJson(res, 200, {
            activeChats: Array.from(byChat.values()),
            questions,
            mediaCount,
          });
          return;
        }
        if (path.startsWith("/api/groups/") && path.endsWith("/requests") && req.method === "GET") {
          const groupJid = decodeURIComponent(
            path.slice("/api/groups/".length, -"/requests".length),
          );
          const engine = handle.socket as unknown as {
            groupRequestParticipantsList?: (jid: string) => Promise<unknown>;
          };
          if (typeof engine.groupRequestParticipantsList !== "function") {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "engine lacks join-request API" },
            });
            return;
          }
          sendJson(res, 200, { requests: await engine.groupRequestParticipantsList(groupJid) });
          return;
        }
        if (
          path.startsWith("/api/groups/") &&
          path.endsWith("/requests") &&
          req.method === "POST"
        ) {
          const groupJid = decodeURIComponent(
            path.slice("/api/groups/".length, -"/requests".length),
          );
          const input = JSON.parse(body.toString("utf8")) as {
            participants?: unknown;
            action?: unknown;
          };
          const participants = Array.isArray(input.participants)
            ? (input.participants as unknown[]).filter((p): p is string => typeof p === "string")
            : [];
          const action = input.action === "reject" ? "reject" : "approve";
          const engine = handle.socket as unknown as {
            groupRequestParticipantsUpdate?: (
              jid: string,
              participants: string[],
              action: "approve" | "reject",
            ) => Promise<unknown>;
          };
          if (typeof engine.groupRequestParticipantsUpdate !== "function") {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "engine lacks join-request API" },
            });
            return;
          }
          sendJson(res, 200, {
            updated: await engine.groupRequestParticipantsUpdate(groupJid, participants, action),
          });
          return;
        }
        if (
          path.startsWith("/api/groups/") &&
          path.endsWith("/ephemeral") &&
          req.method === "POST"
        ) {
          const groupJid = decodeURIComponent(
            path.slice("/api/groups/".length, -"/ephemeral".length),
          );
          const input = JSON.parse(body.toString("utf8")) as { duration?: unknown };
          if (typeof input.duration !== "number" || !Number.isFinite(input.duration)) {
            validationError(res, "duration must be a number (seconds, 0 disables)");
            return;
          }
          const engine = handle.socket as unknown as {
            groupToggleEphemeral?: (jid: string, expiration: number) => Promise<void>;
          };
          if (typeof engine.groupToggleEphemeral !== "function") {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "engine lacks ephemeral API" },
            });
            return;
          }
          await engine.groupToggleEphemeral(groupJid, input.duration);
          sendJson(res, 200, { chat_jid: groupJid, ephemeral_duration: input.duration });
          return;
        }
        if (path === "/api/newsletters" && req.method === "GET") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          const rows = opts.store.db
            .prepare("SELECT jid, followed_at FROM newsletters ORDER BY followed_at")
            .all() as Array<{ jid: string; followed_at: string }>;
          sendJson(res, 200, { newsletters: rows });
          return;
        }
        if (path === "/api/newsletters/follow" && req.method === "POST") {
          const input = JSON.parse(body.toString("utf8")) as { jid?: unknown };
          const jid = typeof input.jid === "string" ? input.jid : "";
          if (jid.length === 0) {
            validationError(res, "jid is required");
            return;
          }
          const engine = handle.socket as unknown as {
            newsletterFollow?: (jid: string) => Promise<void>;
          };
          if (typeof engine.newsletterFollow !== "function") {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "engine lacks newsletter API" },
            });
            return;
          }
          await engine.newsletterFollow(jid);
          opts.store?.db
            .prepare("INSERT OR IGNORE INTO newsletters (jid, followed_at) VALUES (?, ?)")
            .run(jid, new Date().toISOString());
          sendJson(res, 200, { ok: true, jid });
          return;
        }
        if (path === "/api/newsletters/unfollow" && req.method === "POST") {
          const input = JSON.parse(body.toString("utf8")) as { jid?: unknown };
          const jid = typeof input.jid === "string" ? input.jid : "";
          if (jid.length === 0) {
            validationError(res, "jid is required");
            return;
          }
          const engine = handle.socket as unknown as {
            newsletterUnfollow?: (jid: string) => Promise<void>;
          };
          if (typeof engine.newsletterUnfollow !== "function") {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "engine lacks newsletter API" },
            });
            return;
          }
          await engine.newsletterUnfollow(jid);
          opts.store?.db.prepare("DELETE FROM newsletters WHERE jid = ?").run(jid);
          sendJson(res, 200, { ok: true, jid });
          return;
        }
        if (path === "/api/newsletters/send" && req.method === "POST") {
          const input = JSON.parse(body.toString("utf8")) as {
            jid?: unknown;
            text?: unknown;
          };
          if (typeof input.jid !== "string" || typeof input.text !== "string") {
            validationError(res, "jid and text are required");
            return;
          }
          const socket = handle.socket;
          if (socket === undefined || socket === null) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "bridge not connected" },
            });
            return;
          }
          // T94-C2(e): newsletter broadcasts burn the same budget
          const nlRefusal = sendPolicyRefusal(opts.store, opts.sendGuard, input.jid, Date.now());
          if (nlRefusal !== null) {
            sendJson(res, nlRefusal.status, nlRefusal.payload);
            return;
          }
          const result = await sendViaSocket(socket, input.jid, {
            text: input.text,
          } as AnyMessageContent);
          sendJson(res, 200, { message_id: result.messageId });
          return;
        }
        if (path === "/api/calls/reject" && req.method === "POST") {
          const input = JSON.parse(body.toString("utf8")) as {
            call_id?: unknown;
            call_from?: unknown;
          };
          if (typeof input.call_id !== "string" || typeof input.call_from !== "string") {
            validationError(res, "call_id and call_from are required");
            return;
          }
          const socket = handle.socket as unknown as {
            rejectCall?: (callId: string, callFrom: string) => Promise<void>;
          };
          if (typeof socket.rejectCall !== "function") {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "engine lacks rejectCall" },
            });
            return;
          }
          await socket.rejectCall(input.call_id, input.call_from);
          sendJson(res, 200, { ok: true });
          return;
        }
        if (path === "/api/mark-unread" && req.method === "POST") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          const input = JSON.parse(body.toString("utf8")) as {
            chat_jid?: unknown;
            clear?: unknown;
          };
          if (typeof input.chat_jid !== "string" || input.chat_jid.length === 0) {
            validationError(res, "chat_jid is required");
            return;
          }
          const value = input.clear === true ? 0 : 1;
          opts.store.db
            .prepare("UPDATE chats SET manual_unread = ? WHERE jid = ?")
            .run(value, input.chat_jid);
          sendJson(res, 200, { chat_jid: input.chat_jid, manual_unread: value });
          return;
        }
        if (path === "/api/logout" && req.method === "POST") {
          await handle.logout();
          sendJson(res, 200, { ok: true, status: handle.status });
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
        if (path === "/api/privacy" && req.method === "GET") {
          const socket = handle.socket;
          if (
            socket === undefined ||
            socket === null ||
            typeof socket.fetchPrivacySettings !== "function"
          ) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "bridge not connected" },
            });
            return;
          }
          void (socket.fetchPrivacySettings() as Promise<Record<string, string>>)
            .then((privacy) => {
              sendJson(res, 200, { privacy });
            })
            .catch((err: unknown) => {
              sendJson(res, 502, {
                error: {
                  code: "FETCH_FAILED",
                  message: err instanceof Error ? err.message : "privacy read failed",
                },
              });
            });
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
        if (path === "/api/subscriptions" && req.method === "GET") {
          if (opts.store === undefined || subscriptions === null) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "subscriptions not attached" },
            });
            return;
          }
          sendJson(res, 200, { subscriptions: listSubscriptions(opts.store) });
          return;
        }
        if (path === "/api/subscriptions" && req.method === "POST") {
          if (opts.store === undefined || subscriptions === null) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "subscriptions not attached" },
            });
            return;
          }
          let subInput: unknown;
          try {
            subInput = JSON.parse(body.toString("utf8")) as unknown;
          } catch {
            validationError(res, "body must be valid JSON");
            return;
          }
          const input = subInput as {
            chat_jid?: unknown;
            from_jid?: unknown;
            kinds?: unknown;
            include_media?: unknown;
            all_chats?: unknown;
          };
          if (input === null || typeof input !== "object") {
            validationError(res, "chat_jid or all_chats required");
            return;
          }
          if (input.chat_jid !== undefined && typeof input.chat_jid !== "string") {
            validationError(res, "chat_jid must be a string");
            return;
          }
          if (input.from_jid !== undefined && typeof input.from_jid !== "string") {
            validationError(res, "from_jid must be a string");
            return;
          }
          if (input.kinds !== undefined && !Array.isArray(input.kinds)) {
            validationError(res, "kinds must be an array");
            return;
          }
          if (input.include_media !== undefined && typeof input.include_media !== "boolean") {
            validationError(res, "include_media must be a boolean");
            return;
          }
          if (input.chat_jid === undefined && input.all_chats !== true) {
            validationError(res, "chat_jid or all_chats required");
            return;
          }
          const sub = createSubscription(opts.store as Store, opts.subscriptionsDir as string, {
            chatJid: typeof input.chat_jid === "string" ? input.chat_jid : null,
            fromJid: typeof input.from_jid === "string" ? input.from_jid : null,
            kinds: Array.isArray(input.kinds) ? (input.kinds as string[]) : ["message"],
            includeMedia: input.include_media === true,
            allChats: input.all_chats === true,
          });
          sendJson(res, 201, {
            id: sub.id,
            inboxPath: join(
              subscriptionDir(opts.subscriptionsDir as string, sub.id),
              "inbox.jsonl",
            ),
          });
          return;
        }
        const subDelete = path.match(/^\/api\/subscriptions\/([a-z0-9-]+)$/);
        if (subDelete !== null && req.method === "DELETE") {
          if (opts.store === undefined || subscriptions === null) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "subscriptions not attached" },
            });
            return;
          }
          if (deleteSubscription(opts.store as Store, subDelete[1] as string)) {
            res.writeHead(204);
            res.end();
            return;
          }
          sendJson(res, 404, { error: { code: "NOT_FOUND", message: "subscription not found" } });
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
        if (path === "/api/send-rules" && req.method === "GET") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          sendJson(res, 200, { rules: listSendRules(opts.store) });
          return;
        }
        if (path === "/api/send-rules" && req.method === "POST") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          // T93-E: the dispatch read at the top of this handler already
          // consumed the request stream — a second readBodyWithCap attached
          // after 'end' had fired and hung the client forever
          void (async () => {
            {
              const input = JSON.parse(body.toString("utf8")) as {
                target?: unknown;
                mode?: unknown;
                expires_at?: unknown;
              };
              if (typeof input.target !== "string" || input.target.length === 0) {
                sendJson(res, 400, {
                  error: { code: "VALIDATION_ERROR", message: "target is required" },
                });
                return;
              }
              if (input.mode !== "block" && input.mode !== "allow") {
                sendJson(res, 400, {
                  error: { code: "VALIDATION_ERROR", message: "mode must be block or allow" },
                });
                return;
              }
              const id = addSendRule(opts.store!, {
                target: input.target,
                mode: input.mode,
                expiresAt: typeof input.expires_at === "string" ? input.expires_at : undefined,
              });
              sendJson(res, 200, { id });
            }
          })().catch((err: unknown) => {
            opts.logger?.error({ err }, "send-rule add failed");
            sendJson(res, 500, { error: { code: "INTERNAL", message: "send-rule add failed" } });
          });
          return;
        }
        if (path.startsWith("/api/send-rules/") && req.method === "DELETE") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          removeSendRule(opts.store, Number(path.slice("/api/send-rules/".length)));
          sendJson(res, 200, { ok: true });
          return;
        }
        if (path === "/api/templates" && req.method === "GET") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          sendJson(res, 200, { templates: listTemplates(opts.store) });
          return;
        }
        if (path === "/api/templates" && req.method === "POST") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          // T93-E: consume the outer dispatch body — no second stream read
          void (async () => {
            {
              const input = JSON.parse(body.toString("utf8")) as { name?: unknown; body?: unknown };
              if (
                typeof input.name !== "string" ||
                input.name.length === 0 ||
                typeof input.body !== "string"
              ) {
                sendJson(res, 400, {
                  error: { code: "VALIDATION_ERROR", message: "name and body are required" },
                });
                return;
              }
              upsertTemplate(opts.store!, { name: input.name, body: input.body });
              sendJson(res, 200, { ok: true });
            }
          })().catch((err: unknown) => {
            opts.logger?.error({ err }, "template save failed");
            sendJson(res, 500, { error: { code: "INTERNAL", message: "template save failed" } });
          });
          return;
        }
        if (path.startsWith("/api/templates/") && req.method === "DELETE") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          deleteTemplate(opts.store, decodeURIComponent(path.slice("/api/templates/".length)));
          sendJson(res, 200, { ok: true });
          return;
        }
        if (path === "/api/scheduled" && req.method === "GET") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          const status = new URL(req.url ?? "/", "http://localhost").searchParams.get("status");
          sendJson(res, 200, {
            scheduled: listScheduled(opts.store, status ?? undefined),
          });
          return;
        }
        if (path === "/api/scheduled" && req.method === "POST") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          // T93-E: consume the outer dispatch body — no second stream read
          void (async () => {
            {
              const input = JSON.parse(body.toString("utf8")) as {
                chat_jid?: unknown;
                text?: unknown;
                send_at?: unknown;
              };
              if (
                typeof input.chat_jid !== "string" ||
                typeof input.text !== "string" ||
                typeof input.send_at !== "string"
              ) {
                sendJson(res, 400, {
                  error: {
                    code: "VALIDATION_ERROR",
                    message: "chat_jid, text and send_at are required",
                  },
                });
                return;
              }
              try {
                var scheduledId = scheduleMessage(opts.store!, {
                  chatJid: input.chat_jid,
                  payload: input.text,
                  sendAt: input.send_at,
                });
              } catch (err) {
                sendJson(res, 400, {
                  error: {
                    code: "VALIDATION_ERROR",
                    message: err instanceof Error ? err.message : "invalid send_at",
                  },
                });
                return;
              }
              const id = scheduledId;
              sendJson(res, 200, { id });
            }
          })().catch((err: unknown) => {
            opts.logger?.error({ err }, "schedule failed");
            sendJson(res, 500, { error: { code: "INTERNAL", message: "schedule failed" } });
          });
          return;
        }
        if (path.startsWith("/api/scheduled/") && req.method === "DELETE") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          const cancelled = cancelScheduled(
            opts.store,
            Number(path.slice("/api/scheduled/".length)),
          );
          sendJson(res, 200, { cancelled });
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
        if (path === "/api/labels" && req.method === "GET") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          const chatJid = new URL(req.url ?? "/", "http://localhost").searchParams.get("chat_jid");
          if (chatJid !== null && chatJid.length > 0) {
            sendJson(res, 200, { labels: chatLabels(opts.store, chatJid) });
            return;
          }
          sendJson(res, 200, { labels: listLabels(opts.store) });
          return;
        }
        if (path === "/api/labels" && req.method === "POST") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          const input = JSON.parse(body.toString("utf8")) as { name?: unknown; color?: unknown };
          if (typeof input.name !== "string" || input.name.length === 0) {
            validationError(res, "name is required");
            return;
          }
          const id = addLabel(opts.store, {
            name: input.name,
            color: typeof input.color === "string" ? input.color : "#000000",
          });
          sendJson(res, 200, { id });
          return;
        }
        if (path === "/api/labels" && req.method === "PUT") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          const input = JSON.parse(body.toString("utf8")) as {
            chat_jid?: unknown;
            label_id?: unknown;
          };
          if (
            typeof input.chat_jid !== "string" ||
            typeof input.label_id !== "number" ||
            !Number.isFinite(input.label_id)
          ) {
            validationError(res, "chat_jid and numeric label_id are required");
            return;
          }
          assignChatLabel(opts.store, input.chat_jid, input.label_id);
          sendJson(res, 200, { ok: true });
          return;
        }
        if (path.startsWith("/api/labels/") && req.method === "DELETE") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          const id = Number(path.slice("/api/labels/".length));
          if (!Number.isInteger(id) || id <= 0) {
            validationError(res, "label id must be a positive integer");
            return;
          }
          removeLabel(opts.store, id);
          sendJson(res, 200, { ok: true });
          return;
        }
        if (path === "/api/export" && req.method === "GET") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          const params = new URL(req.url ?? "/", "http://localhost").searchParams;
          const format = (params.get("format") ?? "jsonl") as "jsonl" | "md" | "txt";
          const chatJid = params.get("chat_jid") ?? undefined;
          const unreadOnly = params.get("unread") === "true";
          const text = exportMessages(opts.store, { chatJid, unreadOnly, format });
          const mime = format === "jsonl" ? "application/x-ndjson" : "text/plain; charset=utf-8";
          res.writeHead(200, { "content-type": mime });
          res.end(text);
          return;
        }
        if (path === "/api/read-bulk" && req.method === "POST") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          const input = JSON.parse(body.toString("utf8")) as { chat_jids?: unknown };
          const jids = Array.isArray(input.chat_jids)
            ? (input.chat_jids as unknown[]).filter((jid): jid is string => typeof jid === "string")
            : [];
          const clear = opts.store.db.prepare(
            "UPDATE messages SET is_unread = 0 WHERE chat_jid = ?",
          );
          for (const jid of jids) {
            clear.run(jid);
          }
          sendJson(res, 200, { cleared: jids.length });
          return;
        }
        if (path.startsWith("/api/contacts/") && req.method === "GET") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          const jid = decodeURIComponent(path.slice("/api/contacts/".length));
          const contact = getContact(opts.store, jid);
          if (contact === undefined) {
            sendJson(res, 404, { error: { code: "NOT_FOUND", message: "contact not found" } });
            return;
          }
          // T87-B: with_photo=true resolves the avatar via the engine
          const withPhoto =
            new URL(req.url ?? "/", "http://localhost").searchParams.get("with_photo") === "true";
          if (!withPhoto) {
            sendJson(res, 200, { contact });
            return;
          }
          const socket = handle.socket;
          let hasPhoto = false;
          let pictureUrl: string | undefined;
          if (socket !== undefined && socket !== null) {
            try {
              const engine = socket as unknown as {
                profilePictureUrl?: (jid: string, type?: string) => Promise<string>;
              };
              const fn = engine.profilePictureUrl;
              if (typeof fn !== "function") {
                throw new Error("engine lacks profilePictureUrl");
              }
              const url = await fn.call(socket, jid, "preview");
              if (typeof url === "string" && url.length > 0) {
                hasPhoto = true;
                pictureUrl = url;
              }
            } catch {
              // no photo — defaults stand
            }
          }
          sendJson(res, 200, {
            contact: {
              ...contact,
              hasPhoto,
              ...(pictureUrl !== undefined ? { pictureUrl } : {}),
            },
          });
          return;
        }
        if (path === "/api/picture-url" && req.method === "POST") {
          const input = JSON.parse(body.toString("utf8")) as { jid?: unknown };
          if (typeof input.jid !== "string" || input.jid.length === 0) {
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
          try {
            const url = await socket.profilePictureUrl(input.jid, "preview");
            if (typeof url !== "string" || url.length === 0) {
              sendJson(res, 404, { error: { code: "NOT_FOUND", message: "no profile picture" } });
              return;
            }
            sendJson(res, 200, { url });
          } catch {
            sendJson(res, 404, { error: { code: "NOT_FOUND", message: "no profile picture" } });
          }
          return;
        }
        if (path === "/api/poll-votes" && req.method === "GET") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          const params = new URL(req.url ?? "/", "http://localhost").searchParams;
          const messageId = params.get("message_id");
          const chatJid = params.get("chat_jid");
          if (messageId === null || chatJid === null) {
            validationError(res, "message_id and chat_jid are required");
            return;
          }
          const poll = pollVotesAggregate(opts.store, chatJid, messageId);
          if (poll === null) {
            sendJson(res, 404, { error: { code: "NOT_FOUND", message: "poll not found" } });
            return;
          }
          sendJson(res, 200, { poll });
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
        if (path === "/api/chat/modify" && req.method === "POST") {
          if (opts.store === undefined) {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "store not attached" },
            });
            return;
          }
          const input = JSON.parse(body.toString("utf8")) as {
            chat_jid?: unknown;
            action?: unknown;
            duration_seconds?: unknown;
          };
          if (typeof input.chat_jid !== "string" || input.chat_jid.length === 0) {
            validationError(res, "chat_jid is required");
            return;
          }
          const actions = [
            "archive",
            "unarchive",
            "mute",
            "unmute",
            "mark_unread",
            "mark_read",
            "clear",
            "delete",
          ];
          if (typeof input.action !== "string" || !actions.includes(input.action)) {
            validationError(res, `action must be one of ${actions.join(", ")}`);
            return;
          }
          const socket = handle.socket;
          if (socket === undefined || socket === null || typeof socket.chatModify !== "function") {
            sendJson(res, 501, {
              error: { code: "NOT_IMPLEMENTED", message: "bridge not connected" },
            });
            return;
          }
          const lastMessages = (
            opts.store.db
              .prepare(
                "SELECT id, chat_jid, sender_jid, is_from_me, timestamp FROM messages WHERE chat_jid = ? ORDER BY timestamp DESC LIMIT 25",
              )
              .all(input.chat_jid) as Array<{
              id: string;
              chat_jid: string;
              sender_jid: string | null;
              is_from_me: number;
              timestamp: string;
            }>
          ).map((row) => ({
            key: {
              remoteJid: row.chat_jid,
              id: row.id,
              fromMe: row.is_from_me === 1,
              participant: row.is_from_me === 1 ? undefined : (row.sender_jid ?? undefined),
            },
            messageTimestamp: Math.floor(new Date(row.timestamp).getTime() / 1000),
          }));
          const durationSeconds =
            typeof input.duration_seconds === "number" ? input.duration_seconds : 604800;
          const modifications: Record<string, Record<string, unknown>> = {
            archive: { archive: true, lastMessages },
            unarchive: { archive: false, lastMessages },
            mute: { mute: Date.now() + durationSeconds * 1000 },
            unmute: { mute: null },
            mark_unread: { markRead: false, lastMessages },
            mark_read: { markRead: true, lastMessages },
            clear: { clear: true, lastMessages },
            delete: { delete: true, lastMessages },
          };
          void socket
            .chatModify(modifications[input.action] as never, input.chat_jid)
            .then(() => {
              sendJson(res, 200, { applied: input.action });
            })
            .catch((err: unknown) => {
              sendJson(res, 502, {
                error: {
                  code: "GROUP_CHAT_MODIFY_FAILED",
                  message: err instanceof Error ? err.message : "chatModify failed",
                  hint: "1:1 chats archive/mute fine; groups need sender-attributed lastMessages",
                },
              });
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
        if (path === "/api/config" && req.method === "GET") {
          const config = readBridgeConfig(opts.dataDir);
          const section = config.transcription ?? {};
          const maskedKey =
            section.api_key !== undefined && section.api_key.length > 0
              ? `${section.api_key.slice(0, 3)}…${section.api_key.slice(-4)}`
              : undefined;
          sendJson(res, 200, {
            transcription: {
              engine: section.engine ?? "mock",
              base_url: section.base_url,
              model: section.model,
              api_key: maskedKey,
              api_key_set: maskedKey !== undefined,
            },
          });
          return;
        }
        if (path === "/api/config" && req.method === "PUT") {
          let parsed: unknown;
          try {
            parsed = JSON.parse(body.toString("utf8")) as unknown;
          } catch {
            validationError(res, "body must be valid JSON");
            return;
          }
          const section = (parsed as { transcription?: Record<string, unknown> }).transcription;
          if (section === undefined || typeof section !== "object") {
            validationError(res, "transcription section is required");
            return;
          }
          const pick = (key: string): string | undefined => {
            const value = section[key];
            return typeof value === "string" ? value : undefined;
          };
          try {
            writeTranscriptionSection(opts.dataDir, {
              engine: pick("engine"),
              api_key: pick("api_key") ?? "",
              base_url: pick("base_url"),
              model: pick("model"),
            });
          } catch (err) {
            sendJson(res, 500, {
              error: {
                code: "INTERNAL",
                message: err instanceof Error ? err.message : "config write failed",
              },
            });
            return;
          }
          sendJson(res, 200, { saved: true });
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
          // ADR 0012 (+ T94-G addendum): the OWNER RULE — the web UI must
          // bootstrap with zero user action, including on a PAIRED daemon.
          // Trust boundary = loopback + same-user (the 0600 token file in the
          // data dir already grants same-user processes full access). The
          // exchange accepts the pairing token (retained in the browser's
          // localStorage from the pairing session) or the STABLE bootstrap
          // token from /health. WA_UI_BOOTSTRAP=0 restores the strict CR1
          // posture for owners who want the pairing-window-only exchange.
          if (handle.hasPairedAccount() && process.env.WA_UI_BOOTSTRAP === "0") {
            sendJson(res, 403, {
              error: {
                code: "PAIRED",
                message:
                  "UI bootstrap disabled (WA_UI_BOOTSTRAP=0) — configure the account token in the web UI settings",
              },
            });
            return;
          }
          sendJson(res, 200, { token: uiToken });
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
