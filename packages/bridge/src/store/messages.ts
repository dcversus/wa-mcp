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

/** T94-D-M1: exported for the store contract test — one reaction per sender. */
export function applyReaction(
  store: Store,
  chatJid: string,
  targetId: string,
  emote: string,
  author: string,
): void {
  const targetRow = store.db
    .prepare("SELECT id FROM messages WHERE chat_jid = ? AND id = ?")
    .get(chatJid, targetId);
  if (targetRow === undefined) {
    return;
  }
  // T78 M2: one row per (message, emoji, sender); an empty emote removes
  // exactly that sender's reaction for the message
  if (emote.length === 0) {
    store.db
      .prepare("DELETE FROM reactions WHERE chat_jid = ? AND message_id = ? AND sender_jid = ?")
      .run(chatJid, targetId, author);
    return;
  }
  // T94-D-M1: WhatsApp allows ONE reaction per sender per message — the old
  // emoji row must go or counts inflate when the sender changes their mind
  store.db
    .prepare("DELETE FROM reactions WHERE chat_jid = ? AND message_id = ? AND sender_jid = ?")
    .run(chatJid, targetId, author);
  store.db
    .prepare(
      "INSERT INTO reactions (chat_jid, message_id, emoji, sender_jid, created_at) VALUES (?, ?, ?, ?, ?)",
    )
    .run(chatJid, targetId, emote, author, new Date().toISOString());
}

/** T78 M1: protocol messages act ON another row — allow only when the actor
 * is the account itself (fromMe) or the original row's own sender. */
function protocolActorAllowed(
  store: Store,
  chatJid: string,
  targetId: string,
  message: WAMessage,
): boolean {
  if (message.key.fromMe === true) {
    return true;
  }
  const actor = message.key.participant ?? chatJid;
  const original = store.db
    .prepare("SELECT sender_jid FROM messages WHERE chat_jid = ? AND id = ?")
    .get(chatJid, targetId) as { sender_jid?: string | null } | undefined;
  return original !== undefined && original.sender_jid === actor;
}

export function storeMessage(store: Store, message: WAMessage): boolean {
  const chatJid = message.key.remoteJid ?? "";
  const messageId = message.key.id ?? "";
  if (chatJid.length === 0 || messageId.length === 0) {
    return false;
  }
  const extracted = extractContent(message);
  if (extracted.revokedMessageId !== null) {
    // T78 M1: only the original sender (or the account itself) may revoke —
    // a spoofed protocol message must not tombstone someone else's row
    if (!protocolActorAllowed(store, chatJid, extracted.revokedMessageId, message)) {
      return false;
    }
    updateTargetContent(store, chatJid, extracted.revokedMessageId, "[revoked]");
    store.db
      .prepare(
        "UPDATE messages SET deleted = 1, media_type = NULL, media_path = NULL WHERE chat_jid = ? AND id = ?",
      )
      .run(chatJid, extracted.revokedMessageId);
    return false;
  }
  if (extracted.editedMessageId !== null) {
    if (!protocolActorAllowed(store, chatJid, extracted.editedMessageId, message)) {
      return false;
    }
    updateTargetContent(store, chatJid, extracted.editedMessageId, extracted.editedText);
    store.db
      .prepare("UPDATE messages SET edited = 1 WHERE chat_jid = ? AND id = ?")
      .run(chatJid, extracted.editedMessageId);
    return false;
  }
  if (extracted.reaction !== null && extracted.reactionTargetId !== null) {
    // T94-D-M1: own reactions key as "me" in DMs AND groups (one identity)
    const reactionAuthor =
      message.key.fromMe === true ? "me" : (message.key.participant ?? chatJid);
    applyReaction(store, chatJid, extracted.reactionTargetId, extracted.reaction, reactionAuthor);
    return false;
  }
  if (extracted.pollVote !== null) {
    // decoded poll votes persist via the poll_votes path (T60 lifecycle
    // messages.update consumer); the raw upsert carries no storable content
    return false;
  }
  // T80 line45: disappearing-message settings are per-chat state
  if (extracted.isEphemeral && extracted.ephemeralDuration !== undefined) {
    const duration = extracted.ephemeralDuration;
    if (typeof duration === "number" && Number.isFinite(duration) && duration > 0) {
      store.db
        .prepare(
          "INSERT INTO chats (jid, name, ephemeral_duration, ephemeral_setting_ts) VALUES (?, NULL, ?, ?)\n            ON CONFLICT(jid) DO UPDATE SET ephemeral_duration = excluded.ephemeral_duration,\n              ephemeral_setting_ts = excluded.ephemeral_setting_ts",
        )
        .run(chatJid, duration, new Date().toISOString());
    }
  }

  if (
    extracted.text === null &&
    extracted.mediaType === null &&
    extracted.poll === null &&
    extracted.editedMessageId === null &&
    extracted.revokedMessageId === null
  ) {
    // protocol echo with no user content — storing it would create an
    // empty chat row (live evidence: two empty rows from LID echoes)
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
