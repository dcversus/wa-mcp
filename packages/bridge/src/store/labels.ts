import type { Store } from "./schema.ts";

export interface LabelRow {
  id: number;
  name: string;
  color: string;
}

/** T89 line125: our own label registry — WA labels are account-level, the
 * chat_labels mapping records which chat carries which label. */
export function addLabel(store: Store, label: { name: string; color: string }): number {
  const result = store.db
    .prepare("INSERT INTO labels (name, color) VALUES (?, ?)")
    .run(label.name, label.color);
  return Number(result.lastInsertRowid);
}

export function listLabels(store: Store): LabelRow[] {
  return store.db
    .prepare("SELECT id, name, color FROM labels ORDER BY id")
    .all() as unknown as LabelRow[];
}

export function assignChatLabel(store: Store, chatJid: string, labelId: number): void {
  store.db
    .prepare("INSERT OR IGNORE INTO chat_labels (chat_jid, label_id) VALUES (?, ?)")
    .run(chatJid, labelId);
}

export function chatLabels(store: Store, chatJid: string): LabelRow[] {
  return store.db
    .prepare(
      "SELECT l.id, l.name, l.color FROM labels l JOIN chat_labels c ON c.label_id = l.id WHERE c.chat_jid = ? ORDER BY l.id",
    )
    .all(chatJid) as unknown as LabelRow[];
}

export function removeLabel(store: Store, id: number): void {
  store.db.prepare("DELETE FROM labels WHERE id = ?").run(id);
  store.db.prepare("DELETE FROM chat_labels WHERE label_id = ?").run(id);
}
