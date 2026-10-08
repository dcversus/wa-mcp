import { generateWAMessageFromContent, jidDecode, jidEncode, proto } from "baileys";
import type { AnyMessageContent, WASocket, WAMessage } from "baileys";
import { isValidRecipientJid, normalizeJid } from "@wa-mcp/shared";
import { getAlias } from "../store/contacts.ts";
import { storeMessage } from "../store/messages.ts";
import type { Store } from "../store/schema.ts";
import { HumanizeAborted, type Humanizer } from "./humanize.ts";

export class SendError extends Error {
  readonly code: string;

  readonly retryAfterSeconds?: number;
  readonly hint?: string;

  constructor(code: string, message: string, retryAfterSeconds?: number, hint?: string) {
    super(message);
    this.code = code;
    this.retryAfterSeconds = retryAfterSeconds;
    this.hint = hint;
  }
}

export interface SendOptions {
  store?: Store;
  /** quoted message for replies — passed to the engine's quoted contextInfo */
  quoted?: WAMessage;
  humanizer?: Humanizer;
}

export interface SendResult {
  messageId: string;
  chatJid: string;
}

/** Canonical STORE chat jid for an incoming/outgoing jid: when the jid is a
 * LID and the engine's mapping resolves a phone number, use the PN jid so one
 * person = one chat row (T58b). Everything else passes through. */
export async function canonicalChatJid(socket: WASocket, jid: string): Promise<string> {
  const decode = jidDecode(jid);
  const user = decode?.user;
  if (decode === undefined || user === undefined || decode.server !== "lid") {
    return jid;
  }
  const repo = (
    socket as unknown as {
      signalRepository?: {
        lidMapping?: { getPNForLID?(lid: string): Promise<string | null> };
      };
    }
  ).signalRepository;
  const getPn = repo?.lidMapping?.getPNForLID?.bind(repo.lidMapping);
  if (typeof getPn !== "function" || repo === undefined || repo.lidMapping === undefined) {
    return jid;
  }
  // the engine's lidMapping skips any lid failing isLidUser — pass the FULL jid
  const pnJid = await getPn(jid);
  if (typeof pnJid !== "string" || pnJid.length === 0) {
    return jid;
  }
  // the engine may return a device-suffixed PN jid ('351930017568:0@s.whatsapp.net')
  // — keep the phone number, drop the leaked device suffix (chat rows stay clean)
  const pnDecode = jidDecode(pnJid);
  const pnUser = pnDecode?.user ?? user;
  return jidEncode(pnUser, "s.whatsapp.net");
}

/** LID-era accounts keep signal sessions under @lid JIDs. The engine sends
 * to the JID AS-GIVEN (fork messages-send.js: finalJid = jid), so a phone JID
 * must be rewritten to its mapped LID before the wire — the mapping lives in
 * signalRepository.lidMapping (backed by the auth dir's lid-mapping-*.json).
 * LIDs, groups and unmapped PNs pass through unchanged. */
export async function resolveLidJid(socket: WASocket, jid: string): Promise<string> {
  const decode = jidDecode(jid);
  const user = decode?.user;
  if (decode === undefined || user === undefined || decode.server !== "s.whatsapp.net") {
    return jid;
  }
  const repo = (
    socket as unknown as {
      signalRepository?: {
        lidMapping?: { getLIDForPN?(pn: string): Promise<string | null> };
      };
    }
  ).signalRepository;
  const getLid = repo?.lidMapping?.getLIDForPN?.bind(repo.lidMapping);
  if (typeof getLid !== "function" || repo === undefined || repo.lidMapping === undefined) {
    return jid;
  }
  // isPnUser requires the FULL jid — a bare user is silently dropped
  const lidJid = await getLid(jid);
  if (typeof lidJid !== "string" || lidJid.length === 0) {
    return jid;
  }
  // the engine returns a FULL LID jid ('221900000001937@lid') — it is
  // authoritative, use it verbatim
  const lidDecode = jidDecode(lidJid);
  if (lidDecode === undefined || lidDecode.server !== "lid") {
    return jid;
  }
  return lidJid;
}

export type RecipientResolution =
  | { ok: true; jid: string }
  | { ok: false; code: "INVALID_JID"; message: string };

/** GOAL: 'all recipient-taking tools resolve aliases; exact-only sends,
 * fuzzy → suggest-not-send'. A valid JID passes through; an exact alias
 * resolves to its mapped jid; anything else fails with INVALID_JID plus the
 * closest real alias as a suggestion (nothing is sent). */
export function resolveRecipient(store: Store, chatJid: string): RecipientResolution {
  const canonical = normalizeJid(chatJid);
  if (canonical !== null && isValidRecipientJid(canonical)) {
    return { ok: true, jid: canonical };
  }
  const alias = getAlias(store, chatJid);
  if (alias !== null) {
    return { ok: true, jid: alias.jid };
  }
  let closest = "";
  try {
    const rows = store.db.prepare("SELECT alias FROM aliases").all() as Array<{
      alias: string;
    }>;
    const needle = chatJid.toLowerCase();
    closest =
      rows.map((row) => row.alias).find((alias) => alias.toLowerCase().startsWith(needle)) ?? "";
  } catch {
    closest = "";
  }
  const hint = closest.length > 0 ? ` — did you mean '${closest}'?` : "";
  return {
    ok: false,
    code: "INVALID_JID",
    message: `cannot resolve recipient: ${chatJid}${hint}`,
  };
}

/** T84 line101: engine rate-limit/ban surfaces map to ONE structured code —
 * WA_RATE_LIMITED with retryAfterSeconds when the engine says so — so every
 * caller (http, MCP, scheduler) reports the same actionable shape. */
export function mapWaError(err: unknown): {
  code: string;
  message: string;
  retryAfterSeconds?: number;
  hint?: string;
} {
  const message = err instanceof Error ? err.message : String(err);
  const retryMatch = /retry after (\d+)s/i.exec(message);
  const banned = /temporarily banned|banned/i.test(message);
  const rateLimited =
    banned || /\b429\b/.test(message) || /rate.?overlimit|rate.?limit/i.test(message);
  if (rateLimited) {
    return {
      code: "WA_RATE_LIMITED",
      message,
      retryAfterSeconds: retryMatch !== null ? Number(retryMatch[1]) : banned ? 3600 : undefined,
      hint: banned
        ? "the account is temporarily banned — wait before sending again"
        : "WhatsApp is rate-limiting this account — slow down or wait for the retry window",
    };
  }
  return { code: "SEND_FAILED", message };
}

async function humanise(
  humanizer: Humanizer,
  socket: WASocket,
  jid: string,
  content: AnyMessageContent | proto.IMessage,
): Promise<void> {
  try {
    await humanizer.beforeSend(socket, jid, content);
  } catch (err: unknown) {
    if (err instanceof HumanizeAborted) {
      throw new SendError("SHUTTING_DOWN", err.message);
    }
    throw err;
  }
}

export async function sendViaSocket(
  socket: WASocket,
  chatJid: string,
  content: AnyMessageContent,
  opts: SendOptions = {},
): Promise<SendResult> {
  if (process.env.WA_SENDS_DISABLED === "1") {
    throw new SendError("SENDS_DISABLED", "sending is disabled by WA_SENDS_DISABLED");
  }
  if (!isValidRecipientJid(chatJid)) {
    throw new SendError("INVALID_JID", `cannot resolve recipient: ${chatJid}`);
  }
  const jid = normalizeJid(chatJid);
  if (jid === null) {
    throw new SendError("INVALID_JID", `cannot resolve recipient: ${chatJid}`);
  }
  const wireJid = await resolveLidJid(socket, jid);
  if (opts.humanizer?.active() === true) {
    await humanise(opts.humanizer, socket, wireJid, content);
  }
  let sent: proto.IWebMessageInfo | undefined;
  try {
    sent = await socket.sendMessage(
      wireJid,
      content as AnyMessageContent,
      opts.quoted !== undefined ? { quoted: opts.quoted } : undefined,
    );
  } catch (err: unknown) {
    if (err instanceof SendError) {
      throw err;
    }
    const mapped = mapWaError(err);
    throw new SendError(mapped.code, mapped.message, mapped.retryAfterSeconds, mapped.hint);
  }
  // production sockets return the engine-GENERATED proto in sent.message;
  // if a socket omits it, synthesize the text proto so persistence keeps the
  // sent text (the "socket return omits it" contract)
  const messageId = sent?.key?.id ?? "";
  if (sent !== undefined && opts.store !== undefined) {
    const echoed = (sent as { message?: proto.IMessage }).message;
    const text = (content as { text?: string }).text;
    const message =
      echoed ??
      (typeof text === "string"
        ? ({ extendedTextMessage: { text } } as proto.IMessage)
        : (content as proto.IMessage));
    const outbound = {
      ...sent,
      key: { ...sent.key, remoteJid: jid, fromMe: true },
      message,
    } as WAMessage;
    storeMessage(opts.store, outbound);
  }
  return { messageId, chatJid: jid };
}

// T92 engine truth: socket.sendMessage rejects raw protos — generateWAMessageContent
// falls through to prepareWAMessageMedia which throws "Invalid media type" for any
// content without an AnyMessageContent key (buttonsMessage/listMessage included).
// Interactive protos ride generateWAMessageFromContent + relayMessage instead —
// the fork's relay path maps listMessage/buttonsResponseMessage natively.
export async function sendProtoViaSocket(
  socket: WASocket,
  chatJid: string,
  message: proto.IMessage,
  opts: SendOptions = {},
): Promise<SendResult> {
  if (process.env.WA_SENDS_DISABLED === "1") {
    throw new SendError("SENDS_DISABLED", "sending is disabled by WA_SENDS_DISABLED");
  }
  if (!isValidRecipientJid(chatJid)) {
    throw new SendError("INVALID_JID", `cannot resolve recipient: ${chatJid}`);
  }
  const jid = normalizeJid(chatJid);
  if (jid === null) {
    throw new SendError("INVALID_JID", `cannot resolve recipient: ${chatJid}`);
  }
  const wireJid = await resolveLidJid(socket, jid);
  if (opts.humanizer?.active() === true) {
    await humanise(opts.humanizer, socket, wireJid, message);
  }
  try {
    const full = generateWAMessageFromContent(wireJid, proto.Message.fromObject(message), {
      userJid: socket.user?.id ?? "",
      quoted: opts.quoted,
    });
    const messageId = full.key.id ?? "";
    await socket.relayMessage(wireJid, full.message ?? {}, { messageId });
    if (opts.store !== undefined) {
      const outbound = {
        ...full,
        key: { ...full.key, remoteJid: jid, fromMe: true },
      } as WAMessage;
      storeMessage(opts.store, outbound);
    }
    return { messageId, chatJid: jid };
  } catch (err: unknown) {
    if (err instanceof SendError) {
      throw err;
    }
    const mapped = mapWaError(err);
    throw new SendError(mapped.code, mapped.message, mapped.retryAfterSeconds, mapped.hint);
  }
}
