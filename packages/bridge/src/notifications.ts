import type { Store } from "./store/schema.ts";

export interface NotificationRuleInput {
  chatJid?: string;
  fromJid?: string;
  unreadOnly?: boolean;
  title: string;
  body?: string;
}

export interface NotificationRule {
  id: number;
  chatJid: string | null;
  fromJid: string | null;
  unreadOnly: boolean;
  title: string;
  body: string;
}

export interface WaEventLike {
  type: string;
  payload: unknown;
}

export interface RuleMatch {
  ruleId: number;
  title: string;
  body: string;
}

type RawRow = Record<string, unknown>;

function asString(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

function rowToRule(row: RawRow): NotificationRule {
  return {
    id: Number(row.id ?? 0),
    chatJid: asString(row.chat_jid),
    fromJid: asString(row.from_jid),
    unreadOnly: row.unread_only === 1,
    title: asString(row.title) ?? "",
    body: asString(row.body) ?? "",
  };
}

export function createRule(store: Store, input: NotificationRuleInput): NotificationRule {
  const info = store.db
    .prepare(
      "INSERT INTO notification_rules (chat_jid, from_jid, unread_only, title, body, created_at) VALUES (?, ?, ?, ?, ?, ?)",
    )
    .run(
      input.chatJid ?? null,
      input.fromJid ?? null,
      input.unreadOnly === true ? 1 : 0,
      input.title ?? "",
      input.body ?? "",
      new Date().toISOString(),
    );
  const id = Number(info.lastInsertRowid);
  return {
    id,
    chatJid: input.chatJid ?? null,
    fromJid: input.fromJid ?? null,
    unreadOnly: input.unreadOnly === true,
    title: input.title ?? "",
    body: input.body ?? "",
  };
}

export function listRules(store: Store): NotificationRule[] {
  const rows = store.db
    .prepare("SELECT * FROM notification_rules ORDER BY id ASC")
    .all() as RawRow[];
  return rows.map(rowToRule);
}

export function deleteRule(store: Store, id: number): void {
  store.db.prepare("DELETE FROM notification_rules WHERE id = ?").run(id);
}

interface UpsertPayloadMessage {
  key?: { remoteJid?: string; participant?: string; fromMe?: boolean };
  message?: { conversation?: string; extendedTextMessage?: { text?: string } };
  pushName?: string;
}

function substitute(template: string, values: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (match, key: string) => values[key] ?? match);
}

export function evaluateRules(store: Store, event: WaEventLike): RuleMatch[] {
  if (event.type !== "messages.upsert") {
    return [];
  }
  const payload = event.payload as { messages?: UpsertPayloadMessage[] } | undefined;
  const messages = payload?.messages ?? [];
  const rules = listRules(store);
  const matches: RuleMatch[] = [];
  for (const message of messages) {
    const chatJid = message.key?.remoteJid ?? "";
    const senderJid = message.key?.participant ?? chatJid;
    const fromMe = message.key?.fromMe === true;
    const text =
      message.message?.conversation ??
      message.message?.extendedTextMessage?.text ??
      message.pushName ??
      "";
    for (const rule of rules) {
      if (rule.chatJid !== null && rule.chatJid !== chatJid) {
        continue;
      }
      if (rule.fromJid !== null && rule.fromJid !== senderJid) {
        continue;
      }
      if (rule.unreadOnly && fromMe) {
        continue;
      }
      const values = { chat: chatJid, sender: senderJid, text };
      matches.push({
        ruleId: rule.id,
        title: substitute(rule.title, values),
        body: substitute(rule.body, values),
      });
    }
  }
  return matches;
}
