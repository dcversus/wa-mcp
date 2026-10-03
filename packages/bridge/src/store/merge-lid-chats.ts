import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { withTransaction, type Store } from "./schema.ts";

/** Reverse-mapping file the engine writes: lid-mapping-<lid>_reverse.json
 * containing the phone-number user string (fork lid-mapping.js batchData). */
function reverseMappingFile(authDir: string, lidUser: string): string {
  return join(authDir, `lid-mapping-${lidUser}_reverse.json`);
}

export function readReverseMapping(authDir: string, lidUser: string): string | null {
  const file = reverseMappingFile(authDir, lidUser);
  if (!existsSync(file)) {
    return null;
  }
  try {
    const pn = JSON.parse(readFileSync(file, "utf8")) as unknown;
    // engine PNs are digit strings; a corrupt file must not mint a garbage chat
    return typeof pn === "string" && /^\d+$/.test(pn) ? pn : null;
  } catch {
    return null;
  }
}

export interface MergeResult {
  mergedChats: number;
  movedMessages: number;
  skippedMessages: number;
}

/** One-time repair for the LID/PN chat split (T58): every chat stored under
 * <lid>@lid whose reverse mapping resolves a phone number is merged into
 * <pn>@s.whatsapp.net — messages (INSERT OR IGNORE: duplicate ids keep the
 * original), read_state (counts add, newest updated_at wins), chat metadata
 * (newest last-message wins) — then the LID chat row is deleted. Runs in ONE
 * transaction; chats without a reverse mapping are left untouched. */
export function mergeLidChats(store: Store, authDir: string): MergeResult {
  const result: MergeResult = { mergedChats: 0, movedMessages: 0, skippedMessages: 0 };
  const lidChats = store.db.prepare("SELECT jid FROM chats WHERE jid LIKE '%@lid'").all() as Array<{
    jid: string;
  }>;
  for (const { jid: lidJid } of lidChats) {
    const lidUser = lidJid.slice(0, -"@lid".length);
    const pn = readReverseMapping(authDir, lidUser);
    if (pn === null) {
      continue;
    }
    const pnJid = `${pn}@s.whatsapp.net`;
    withTransaction(store, () => {
      store.db
        .prepare(
          `INSERT OR IGNORE INTO messages
             (id, chat_jid, sender_jid, sender_name, timestamp, content, media_type,
              media_path, quoted_message_id, mentions, is_from_me, is_unread, reactions, raw)
           SELECT id, ?, sender_jid, sender_name, timestamp, content, media_type,
              media_path, quoted_message_id, mentions, is_from_me, is_unread, reactions, raw
           FROM messages WHERE chat_jid = ?`,
        )
        .run(pnJid, lidJid);
      const moved = store.db.prepare("SELECT changes() AS n").get() as { n: number };
      result.movedMessages += moved.n;
      const skipped = store.db
        .prepare("SELECT COUNT(*) AS n FROM messages WHERE chat_jid = ?")
        .get(lidJid) as { n: number };
      result.skippedMessages += skipped.n;
      const pnChat = store.db.prepare("SELECT * FROM chats WHERE jid = ?").get(pnJid) as
        | { last_message_ts?: string | null }
        | undefined;
      const lidChat = store.db.prepare("SELECT * FROM chats WHERE jid = ?").get(lidJid) as
        | {
            name?: string | null;
            last_message_text?: string | null;
            last_message_ts?: string | null;
          }
        | undefined;
      if (lidChat !== undefined) {
        const newer =
          pnChat === undefined ||
          pnChat.last_message_ts === undefined ||
          pnChat.last_message_ts === null ||
          (lidChat.last_message_ts ?? "") > (pnChat.last_message_ts ?? "");
        store.db
          .prepare(
            `INSERT INTO chats (jid, name, last_message_text, last_message_ts)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(jid) DO UPDATE SET
               name = CASE WHEN ? AND COALESCE(NULLIF(excluded.name, ''), '') <> ''
                      THEN excluded.name ELSE chats.name END,
               last_message_text = CASE WHEN ? THEN excluded.last_message_text ELSE chats.last_message_text END,
               last_message_ts = CASE WHEN ? THEN excluded.last_message_ts ELSE chats.last_message_ts END`,
          )
          .run(
            pnJid,
            lidChat.name ?? null,
            lidChat.last_message_text ?? null,
            lidChat.last_message_ts ?? null,
            newer ? 1 : 0,
            newer ? 1 : 0,
            newer ? 1 : 0,
          );
      }
      const lidRead = store.db
        .prepare("SELECT * FROM read_state WHERE chat_jid = ?")
        .get(lidJid) as
        | {
            last_read_message_id?: string | null;
            unread_count?: number;
            updated_at?: string | null;
          }
        | undefined;
      if (lidRead !== undefined) {
        store.db
          .prepare(
            `INSERT INTO read_state (chat_jid, last_read_message_id, unread_count, updated_at)
             VALUES (?, ?, ?, ?)
             ON CONFLICT(chat_jid) DO UPDATE SET
               unread_count = read_state.unread_count + excluded.unread_count,
               updated_at = MAX(read_state.updated_at, excluded.updated_at)`,
          )
          .run(
            pnJid,
            lidRead.last_read_message_id ?? null,
            lidRead.unread_count ?? 0,
            lidRead.updated_at ?? null,
          );
        store.db.prepare("DELETE FROM read_state WHERE chat_jid = ?").run(lidJid);
      }
      store.db.prepare("DELETE FROM messages WHERE chat_jid = ?").run(lidJid);
      store.db.prepare("DELETE FROM chats WHERE jid = ?").run(lidJid);
      result.mergedChats += 1;
    });
  }
  return result;
}
