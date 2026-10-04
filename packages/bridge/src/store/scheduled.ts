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
  input: { chatJid: string; payload: string | Record<string, unknown>; sendAt: string },
): number {
  // T94-D-M6 (CODEX): the due comparison is lexical over the stored string —
  // offsets like +03:00 fired 3h late and non-ISO values never fired at all.
  // Normalize EVERYTHING to UTC ISO on the way in.
  const parsed = new Date(input.sendAt);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error("VALIDATION_ERROR: send_at must be an ISO 8601 timestamp");
  }
  const payload = typeof input.payload === "string" ? input.payload : JSON.stringify(input.payload);
  const result = store.db
    .prepare("INSERT INTO scheduled_messages (chat_jid, payload, send_at) VALUES (?, ?, ?)")
    .run(input.chatJid, payload, parsed.toISOString());
  return Number(result.lastInsertRowid);
}

/** T84-B line98: route every due row through `send` (text payloads stay
 * strings; media payloads arrive as parsed objects) and mark sent/failed. */
export async function processDue(
  store: Store,
  now: Date,
  send: (chatJid: string, payload: string | Record<string, unknown>) => Promise<string>,
): Promise<void> {
  for (const row of dueScheduled(store, now)) {
    let parsed: string | Record<string, unknown>;
    try {
      const parsedJson: unknown = JSON.parse(row.payload);
      parsed =
        parsedJson !== null && typeof parsedJson === "object"
          ? (parsedJson as Record<string, unknown>)
          : row.payload;
    } catch {
      parsed = row.payload;
    }
    try {
      const messageId = await send(row.chat_jid, parsed);
      markScheduled(store, row.id, "sent", messageId);
    } catch (err) {
      markScheduled(
        store,
        row.id,
        "failed",
        undefined,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
}

export function listScheduled(store: Store, status?: string): ScheduledRow[] {
  const rows = (status === undefined
    ? store.db.prepare("SELECT * FROM scheduled_messages ORDER BY send_at").all()
    : store.db
        .prepare("SELECT * FROM scheduled_messages WHERE status = ? ORDER BY send_at")
        .all(status)) as unknown as ScheduledRow[];
  return rows;
}

export function dueScheduled(store: Store, now: Date): ScheduledRow[] {
  return store.db
    .prepare(
      "SELECT * FROM scheduled_messages WHERE status = 'pending' AND send_at <= ? ORDER BY send_at",
    )
    .all(now.toISOString()) as unknown as ScheduledRow[];
}

export function markScheduled(
  store: Store,
  id: number,
  status: "sent" | "failed" | "cancelled",
  sentMessageId?: string,
  reason?: string,
): void {
  // T94-D-H3: the refusal reason survives on the row — "failed" alone hides
  // whether it was the rules, the budget or the engine
  store.db
    .prepare(
      "UPDATE scheduled_messages SET status = ?, sent_message_id = ?, last_error = ? WHERE id = ?",
    )
    .run(status, sentMessageId ?? null, reason ?? null, id);
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
