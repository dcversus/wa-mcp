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
  reactions: Array<ReactionAggregate> | null;
  poll?: { question: string; options: Array<{ label: string; votes: number }> } | null;
  forwarded?: boolean;
  forwardedFrom?: string | null;
  raw?: string | null;
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

export interface ReactionAggregate {
  emote: string;
  count: number;
  senders: string[];
}

/** T78 M2: reactions read back as an aggregate — per emoji, with count and
 * the senders behind it — built from the sender-keyed reactions table. */
function attachReactions(store: Store, rows: MessageRow[]): void {
  if (rows.length === 0) {
    return;
  }
  const ids = Array.from(new Set(rows.map((row) => row.id)));
  const placeholders = ids.map(() => "?").join(",");
  const found = store.db
    .prepare(
      `SELECT chat_jid, message_id, emoji, sender_jid FROM reactions WHERE message_id IN (${placeholders}) ORDER BY created_at, sender_jid`,
    )
    .all(...ids) as Array<{
    chat_jid: string;
    message_id: string;
    emoji: string;
    sender_jid: string;
  }>;
  const grouped = new Map<string, Map<string, ReactionAggregate>>();
  for (const entry of found) {
    const key = `${entry.chat_jid}\u0000${entry.message_id}`;
    const byEmoji = grouped.get(key) ?? new Map<string, ReactionAggregate>();
    const agg = byEmoji.get(entry.emoji) ?? { emote: entry.emoji, count: 0, senders: [] };
    agg.count += 1;
    agg.senders.push(entry.sender_jid);
    byEmoji.set(entry.emoji, agg);
    grouped.set(key, byEmoji);
  }
  for (const row of rows) {
    const byEmoji = grouped.get(`${row.chatJid}\u0000${row.id}`);
    if (byEmoji === undefined) {
      row.reactions = null;
      continue;
    }
    const list = Array.from(byEmoji.values()).sort((a, b) => b.count - a.count);
    row.reactions = list.length > 0 ? list : null;
  }
}

/** T78 M3: poll rows carry their question + per-option vote counts. */
function attachPolls(store: Store, rows: MessageRow[]): void {
  const pollIds = rows.filter((row) => row.poll === undefined).map((row) => row.id);
  if (pollIds.length === 0) {
    return;
  }
  const placeholders = pollIds.map(() => "?").join(",");
  const options = store.db
    .prepare(
      `SELECT message_id, chat_jid, idx, label FROM poll_options WHERE message_id IN (${placeholders}) ORDER BY idx`,
    )
    .all(...pollIds) as Array<{ message_id: string; chat_jid: string; idx: number; label: string }>;
  const votes = store.db
    .prepare(
      `SELECT message_id, option_idx, COUNT(*) AS n FROM poll_votes WHERE message_id IN (${placeholders}) GROUP BY message_id, option_idx`,
    )
    .all(...pollIds) as Array<{ message_id: string; option_idx: number; n: number }>;
  const votesBy = new Map<string, number>();
  for (const entry of votes) {
    votesBy.set(`${entry.message_id}\u0000${entry.option_idx}`, entry.n);
  }
  for (const row of rows) {
    const mine = options.filter(
      (option) => option.message_id === row.id && option.chat_jid === row.chatJid,
    );
    if (mine.length === 0) {
      row.poll = null;
      continue;
    }
    row.poll = {
      question: asString(row.content) ?? "",
      options: mine.map((option) => ({
        label: option.label,
        votes: votesBy.get(`${row.id}\u0000${option.idx}`) ?? 0,
      })),
    };
  }
}

/** T85 line97: forwarded rows surface the flag + the original participant
 * when the engine's contextInfo carries it (raw JSON written at ingest). */
function attachForwarded(rows: MessageRow[]): void {
  for (const row of rows) {
    if (row.raw === undefined || row.raw === null) {
      row.forwarded = false;
      continue;
    }
    try {
      const parsed = JSON.parse(row.raw) as {
        contextInfo?: { isForwarded?: boolean; participant?: string };
      };
      row.forwarded = parsed.contextInfo?.isForwarded === true;
      row.forwardedFrom = parsed.contextInfo?.participant ?? null;
    } catch {
      row.forwarded = false;
    }
  }
}

/** T85 line117: poll vote aggregate with per-option voter lists. */
export function pollVotesAggregate(
  store: Store,
  chatJid: string,
  messageId: string,
): { question: string; options: Array<{ label: string; votes: number; voters: string[] }> } | null {
  const row = store.db
    .prepare("SELECT content, raw FROM messages WHERE chat_jid = ? AND id = ?")
    .get(chatJid, messageId) as { content?: string | null; raw?: string | null } | undefined;
  if (row === undefined) {
    return null;
  }
  let question = "";
  try {
    const parsed =
      row.raw !== null && row.raw !== undefined
        ? (JSON.parse(row.raw) as { pollCreationMessage?: { name?: string } })
        : undefined;
    question = parsed?.pollCreationMessage?.name ?? asString(row.content) ?? "";
  } catch {
    question = asString(row.content) ?? "";
  }
  const options = store.db
    .prepare(
      "SELECT idx, label FROM poll_options WHERE chat_jid = ? AND message_id = ? ORDER BY idx",
    )
    .all(chatJid, messageId) as Array<{ idx: number; label: string }>;
  const votes = store.db
    .prepare(
      "SELECT option_idx, voter_jid FROM poll_votes WHERE chat_jid = ? AND message_id = ? ORDER BY voted_at",
    )
    .all(chatJid, messageId) as Array<{ option_idx: number; voter_jid: string }>;
  return {
    question,
    options: options.map((option) => {
      const voters = votes
        .filter((vote) => vote.option_idx === option.idx)
        .map((vote) => vote.voter_jid);
      return { label: option.label, votes: voters.length, voters };
    }),
  };
}

function attachOne(store: Store, row: MessageRow): MessageRow {
  attachReactions(store, [row]);
  attachForwarded([row]);
  attachPolls(store, [row]);
  return row;
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
    reactions: null, // populated by attachReactions (T78 M2 aggregate)
    raw: asString(row.raw),
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
  const messages = rows.map(rowToMessage);
  attachReactions(store, messages);
  attachForwarded(messages);
  attachPolls(store, messages);
  return messages;
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
    target: attachOne(store, rowToMessage(targetRow)),
    before: beforeRows.reverse().map((row) => attachOne(store, rowToMessage(row))),
    after: afterRows.map((row) => attachOne(store, rowToMessage(row))),
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
      const messages = rows.map(rowToMessage);
      attachReactions(store, messages);
      attachForwarded(messages);
      attachPolls(store, messages);
      return messages;
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
    const messages = rows.map(rowToMessage);
    attachReactions(store, messages);
    attachForwarded(messages);
    attachPolls(store, messages);
    return messages;
  }
  const rows = store.db
    .prepare(
      `SELECT * FROM messages WHERE content LIKE ? ESCAPE '\\'
       ORDER BY timestamp DESC, rowid DESC LIMIT ? OFFSET ?`,
    )
    .all(pattern, limit, offset) as RawRow[];
  const messages = rows.map(rowToMessage);
  attachReactions(store, messages);
  attachForwarded(messages);
  attachPolls(store, messages);
  return messages;
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

/** T87 line121: total rows matching a message filter (for truncation meta). */
export function countMessages(
  store: Store,
  opts: { chatJid?: string; sender?: string; after?: Date; before?: Date } = {},
): number {
  const conditions: string[] = [];
  const params: unknown[] = [];
  if (opts.chatJid !== undefined) {
    conditions.push("chat_jid = ?");
    params.push(opts.chatJid);
  }
  if (opts.sender !== undefined) {
    conditions.push("sender_jid = ?");
    params.push(opts.sender);
  }
  if (opts.after !== undefined) {
    conditions.push("timestamp >= ?");
    params.push(opts.after.toISOString());
  }
  if (opts.before !== undefined) {
    conditions.push("timestamp < ?");
    params.push(opts.before.toISOString());
  }
  const where = conditions.length > 0 ? ` WHERE ${conditions.join(" AND ")}` : "";
  const row = store.db.prepare(`SELECT COUNT(*) AS n FROM messages${where}`).get(...params) as {
    n: number;
  };
  return row.n;
}
