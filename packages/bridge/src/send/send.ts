import { proto } from "@whiskeysockets/baileys";
import type { AnyMessageContent, WASocket, WAMessage } from "@whiskeysockets/baileys";
import { normalizeJid } from "@wa-mcp/shared";
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
}

export interface SendResult {
  messageId: string;
  chatJid: string;
}

export async function sendViaSocket(
  socket: WASocket,
  chatJid: string,
  content: proto.IMessage | AnyMessageContent,
  opts: SendOptions = {},
): Promise<SendResult> {
  if (process.env.WA_SENDS_DISABLED === "1") {
    throw new SendError("SENDS_DISABLED", "sending is disabled by WA_SENDS_DISABLED");
  }
  const jid = normalizeJid(chatJid);
  if (jid === null) {
    throw new SendError("INVALID_JID", `cannot resolve recipient: ${chatJid}`);
  }
  const sent = await socket.sendMessage(jid, content as AnyMessageContent);
  const messageId = sent?.key?.id ?? "";
  if (sent !== undefined && opts.store !== undefined) {
    const outbound = {
      ...sent,
      key: { ...sent.key, remoteJid: jid, fromMe: true },
    } as WAMessage;
    storeMessage(opts.store, outbound);
  }
  return { messageId, chatJid: jid };
}
