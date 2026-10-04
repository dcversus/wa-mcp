import type { Store } from "./schema.ts";
import { listMessages } from "./queries.ts";

export type ExportFormat = "jsonl" | "md" | "txt";

export interface ExportRow {
  id: string;
  chatJid: string;
  timestamp: string;
  sender: string | null;
  fromMe: boolean;
  text: string;
  unread: boolean;
}

function rows(store: Store, chatJid: string | undefined, unreadOnly: boolean): ExportRow[] {
  const where: string[] = [];
  const params: (string | number)[] = [];
  if (chatJid !== undefined) {
    where.push("chat_jid = ?");
    params.push(chatJid);
  }
  if (unreadOnly) {
    where.push("is_unread = 1");
  }
  const suffix = where.length > 0 ? ` WHERE ${where.join(" AND ")}` : "";
  const rows = store.db
    .prepare(`SELECT * FROM messages${suffix} ORDER BY timestamp`)
    .all(...params) as Array<Record<string, unknown>>;
  return rows.map((row) => ({
    id: String(row.id ?? ""),
    chatJid: String(row.chat_jid ?? ""),
    timestamp: String(row.timestamp ?? ""),
    sender: typeof row.sender_jid === "string" ? row.sender_jid : null,
    fromMe: row.is_from_me === 1,
    text: typeof row.content === "string" ? row.content : "",
    unread: row.is_unread === 1,
  }));
}

/** T87-B line122: export messages as JSONL / markdown / plain text. Media is
 * referenced by type only (no transcription, v1). */
export function exportMessages(
  store: Store,
  opts: { chatJid?: string; unreadOnly?: boolean; format: ExportFormat },
): string {
  const data = rows(store, opts.chatJid, opts.unreadOnly === true);
  if (opts.format === "jsonl") {
    return data.map((row) => JSON.stringify(row)).join("\n");
  }
  if (opts.format === "md") {
    return data
      .map((row) => {
        const header = `## ${row.timestamp.slice(0, 10)} — ${row.sender ?? (row.fromMe ? "me" : row.chatJid)}`;
        return `${header}\n\n${row.text}`;
      })
      .join("\n\n");
  }
  return data
    .map(
      (row) => `[${row.timestamp}] ${row.sender ?? (row.fromMe ? "me" : row.chatJid)}: ${row.text}`,
    )
    .join("\n");
}
