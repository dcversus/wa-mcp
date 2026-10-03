import type { Store } from "./schema.ts";

export interface SendRule {
  id: number;
  target: string;
  mode: "block" | "allow";
  expiresAt: string | null;
}

/** T82 line91: add a per-target send rule. A trailing '*' matches any suffix
 * (e.g. '*@g.us' blocks every group). */
export function addSendRule(
  store: Store,
  rule: { target: string; mode: "block" | "allow"; expiresAt?: string },
): number {
  const result = store.db
    .prepare("INSERT INTO send_rules (target, mode, expires_at) VALUES (?, ?, ?)")
    .run(rule.target, rule.mode, rule.expiresAt ?? null);
  return Number(result.lastInsertRowid);
}

export function listSendRules(store: Store): SendRule[] {
  const rows = store.db
    .prepare("SELECT id, target, mode, expires_at FROM send_rules ORDER BY id")
    .all() as Array<{
    id: number;
    target: string;
    mode: "block" | "allow";
    expires_at: string | null;
  }>;
  return rows.map((row) => ({
    id: row.id,
    target: row.target,
    mode: row.mode,
    expiresAt: row.expires_at,
  }));
}

export function removeSendRule(store: Store, id: number): void {
  store.db.prepare("DELETE FROM send_rules WHERE id = ?").run(id);
}

function ruleMatches(target: string, pattern: string): boolean {
  if (pattern === target) return true;
  if (pattern.endsWith("*")) return target.startsWith(pattern.slice(0, -1));
  return false;
}

/** T82 line91: the send-path gate — expired rules are ignored, BLOCK beats
 * ALLOW, no match means allowed. */
export function evaluateSendRules(
  store: Store,
  chatJid: string,
  now: Date = new Date(),
): { allowed: boolean; rule: SendRule | null } {
  for (const rule of listSendRules(store)) {
    if (rule.expiresAt !== null && new Date(rule.expiresAt) <= now) {
      continue;
    }
    if (rule.mode === "allow" || !ruleMatches(chatJid, rule.target)) {
      continue;
    }
    return { allowed: false, rule };
  }
  return { allowed: true, rule: null };
}
