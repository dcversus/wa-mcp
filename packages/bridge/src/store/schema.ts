import { chmodSync, mkdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { join } from "node:path";

export interface Store {
  readonly db: DatabaseSync;
  close(): void;
}

const SCHEMA_V1 = `
CREATE TABLE IF NOT EXISTS migrations (
  version INTEGER PRIMARY KEY,
  applied_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chats (
  jid TEXT PRIMARY KEY,
  name TEXT,
  archived INTEGER NOT NULL DEFAULT 0,
  pinned INTEGER NOT NULL DEFAULT 0,
  muted_until TEXT,
  ephemeral INTEGER NOT NULL DEFAULT 0,
  ephemeral_expiry TEXT,
  last_message_text TEXT,
  last_message_ts TEXT
);
CREATE TABLE IF NOT EXISTS messages (
  id TEXT NOT NULL,
  chat_jid TEXT NOT NULL,
  sender_jid TEXT,
  sender_name TEXT,
  timestamp TEXT NOT NULL,
  content TEXT,
  media_type TEXT,
  media_path TEXT,
  quoted_message_id TEXT,
  mentions TEXT,
  is_from_me INTEGER NOT NULL DEFAULT 0,
  is_unread INTEGER NOT NULL DEFAULT 1,
  reactions TEXT,
  PRIMARY KEY (chat_jid, id)
);
CREATE TABLE IF NOT EXISTS contacts (
  jid TEXT PRIMARY KEY,
  name TEXT,
  pushname TEXT,
  business_name TEXT
);
CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  type TEXT NOT NULL,
  payload TEXT,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS poll_options (
  chat_jid TEXT NOT NULL,
  message_id TEXT NOT NULL,
  idx INTEGER NOT NULL,
  label TEXT NOT NULL,
  PRIMARY KEY (chat_jid, message_id, idx)
);
CREATE TABLE IF NOT EXISTS poll_votes (
  chat_jid TEXT NOT NULL,
  message_id TEXT NOT NULL,
  voter_jid TEXT NOT NULL,
  option_idx INTEGER NOT NULL,
  voted_at TEXT NOT NULL,
  PRIMARY KEY (chat_jid, message_id, voter_jid, option_idx)
);
CREATE TABLE IF NOT EXISTS read_state (
  chat_jid TEXT PRIMARY KEY,
  last_read_message_id TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  manually_unread INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT
);
CREATE TABLE IF NOT EXISTS media_files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id TEXT NOT NULL,
  chat_jid TEXT NOT NULL,
  path TEXT NOT NULL,
  mime_type TEXT,
  size INTEGER,
  downloaded_at TEXT
);
CREATE TABLE IF NOT EXISTS aliases (
  alias TEXT PRIMARY KEY,
  jid TEXT NOT NULL,
  is_favorite INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS scheduled (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  payload TEXT NOT NULL,
  send_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS templates (
  name TEXT PRIMARY KEY,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS autoreply_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  match TEXT NOT NULL,
  reply TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS meta (
  key TEXT PRIMARY KEY,
  value TEXT
);
`;

export function openStore(dir: string): Store {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const dbPath = join(dir, "store.db");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(SCHEMA_V1);
  db.prepare("INSERT OR IGNORE INTO migrations (version, applied_at) VALUES (?, ?)").run(
    1,
    new Date().toISOString(),
  );
  chmodSync(dbPath, 0o600);
  return {
    db,
    close: () => {
      db.close();
    },
  };
}
