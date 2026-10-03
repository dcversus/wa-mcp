import type { Store } from "./schema.ts";

export interface ScheduledRow {
  id: number;
  chat_jid: string;
  payload: string;
  send_at: string;
  status: "pending" | "sent" | "failed" | "cancelled";
  sent_message_id: string | null;
}

/** T82 line88: schedule a text for later delivery. */
export function scheduleMessage(
  store: Store,
  input: { chatJid: string; payload: string; sendAt: string },
): number {
  const result = store.db
    .prepare("INSERT INTO scheduled_messages (chat_jid, payload, send_at) VALUES (?, ?, ?)")
    .run(input.chatJid, input.payload, input.sendAt);
  return Number(result.lastInsertRowid);
}

export function listScheduled(store: Store, status?: string): ScheduledRow[] {
  const rows = (
    status === undefined
      ? store.db.prepare("SELECT * FROM scheduled_messages ORDER BY send_at").all()
      : store.db
          .prepare("SELECT * FROM scheduled_messages WHERE status = ? ORDER BY send_at")
          .all(status)
  ) as ScheduledRow[];
  return rows;
}

export function dueScheduled(store: Store, now: Date): ScheduledRow[] {
  return store.db
    .prepare(
      "SELECT * FROM scheduled_messages WHERE status = 'pending' AND send_at <= ? ORDER BY send_at",
    )
    .all(now.toISOString()) as ScheduledRow[];
}

export function markScheduled(
  store: Store,
  id: number,
  status: "sent" | "failed" | "cancelled",
  sentMessageId?: string,
): void {
  store.db
    .prepare("UPDATE scheduled_messages SET status = ?, sent_message_id = ? WHERE id = ?")
    .run(status, sentMessageId ?? null, id);
}

/** T82 line88: cancel a pending schedule — too-late cancels report false. */
export function cancelScheduled(store: Store, id: number): boolean {
  const result = store.db
    .prepare(
      "UPDATE scheduled_messages SET status = 'cancelled' WHERE id = ? AND status = 'pending'",
    )
    .run(id);
  return Number(result.changes) > 0;
}
