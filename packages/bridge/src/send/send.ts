import { jidDecode, jidEncode, proto } from "baileys";
import type { AnyMessageContent, WASocket, WAMessage } from "baileys";
import { isValidRecipientJid, normalizeJid } from "@wa-mcp/shared";
import { storeMessage } from "../store/messages.ts";
import type { Store } from "../store/schema.ts";

export class SendError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export interface SendOptions {
  store?: Store;
  /** quoted message for replies — passed to the engine's quoted contextInfo */
  quoted?: WAMessage;
}

export interface SendResult {
  messageId: string;
  chatJid: string;
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
  const getLid = repo?.lidMapping?.getLIDForPN;
  if (typeof getLid !== "function" || repo === undefined || repo.lidMapping === undefined) {
    return jid;
  }
  const lid = await getLid.call(repo.lidMapping, user);
  if (typeof lid !== "string" || lid.length === 0) {
    return jid;
  }
  return jidEncode(lid, "lid", decode.device);
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
  const sent = await socket.sendMessage(
    wireJid,
    content as AnyMessageContent,
    opts.quoted !== undefined ? { quoted: opts.quoted } : undefined,
  );
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
