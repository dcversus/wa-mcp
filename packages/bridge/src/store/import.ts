import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import type { Store } from "./schema.ts";

export type SourceLayout = "lharries" | "gofork";

export interface ImportReport {
  chats: number;
  messages: number;
  dryRun: boolean;
}

const upsertChatSql = "INSERT INTO chats (jid, name) VALUES (?, ?) ON CONFLICT(jid) DO NOTHING";
const insertMessageSql = `
INSERT OR IGNORE INTO messages (
  id, chat_jid, sender_jid, sender_name, timestamp, content, is_from_me, is_unread, raw
) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)`;

/** T83: import a foreign-layout store into ours (GOAL line 60). Idempotent:
 * INSERT OR IGNORE keeps existing rows; dry-run counts without writing. */
export function importLayout(
  store: Store,
  layout: SourceLayout,
  path: string,
  opts: { dryRun: boolean },
): ImportReport {
  if (layout === "lharries") {
    return importLharries(store, path, opts.dryRun);
  }
  return importGofork(store, path, opts.dryRun);
}

function importLharries(store: Store, dir: string, dryRun: boolean): ImportReport {
  const chatsDir = join(dir, "chats");
  const files = readdirSync(chatsDir).filter((name) => name.endsWith(".json"));
  let chats = 0;
  let messages = 0;
  for (const file of files) {
    const parsed = JSON.parse(readFileSync(join(chatsDir, file), "utf8")) as {
      jid?: string;
      name?: string;
      messages?: Array<{
        id?: string;
        timestamp?: string;
        sender?: string;
        text?: string;
      }>;
    };
    if (typeof parsed.jid !== "string") {
      continue;
    }
    chats += 1;
    if (!dryRun) {
      store.db.prepare(upsertChatSql).run(parsed.jid, parsed.name ?? null);
    }
    for (const message of parsed.messages ?? []) {
      if (typeof message.id !== "string" || typeof message.text !== "string") {
        continue;
      }
      messages += 1;
      if (dryRun) {
        continue;
      }
      const fromMe = message.sender === "me";
      store.db
        .prepare(insertMessageSql)
        .run(
          message.id,
          parsed.jid,
          fromMe ? null : (message.sender ?? null),
          parsed.name ?? null,
          message.timestamp ?? new Date(0).toISOString(),
          message.text,
          fromMe ? 1 : 0,
          JSON.stringify(message),
        );
    }
  }
  return { chats, messages, dryRun };
}

function importGofork(store: Store, dbPath: string, dryRun: boolean): ImportReport {
  const source = new DatabaseSync(join(dbPath, "store.db"), { readOnly: true });
  try {
    const chats = source.prepare("SELECT jid, name FROM chats").all() as Array<{
      jid: string;
      name: string | null;
    }>;
    const messages = source
      .prepare(
        "SELECT id, chat_jid, timestamp, from_me, sender, content FROM messages ORDER BY timestamp",
      )
      .all() as Array<{
      id: string;
      chat_jid: string;
      timestamp: number;
      from_me: number;
      sender: string | null;
      content: string | null;
    }>;
    if (dryRun) {
      return { chats: chats.length, messages: messages.length, dryRun };
    }
    for (const chat of chats) {
      store.db.prepare(upsertChatSql).run(chat.jid, chat.name ?? null);
    }
    for (const message of messages) {
      store.db
        .prepare(insertMessageSql)
        .run(
          message.id,
          message.chat_jid,
          message.from_me === 1 ? null : message.sender,
          null,
          new Date(message.timestamp * 1000).toISOString(),
          message.content ?? "",
          message.from_me === 1 ? 1 : 0,
          JSON.stringify(message),
        );
    }
    return { chats: chats.length, messages: messages.length, dryRun };
  } finally {
    source.close();
  }
}
