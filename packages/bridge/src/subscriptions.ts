import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { Store } from "./store/schema.ts";

export { DISPATCHED_SUBSCRIPTION_KINDS } from "@wa-mcp/shared";

export interface SubscriptionFilters {
  chatJid: string | null;
  fromJid: string | null;
  kinds: string[];
  includeMedia: boolean;
  allChats: boolean;
}

export interface StoredSubscription extends SubscriptionFilters {
  id: string;
  createdAt: string;
}

export interface UpsertEvent {
  chatJid: string;
  fromJid: string;
  kind: string;
  hasMedia: boolean;
}

function newSubscriptionId(): string {
  return randomUUID().replace(/-/g, "").slice(0, 12);
}

export function createSubscription(
  store: Store,
  dataDir: string,
  filters: SubscriptionFilters,
): StoredSubscription {
  const id = newSubscriptionId();
  const createdAt = new Date().toISOString();
  store.db
    .prepare(
      "INSERT INTO subscriptions (id, chat_jid, from_jid, kinds, include_media, all_chats, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      filters.chatJid,
      filters.fromJid,
      JSON.stringify(filters.kinds),
      filters.includeMedia ? 1 : 0,
      filters.allChats ? 1 : 0,
      createdAt,
    );
  const dir = join(dataDir, "subs", id);
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const inboxPath = join(dir, "inbox.jsonl");
  if (!existsSync(inboxPath)) {
    writeFileSync(inboxPath, "", { mode: 0o600 });
  }
  return { id, createdAt, ...filters };
}

function rowToSubscription(row: Record<string, unknown>): StoredSubscription {
  return {
    id: row.id as string,
    chatJid: (row.chat_jid as string | null) ?? null,
    fromJid: (row.from_jid as string | null) ?? null,
    kinds: JSON.parse(row.kinds as string) as string[],
    includeMedia: row.include_media === 1,
    allChats: row.all_chats === 1,
    createdAt: row.created_at as string,
  };
}

export function listSubscriptions(store: Store): StoredSubscription[] {
  const rows = store.db
    .prepare(
      "SELECT id, chat_jid, from_jid, kinds, include_media, all_chats, created_at FROM subscriptions ORDER BY created_at",
    )
    .all() as Array<Record<string, unknown>>;
  return rows.map(rowToSubscription);
}

export function deleteSubscription(store: Store, id: string): boolean {
  const result = store.db.prepare("DELETE FROM subscriptions WHERE id = ?").run(id);
  return result.changes > 0;
}

export function matchSubscription(sub: SubscriptionFilters, event: UpsertEvent): boolean {
  if (!sub.allChats && sub.chatJid !== null && sub.chatJid !== event.chatJid) {
    return false;
  }
  if (sub.fromJid !== null && sub.fromJid !== event.fromJid) {
    return false;
  }
  if (sub.kinds.length > 0 && !sub.kinds.includes(event.kind)) {
    return false;
  }
  if (!sub.includeMedia && event.hasMedia) {
    return false;
  }
  return true;
}

export function subscriptionDir(dataDir: string, id: string): string {
  return join(dataDir, "subs", id);
}

export function subscriptionDirExists(dataDir: string, id: string): boolean {
  return existsSync(subscriptionDir(dataDir, id));
}
