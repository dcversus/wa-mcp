import { randomUUID } from "node:crypto";
import type {
  SubscriptionConfig,
  SubscriptionConfigInput,
  SubscriptionDelivery,
  SubscriptionFilter,
} from "@wa-mcp/shared";
import type { Store } from "./schema.ts";

interface ConfigRow {
  id: string;
  name: string;
  chats: string;
  filter: string;
  prompt: string | null;
  delivery: string;
  enabled: number;
  created: string;
}

function parseJson<T>(raw: string, isValid: (value: unknown) => boolean, fallback: T): T {
  try {
    const parsed: unknown = JSON.parse(raw);
    return isValid(parsed) ? (parsed as T) : fallback;
  } catch {
    return fallback;
  }
}

function isPlainObject(value: unknown): boolean {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function rowToConfig(row: ConfigRow): SubscriptionConfig {
  const config: SubscriptionConfig = {
    id: row.id,
    name: row.name,
    chats: parseJson<string[]>(row.chats, Array.isArray, []),
    filter: parseJson<SubscriptionFilter>(row.filter, isPlainObject, {}),
    delivery: parseJson<SubscriptionDelivery>(
      row.delivery,
      (value) => isPlainObject(value) && typeof (value as { mode?: unknown }).mode === "string",
      { mode: "inbox" },
    ),
    enabled: row.enabled === 1,
    created: row.created,
  };
  if (row.prompt !== null) {
    config.prompt = row.prompt;
  }
  return config;
}

export function listSubscriptionConfigs(store: Store): SubscriptionConfig[] {
  const rows = store.db
    .prepare("SELECT * FROM subscription_configs ORDER BY created, rowid")
    .all() as unknown as ConfigRow[];
  return rows.map(rowToConfig);
}

export function getSubscriptionConfig(store: Store, id: string): SubscriptionConfig | null {
  const row = store.db.prepare("SELECT * FROM subscription_configs WHERE id = ?").get(id) as
    | ConfigRow
    | undefined;
  return row === undefined ? null : rowToConfig(row);
}

export function createSubscriptionConfig(
  store: Store,
  input: SubscriptionConfigInput,
): SubscriptionConfig {
  const id = randomUUID().replace(/-/g, "").slice(0, 12);
  store.db
    .prepare(
      "INSERT INTO subscription_configs (id, name, chats, filter, prompt, delivery, enabled, created) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      id,
      input.name,
      JSON.stringify(input.chats),
      JSON.stringify(input.filter),
      input.prompt ?? null,
      JSON.stringify(input.delivery),
      input.enabled ? 1 : 0,
      new Date().toISOString(),
    );
  return getSubscriptionConfig(store, id) as SubscriptionConfig;
}

export function updateSubscriptionConfig(
  store: Store,
  id: string,
  input: SubscriptionConfigInput,
): SubscriptionConfig | null {
  const info = store.db
    .prepare(
      "UPDATE subscription_configs SET name = ?, chats = ?, filter = ?, prompt = ?, delivery = ?, enabled = ? WHERE id = ?",
    )
    .run(
      input.name,
      JSON.stringify(input.chats),
      JSON.stringify(input.filter),
      input.prompt ?? null,
      JSON.stringify(input.delivery),
      input.enabled ? 1 : 0,
      id,
    );
  return info.changes === 0 ? null : getSubscriptionConfig(store, id);
}

export function deleteSubscriptionConfig(store: Store, id: string): boolean {
  return store.db.prepare("DELETE FROM subscription_configs WHERE id = ?").run(id).changes > 0;
}
