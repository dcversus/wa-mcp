import type { Store } from "./schema.ts";

/** T80 line66: sync-status metadata (GOAL §3). The watermark is the wall
 * clock of the last completed history sync; per-chat backfill state rides
 * chats.history_synced_at. */
export function markHistorySynced(store: Store, chatJids: Array<string>): void {
  const now = new Date().toISOString();
  const upsert = store.db.prepare(
    "INSERT INTO meta (key, value) VALUES ('history_sync_watermark', ?)\n    ON CONFLICT(key) DO UPDATE SET value = excluded.value",
  );
  upsert.run(now);
  const mark = store.db.prepare(
    "INSERT INTO chats (jid, name, history_synced_at) VALUES (?, NULL, ?)\n      ON CONFLICT(jid) DO UPDATE SET history_synced_at = excluded.history_synced_at",
  );
  for (const jid of chatJids) {
    mark.run(jid, now);
  }
}
