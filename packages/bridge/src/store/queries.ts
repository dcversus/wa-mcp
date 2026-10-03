import { proto } from "baileys";
import type { WAMessage } from "baileys";
import type { Store } from "./schema.ts";

const MAX_LIMIT = 200;
const DEFAULT_LIMIT = 50;
const FTS_OPERATORS = new Set(["AND", "OR", "NOT", "NEAR"]);

export interface ChatSummary {
  jid: string;
  name: string | null;
  archived: boolean;
  unreadCount: number;
  lastMessage: {
    id: string;
    text: string | null;
    timestamp: string;
    senderName: string | null;
  } | null;
}

export interface MessageRow {
  id: string;
  chatJid: string;
  senderJid: string | null;
  senderName: string | null;
  timestamp: string;
  content: string | null;
  mediaType: string | null;
  mediaPath: string | null;
  quotedMessageId: string | null;
  mentions: string[];
  isFromMe: boolean;
  isUnread: boolean;
  reactions: Array<{ emote: string }> | null;
}

export interface Pagination {
  limit?: number;
  offset?: number;
}

function clamp(limit?: number, offset?: number): { limit: number; offset: number } {
  const rawLimit =
    typeof limit === "number" && Number.isFinite(limit) ? Math.trunc(limit) : DEFAULT_LIMIT;
  const rawOffset = typeof offset === "number" && Number.isFinite(offset) ? Math.trunc(offset) : 0;
  return { limit: Math.min(Math.max(rawLimit, 1), MAX_LIMIT), offset: Math.max(rawOffset, 0) };
}

function displayName(jid: string, name: string | null): string | null {
  if (name !== null && name.length > 0) {
    return name;
  }
  if (jid.endsWith("@g.us")) {
    return jid;
  }
  const digits = jid.split("@")[0]?.replace(/:\d+$/, "") ?? "";
  return digits.length > 0 ? digits : jid;
}

type RawRow = Record<string, unknown>;

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function parseJsonArray(value: unknown): string[] {
  if (typeof value !== "string") {
    return [];
  }
  try {
    const parsed: unknown = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((item): item is string => typeof item === "string")
      : [];
  } catch {
    return [];
  }
}

function parseReactions(value: unknown): Array<{ emote: string }> | null {
  if (typeof value !== "string") {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(value);
    if (!Array.isArray(parsed)) {
      return null;
    }
    return parsed
      .map((item) =>
        item !== null && typeof item === "object" ? (item as { emote?: unknown }).emote : null,
      )
      .filter((emote): emote is string => typeof emote === "string")
      .map((emote) => ({ emote }));
  } catch {
    return null;
  }
}

function rowToMessage(row: RawRow): MessageRow {
  return {
    id: asString(row.id) ?? "",
    chatJid: asString(row.chat_jid) ?? "",
    senderJid: asString(row.sender_jid),
    senderName: asString(row.sender_name),
    timestamp: asString(row.timestamp) ?? "",
    content: asString(row.content),
    mediaType: asString(row.media_type),
    mediaPath: asString(row.media_path),
    quotedMessageId: asString(row.quoted_message_id),
    mentions: parseJsonArray(row.mentions),
    isFromMe: row.is_from_me === 1,
    isUnread: row.is_unread === 1,
    reactions: parseReactions(row.reactions),
  };
}

export function listChats(
  store: Store,
  opts: Pagination & { includeLastMessage?: boolean; archived?: boolean } = {},
): ChatSummary[] {
  const { limit, offset } = clamp(opts.limit, opts.offset);
  const archived = opts.archived === true ? 1 : 0;
  const rows = store.db
    .prepare(
      `
      SELECT c.jid AS jid, c.name AS name, c.archived AS archived,
        (SELECT COUNT(*) FROM messages m WHERE m.chat_jid = c.jid AND m.is_unread = 1) AS unread_count,
        lm.id AS last_id, lm.content AS last_content, lm.timestamp AS last_ts, lm.sender_name AS last_sender
      FROM chats c
      LEFT JOIN messages lm ON lm.chat_jid = c.jid AND lm.rowid = (
        SELECT rowid FROM messages WHERE chat_jid = c.jid ORDER BY timestamp DESC, rowid DESC LIMIT 1
      )
      WHERE c.archived = ?
      ORDER BY lm.timestamp DESC, c.jid ASC
      LIMIT ? OFFSET ?
      `,
    )
    .all(archived, limit, offset) as RawRow[];
  return rows.map((row) => ({
    jid: asString(row.jid) ?? "",
    name: displayName(asString(row.jid) ?? "", asString(row.name)),
    archived: row.archived === 1,
    unreadCount: typeof row.unread_count === "number" ? row.unread_count : 0,
    lastMessage:
      opts.includeLastMessage === false || row.last_id === null || row.last_id === undefined
        ? null
        : {
            id: asString(row.last_id) ?? "",
            text: asString(row.last_content),
            timestamp: asString(row.last_ts) ?? "",
            senderName: asString(row.last_sender),
          },
  }));
}

export interface ListMessagesFilter extends Pagination {
  chatJid?: string;
  sender?: string;
  after?: Date;
  before?: Date;
}

export function listMessages(store: Store, opts: ListMessagesFilter): MessageRow[] {
  const { limit, offset } = clamp(opts.limit, opts.offset);
  const clauses: string[] = [];
  const params: Array<string | number> = [];
  if (opts.chatJid !== undefined) {
    clauses.push("chat_jid = ?");
    params.push(opts.chatJid);
  }
  if (opts.sender !== undefined) {
    clauses.push("sender_jid = ?");
    params.push(opts.sender);
  }
  if (opts.after !== undefined) {
    clauses.push("timestamp > ?");
    params.push(opts.after.toISOString());
  }
  if (opts.before !== undefined) {
    clauses.push("timestamp < ?");
    params.push(opts.before.toISOString());
  }
  const where = clauses.length > 0 ? `WHERE ${clauses.join(" AND ")}` : "";
  const rows = store.db
    .prepare(`SELECT * FROM messages ${where} ORDER BY timestamp DESC, rowid DESC LIMIT ? OFFSET ?`)
    .all(...params, limit, offset) as RawRow[];
  return rows.map(rowToMessage);
}

export interface MessageContext {
  target: MessageRow;
  before: MessageRow[];
  after: MessageRow[];
}

export function getMessageContext(
  store: Store,
  messageId: string,
  radius = 3,
  chatJid?: string,
): MessageContext | null {
  const safeRadius = Math.min(Math.max(Math.trunc(radius), 0), 100);
  const targetRow = (
    chatJid !== undefined
      ? store.db
          .prepare(
            "SELECT rowid, * FROM messages WHERE id = ? AND chat_jid = ? ORDER BY timestamp DESC",
          )
          .get(messageId, chatJid)
      : store.db
          .prepare("SELECT rowid, * FROM messages WHERE id = ? ORDER BY timestamp DESC LIMIT 1")
          .get(messageId)
  ) as (RawRow & { rowid: number | bigint }) | undefined;
  if (targetRow === undefined) {
    return null;
  }
  const chat = asString(targetRow.chat_jid) ?? "";
  const ts = asString(targetRow.timestamp) ?? "";
  const targetRowId = targetRow.rowid;
  const beforeRows = store.db
    .prepare(
      `SELECT * FROM messages WHERE chat_jid = ? AND (timestamp < ? OR (timestamp = ? AND rowid < ?))
       ORDER BY timestamp DESC, rowid DESC LIMIT ?`,
    )
    .all(chat, ts, ts, targetRowId, safeRadius) as RawRow[];
  const afterRows = store.db
    .prepare(
      `SELECT * FROM messages WHERE chat_jid = ? AND (timestamp > ? OR (timestamp = ? AND rowid > ?))
       ORDER BY timestamp ASC, rowid ASC LIMIT ?`,
    )
    .all(chat, ts, ts, targetRowId, safeRadius) as RawRow[];
  return {
    target: rowToMessage(targetRow),
    before: beforeRows.reverse().map(rowToMessage),
    after: afterRows.map(rowToMessage),
  };
}

function likeEscape(value: string): string {
  return value.replace(/[\\%_]/g, (char) => `\\${char}`);
}

function sanitizeFtsQuery(query: string): string | null {
  const tokens = query.trim().match(/"[^"]*"|\S+/g) ?? [];
  const processed = tokens
    .filter((token) => token.length > 0)
    .map((token) => {
      if (FTS_OPERATORS.has(token)) {
        return token;
      }
      if (/^"[^"]*"$/.test(token)) {
        return token;
      }
      if (token.endsWith("*") && token.length > 1) {
        return `"${token.slice(0, -1)}"*`;
      }
      return `"${token}"`;
    });
  const cleaned = processed.filter((token) => token !== '""');
  return cleaned.length > 0 ? cleaned.join(" ") : null;
}

export function searchMessages(
  store: Store,
  query: string,
  opts: Pagination & { chatJid?: string } = {},
): MessageRow[] {
  const { limit, offset } = clamp(opts.limit, opts.offset);
  const chatParams: Array<string> = [];
  let chatClause = "";
  if (opts.chatJid !== undefined) {
    chatClause = " AND m.chat_jid = ?";
    chatParams.push(opts.chatJid);
  }
  const sanitized = sanitizeFtsQuery(query);
  if (sanitized !== null) {
    try {
      const rows = store.db
        .prepare(
          `SELECT m.* FROM messages m JOIN messages_fts f ON m.chat_jid = f.chat_jid AND m.id = f.message_id
           WHERE messages_fts MATCH ?${chatClause}
           ORDER BY m.timestamp DESC, m.rowid DESC LIMIT ? OFFSET ?`,
        )
        .all(sanitized, ...chatParams, limit, offset) as RawRow[];
      return rows.map(rowToMessage);
    } catch {
      return likeFallback(store, query, opts, limit, offset);
    }
  }
  return likeFallback(store, query, opts, limit, offset);
}

function likeFallback(
  store: Store,
  query: string,
  opts: { chatJid?: string },
  limit: number,
  offset: number,
): MessageRow[] {
  const pattern = `%${likeEscape(query.trim())}%`;
  if (pattern === "%%") {
    return [];
  }
  if (opts.chatJid !== undefined) {
    const rows = store.db
      .prepare(
        `SELECT * FROM messages WHERE content LIKE ? ESCAPE '\\' AND chat_jid = ?
         ORDER BY timestamp DESC, rowid DESC LIMIT ? OFFSET ?`,
      )
      .all(pattern, opts.chatJid, limit, offset) as RawRow[];
    return rows.map(rowToMessage);
  }
  const rows = store.db
    .prepare(
      `SELECT * FROM messages WHERE content LIKE ? ESCAPE '\\'
       ORDER BY timestamp DESC, rowid DESC LIMIT ? OFFSET ?`,
    )
    .all(pattern, limit, offset) as RawRow[];
  return rows.map(rowToMessage);
}

export function fetchMessageFromStore(
  store: Store,
  messageId: string,
  chatJid?: string,
): WAMessage | null {
  const row = (
    chatJid !== undefined
      ? store.db
          .prepare("SELECT * FROM messages WHERE id = ? AND chat_jid = ? ORDER BY timestamp DESC")
          .get(messageId, chatJid)
      : store.db
          .prepare("SELECT * FROM messages WHERE id = ? ORDER BY timestamp DESC LIMIT 1")
          .get(messageId)
  ) as RawRow | undefined;
  if (row === undefined) {
    return null;
  }
  const content = asString(row.content);
  let restored: proto.IMessage | undefined;
  const raw = asString(row.raw);
  if (raw !== null) {
    try {
      restored = JSON.parse(raw) as proto.IMessage;
    } catch {
      restored = undefined;
    }
  }
  return {
    key: {
      remoteJid: asString(row.chat_jid) ?? "",
      id: asString(row.id) ?? "",
      fromMe: row.is_from_me === 1,
      participant: asString(row.sender_jid) ?? undefined,
    },
    message: restored ?? (content !== null ? { conversation: content } : undefined),
    messageTimestamp: Math.floor(
      new Date(String((row.timestamp as string | number | null) ?? 0)).getTime() / 1000,
    ),
    pushName: asString(row.sender_name) ?? undefined,
  } as WAMessage;
}
