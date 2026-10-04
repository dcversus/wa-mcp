import type { Store } from "./schema.ts";

export function setChatArchived(store: Store, jid: string, archived: boolean): void {
  store.db.prepare("UPDATE chats SET archived = ? WHERE jid = ?").run(archived ? 1 : 0, jid);
}

export function setChatPinned(store: Store, jid: string, pinned: boolean): void {
  store.db.prepare("UPDATE chats SET pinned = ? WHERE jid = ?").run(pinned ? 1 : 0, jid);
}

export function setChatMuted(store: Store, jid: string, until: string | null): void {
  store.db.prepare("UPDATE chats SET muted_until = ? WHERE jid = ?").run(until, jid);
}

function upsertReadState(store: Store, chatJid: string, lastReadMessageId: string | null): void {
  store.db
    .prepare(
      "INSERT INTO read_state (chat_jid, last_read_message_id, unread_count, manually_unread, updated_at) VALUES (?, ?, 0, 0, ?) ON CONFLICT(chat_jid) DO UPDATE SET last_read_message_id = excluded.last_read_message_id, unread_count = 0, updated_at = excluded.updated_at",
    )
    .run(chatJid, lastReadMessageId, new Date().toISOString());
}

export function markChatRead(store: Store, jid: string): void {
  store.db.prepare("UPDATE messages SET is_unread = 0 WHERE chat_jid = ?").run(jid);
  const latest = store.db
    .prepare(
      "SELECT id FROM messages WHERE chat_jid = ? ORDER BY timestamp DESC, rowid DESC LIMIT 1",
    )
    .get(jid) as { id: string } | undefined;
  upsertReadState(store, jid, latest?.id ?? null);
}

export function markMessagesRead(store: Store, chatJid: string, messageIds: string[]): void {
  const placeholders = messageIds.map(() => "?").join(", ");
  store.db
    .prepare(`UPDATE messages SET is_unread = 0 WHERE chat_jid = ? AND id IN (${placeholders})`)
    .run(chatJid, ...messageIds);
  const latest = store.db
    .prepare(
      "SELECT id FROM messages WHERE chat_jid = ? ORDER BY timestamp DESC, rowid DESC LIMIT 1",
    )
    .get(chatJid) as { id: string } | undefined;
  upsertReadState(store, chatJid, latest?.id ?? null);
}

export function markAllRead(store: Store): void {
  const chats = store.db
    .prepare("SELECT DISTINCT chat_jid FROM messages WHERE is_unread = 1")
    .all() as Array<{
    chat_jid: string;
  }>;
  for (const { chat_jid: jid } of chats) {
    markChatRead(store, jid);
  }
}

export function getUnreadCounts(store: Store): Array<{ chatJid: string; unreadCount: number }> {
  // T94-F Runtime-M9: chats.manual_unread was write-only — a manually
  // marked chat counts as unread even with zero unread messages
  const rows = store.db
    .prepare(
      `SELECT COALESCE(c.jid, counts.chat_jid) AS chat_jid,
              CASE WHEN c.manual_unread = 1 THEN MAX(counts.unread, 1) ELSE counts.unread END AS unread
       FROM (
         SELECT chat_jid, COUNT(*) AS unread FROM messages WHERE is_unread = 1 GROUP BY chat_jid
         UNION ALL
         SELECT jid, 0 FROM chats WHERE manual_unread = 1
       ) AS counts
       LEFT JOIN chats c ON c.jid = counts.chat_jid
       GROUP BY COALESCE(c.jid, counts.chat_jid)
       ORDER BY MAX(counts.unread) DESC`,
    )
    .all() as Array<{ chat_jid: string; unread: number }>;
  return rows.map((row) => ({ chatJid: row.chat_jid, unreadCount: row.unread }));
}
