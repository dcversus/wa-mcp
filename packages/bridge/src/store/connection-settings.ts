import {
  DEFAULT_CONNECTION_ID,
  DEFAULT_CONNECTION_SETTINGS,
  validateConnectionSettings,
  type ConnectionSettings,
} from "@wa-mcp/shared";
import type { Store } from "./schema.ts";

export interface ConnectionSettingsRecord {
  connection: string;
  settings: ConnectionSettings;
  updatedAt: string | null;
}

function parseSettings(raw: string): ConnectionSettings {
  try {
    const checked = validateConnectionSettings(JSON.parse(raw) as unknown);
    return checked.ok ? checked.value : DEFAULT_CONNECTION_SETTINGS;
  } catch {
    return DEFAULT_CONNECTION_SETTINGS;
  }
}

export function getConnectionSettingsRecord(
  store: Store,
  connection: string = DEFAULT_CONNECTION_ID,
): ConnectionSettingsRecord {
  const row = store.db
    .prepare("SELECT settings, updated_at FROM connection_settings WHERE id = ?")
    .get(connection) as { settings: string; updated_at: string } | undefined;
  if (row === undefined) {
    return { connection, settings: DEFAULT_CONNECTION_SETTINGS, updatedAt: null };
  }
  return { connection, settings: parseSettings(row.settings), updatedAt: row.updated_at };
}

export function getConnectionSettings(
  store: Store,
  connection: string = DEFAULT_CONNECTION_ID,
): ConnectionSettings {
  return getConnectionSettingsRecord(store, connection).settings;
}

export function saveConnectionSettings(
  store: Store,
  settings: ConnectionSettings,
  connection: string = DEFAULT_CONNECTION_ID,
  now: string = new Date().toISOString(),
): ConnectionSettingsRecord {
  store.db
    .prepare(
      "INSERT INTO connection_settings (id, settings, updated_at) VALUES (?, ?, ?) ON CONFLICT(id) DO UPDATE SET settings = excluded.settings, updated_at = excluded.updated_at",
    )
    .run(connection, JSON.stringify(settings), now);
  return { connection, settings, updatedAt: now };
}

export function countMessagesSince(
  store: Store,
  sinceIso: string,
): { sent: number; received: number } {
  const row = store.db
    .prepare(
      "SELECT COALESCE(SUM(is_from_me = 1), 0) AS sent, COALESCE(SUM(is_from_me = 0), 0) AS received FROM messages WHERE timestamp >= ?",
    )
    .get(sinceIso) as { sent: number; received: number };
  return { sent: Number(row.sent), received: Number(row.received) };
}
