import { proto } from "baileys";
import type { WAMessage } from "baileys";
import { extractContent } from "../ingest/extract.ts";
import type { Store } from "./schema.ts";

const INSERT_MESSAGE = `
INSERT OR IGNORE INTO messages (
  id, chat_jid, sender_jid, sender_name, timestamp, content, media_type,
  media_path, quoted_message_id, mentions, is_from_me, is_unread, reactions, raw
) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
`;

const UPSERT_CHAT = `
INSERT INTO chats (jid, name, last_message_text, last_message_ts)
VALUES (?, ?, ?, ?)
ON CONFLICT(jid) DO UPDATE SET
  last_message_text = excluded.last_message_text,
  last_message_ts = excluded.last_message_ts,
  name = COALESCE(chats.name, excluded.name)
WHERE excluded.last_message_ts > chats.last_message_ts
`;

function toIsoTimestamp(raw: number | { toNumber(): number } | null | undefined): string {
  if (raw === null || raw === undefined) {
    return new Date(0).toISOString();
  }
  const value = typeof raw === "number" ? raw : raw.toNumber();
  // engine carries SECONDS; some producers pass MILLISECONDS — normalize at
  // this ONE boundary so both units land on the same instant (T58a)
  const ms = value >= 1e12 ? value : value * 1000;
  return new Date(ms).toISOString();
}

function senderJidOf(key: proto.IMessageKey): string {
  return key.participant ?? key.remoteJid ?? "";
}

function digitsOf(jid: string): string {
  return jid.split("@")[0]?.replace(/:\d+$/, "") ?? "";
}

function senderNameOf(message: WAMessage, senderJid: string | null): string | null {
  if (message.pushName !== undefined && message.pushName !== null && message.pushName.length > 0) {
    return message.pushName;
  }
  if (
    message.verifiedBizName !== undefined &&
    message.verifiedBizName !== null &&
    message.verifiedBizName.length > 0
  ) {
    return message.verifiedBizName;
  }
  if (senderJid === null) {
    return null;
  }
  const digits = digitsOf(senderJid);
  return digits.length > 0 ? digits : null;
}

function updateTargetContent(
  store: Store,
  chatJid: string,
  targetId: string,
  content: string | null,
): void {
  store.db
    .prepare("UPDATE messages SET content = ? WHERE chat_jid = ? AND id = ?")
    .run(content, chatJid, targetId);
}

function appendReaction(store: Store, chatJid: string, targetId: string, emote: string): void {
  const targetRow = store.db
    .prepare("SELECT reactions FROM messages WHERE chat_jid = ? AND id = ?")
    .get(chatJid, targetId) as { reactions: string | null } | undefined;
  if (targetRow === undefined) {
    return;
  }
  let reactions: Array<{ emote: string }> = [];
  if (targetRow.reactions !== null) {
    try {
      reactions = JSON.parse(targetRow.reactions) as Array<{ emote: string }>;
    } catch {
      reactions = [];
    }
  }
  reactions.push({ emote });
  store.db
    .prepare("UPDATE messages SET reactions = ? WHERE chat_jid = ? AND id = ?")
    .run(JSON.stringify(reactions), chatJid, targetId);
}

export function storeMessage(store: Store, message: WAMessage): boolean {
  const chatJid = message.key.remoteJid ?? "";
  const messageId = message.key.id ?? "";
  if (chatJid.length === 0 || messageId.length === 0) {
    return false;
  }
  const extracted = extractContent(message);
  if (extracted.revokedMessageId !== null) {
    updateTargetContent(store, chatJid, extracted.revokedMessageId, "[revoked]");
    store.db
      .prepare(
        "UPDATE messages SET media_type = NULL, media_path = NULL WHERE chat_jid = ? AND id = ?",
      )
      .run(chatJid, extracted.revokedMessageId);
    return false;
  }
  if (extracted.editedMessageId !== null) {
    updateTargetContent(store, chatJid, extracted.editedMessageId, extracted.editedText);
    return false;
  }
  if (extracted.reaction !== null && extracted.reactionTargetId !== null) {
    appendReaction(store, chatJid, extracted.reactionTargetId, extracted.reaction);
    return false;
  }
  const timestamp = toIsoTimestamp(message.messageTimestamp);
  const isFromMe = message.key.fromMe === true;
  const senderJid: string | null = isFromMe
    ? (message.key.participant ?? null)
    : senderJidOf(message.key);
  const info = store.db
    .prepare(INSERT_MESSAGE)
    .run(
      messageId,
      chatJid,
      senderJid,
      senderNameOf(message, senderJid),
      timestamp,
      extracted.text,
      extracted.mediaType,
      null,
      extracted.quotedMessageId,
      JSON.stringify(extracted.mentions),
      isFromMe ? 1 : 0,
      isFromMe ? 0 : 1,
      null,
      message.message === undefined || message.message === null
        ? null
        : JSON.stringify(message.message),
    );
  if (info.changes === 0) {
    return false;
  }
  store.db
    .prepare(UPSERT_CHAT)
    .run(chatJid, senderNameOf(message, senderJid), extracted.text, timestamp);
  if (extracted.poll !== null) {
    const insertOption = store.db.prepare(
      "INSERT OR IGNORE INTO poll_options (chat_jid, message_id, idx, label) VALUES (?, ?, ?, ?)",
    );
    extracted.poll.options.forEach((label, index) => {
      insertOption.run(chatJid, messageId, index, label);
    });
  }
  return true;
}

/** History-sync chat metadata (name only; message-driven fields win). */
export function upsertChatMeta(store: Store, chat: { id: string; name?: string }): void {
  store.db
    .prepare(
      `INSERT INTO chats (jid, name) VALUES (?, ?)
       ON CONFLICT(jid) DO UPDATE SET name = COALESCE(NULLIF(excluded.name, ''), chats.name)`,
    )
    .run(chat.id, chat.name ?? null);
}
