import type { Store } from "./schema.ts";

export type AgentActivityKind = "send" | "delivery";

export interface AgentActivity {
  kind: AgentActivityKind;
  source: string | null;
  subId: string | null;
  chatJid: string;
  messageId: string;
  ts: string;
}

export function recordAgentActivity(
  store: Store,
  entry: Omit<AgentActivity, "ts"> & { ts?: string },
): void {
  try {
    store.db
      .prepare(
        "INSERT INTO agent_activity (ts, kind, source, sub_id, chat_jid, message_id) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        entry.ts ?? new Date().toISOString(),
        entry.kind,
        entry.source,
        entry.subId,
        entry.chatJid,
        entry.messageId,
      );
  } catch {
    return;
  }
}

export function listAgentActivity(store: Store): AgentActivity[] {
  const rows = store.db
    .prepare(
      "SELECT kind, source, sub_id, chat_jid, message_id, ts FROM agent_activity ORDER BY id ASC",
    )
    .all() as Array<{
    kind: AgentActivityKind;
    source: string | null;
    sub_id: string | null;
    chat_jid: string;
    message_id: string;
    ts: string;
  }>;
  return rows.map((row) => ({
    kind: row.kind,
    source: row.source,
    subId: row.sub_id,
    chatJid: row.chat_jid,
    messageId: row.message_id,
    ts: row.ts,
  }));
}
