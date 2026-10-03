import { withTransaction, type Store } from "./schema.ts";

export interface GroupParticipantRow {
  jid: string;
  admin: string | null;
}

/** Persist the participant roster from a groups.upsert / groupMetadata
 * fetch. Idempotent: replaces the roster for the group in one transaction. */
export function upsertGroupParticipants(
  store: Store,
  groupJid: string,
  participants: Array<{ id: string; admin?: string | null }>,
): void {
  const del = store.db.prepare("DELETE FROM group_participants WHERE group_jid = ?");
  const ins = store.db.prepare(
    "INSERT OR IGNORE INTO group_participants (group_jid, jid, admin) VALUES (?, ?, ?)",
  );
  withTransaction(store, () => {
    del.run(groupJid);
    for (const participant of participants) {
      ins.run(groupJid, participant.id, participant.admin ?? null);
    }
  });
}

export function listGroupParticipants(
  store: Store,
  groupJid: string,
): Array<GroupParticipantRow> {
  return store.db
    .prepare(
      "SELECT jid, admin FROM group_participants WHERE group_jid = ? ORDER BY jid",
    )
    .all(groupJid) as Array<GroupParticipantRow>;
}
