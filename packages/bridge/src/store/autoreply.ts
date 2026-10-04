import type { Store } from "./schema.ts";

export interface AutoreplyRule {
  id: number;
  match: string;
  reply: string;
  enabled: number;
}

export function addAutoreplyRule(store: Store, rule: { match: string; reply: string }): number {
  const result = store.db
    .prepare("INSERT INTO autoreply_rules (match, reply, enabled, created_at) VALUES (?, ?, 1, ?)")
    .run(rule.match, rule.reply, new Date().toISOString());
  return Number(result.lastInsertRowid);
}

export function listAutoreplyRules(store: Store): AutoreplyRule[] {
  return store.db
    .prepare("SELECT id, match, reply, enabled FROM autoreply_rules ORDER BY id")
    .all() as unknown as AutoreplyRule[];
}

export function removeAutoreplyRule(store: Store, id: number): void {
  store.db.prepare("DELETE FROM autoreply_rules WHERE id = ?").run(id);
}

export function toggleAutoreplyRule(store: Store, id: number, enabled: boolean): void {
  store.db.prepare("UPDATE autoreply_rules SET enabled = ? WHERE id = ?").run(enabled ? 1 : 0, id);
}

/** T84-B line93: first enabled rule whose pattern matches returns its reply
 * body; a per-chat cooldown (meta key) prevents reply loops. The cooldown
 * marker is written at evaluation time — the caller sends right after. */
export function evaluateAutoreply(
  store: Store,
  chatJid: string,
  text: string,
  nowMs: number,
  cooldownMs = 60_000,
): string | null {
  const rules = store.db
    .prepare("SELECT id, match, reply, enabled FROM autoreply_rules WHERE enabled = 1 ORDER BY id")
    .all() as Array<{ id: number; match: string; reply: string; enabled: number }>;
  const cooldownKey = `autoreply:${chatJid}`;
  const lastRow = store.db.prepare("SELECT value FROM meta WHERE key = ?").get(cooldownKey) as
    | { value: string }
    | undefined;
  const last = lastRow === undefined ? 0 : Number(lastRow.value);
  if (Number.isFinite(last) && nowMs - last < cooldownMs) {
    return null;
  }
  for (const rule of rules) {
    let pattern: RegExp;
    try {
      pattern = new RegExp(rule.match, "i");
    } catch {
      continue;
    }
    if (pattern.test(text)) {
      store.db
        .prepare(
          "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
        )
        .run(cooldownKey, String(nowMs));
      return rule.reply;
    }
  }
  return null;
}
