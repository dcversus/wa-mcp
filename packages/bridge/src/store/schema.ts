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

const MIGRATION_V2 = `
CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(
  content,
  chat_jid UNINDEXED,
  message_id UNINDEXED,
  timestamp UNINDEXED,
  tokenize = 'unicode61 remove_diacritics 2'
);
INSERT INTO messages_fts (content, chat_jid, message_id, timestamp)
  SELECT content, chat_jid, id, timestamp FROM messages WHERE content IS NOT NULL;
CREATE TRIGGER IF NOT EXISTS messages_fts_insert AFTER INSERT ON messages BEGIN
  INSERT INTO messages_fts (content, chat_jid, message_id, timestamp)
  VALUES (new.content, new.chat_jid, new.id, new.timestamp);
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_update AFTER UPDATE OF content ON messages BEGIN
  DELETE FROM messages_fts WHERE message_id = old.id AND chat_jid = old.chat_jid;
  INSERT INTO messages_fts (content, chat_jid, message_id, timestamp)
  VALUES (new.content, new.chat_jid, new.id, new.timestamp);
END;
CREATE TRIGGER IF NOT EXISTS messages_fts_delete AFTER DELETE ON messages BEGIN
  DELETE FROM messages_fts WHERE message_id = old.id AND chat_jid = old.chat_jid;
END;
`;

const MIGRATION_V3 = `
ALTER TABLE contacts ADD COLUMN phone TEXT;
ALTER TABLE contacts ADD COLUMN username TEXT;
`;

const MIGRATION_V4 = `
ALTER TABLE messages ADD COLUMN raw TEXT;
`;

const MIGRATION_V5 = `
CREATE TABLE IF NOT EXISTS notification_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_jid TEXT,
  from_jid TEXT,
  unread_only INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL
);
`;

const MIGRATION_V8 = `
CREATE TABLE IF NOT EXISTS group_participants (
  group_jid TEXT NOT NULL,
  jid TEXT NOT NULL,
  admin TEXT,
  PRIMARY KEY (group_jid, jid)
);
`;

const MIGRATION_V7 = `
ALTER TABLE messages ADD COLUMN deleted INTEGER NOT NULL DEFAULT 0;
`;

const MIGRATION_V6 = `
CREATE TABLE IF NOT EXISTS transcripts (
  chat_jid TEXT NOT NULL,
  message_id TEXT NOT NULL,
  engine TEXT NOT NULL,
  text TEXT NOT NULL,
  language TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (chat_jid, message_id, engine)
);
`;

const MIGRATION_V9 = `
CREATE TABLE IF NOT EXISTS reactions (
  chat_jid TEXT NOT NULL,
  message_id TEXT NOT NULL,
  emoji TEXT NOT NULL,
  sender_jid TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (chat_jid, message_id, emoji, sender_jid)
);
`;

const MIGRATION_V10 = `
ALTER TABLE chats ADD COLUMN history_synced_at TEXT;
ALTER TABLE chats ADD COLUMN ephemeral_duration INTEGER;
ALTER TABLE chats ADD COLUMN ephemeral_setting_ts TEXT;
`;

const MIGRATION_V11 = `
CREATE TABLE IF NOT EXISTS send_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  target TEXT NOT NULL,
  mode TEXT NOT NULL CHECK (mode IN ('block', 'allow')),
  expires_at TEXT
);
CREATE TABLE IF NOT EXISTS scheduled_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_jid TEXT NOT NULL,
  payload TEXT NOT NULL,
  send_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  sent_message_id TEXT
);
`;

const MIGRATION_V12 = `
ALTER TABLE messages ADD COLUMN edited INTEGER NOT NULL DEFAULT 0;
`;

const MIGRATION_V13 = `
CREATE TABLE IF NOT EXISTS labels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  color TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS chat_labels (
  chat_jid TEXT NOT NULL,
  label_id INTEGER NOT NULL REFERENCES labels(id),
  PRIMARY KEY (chat_jid, label_id)
);
ALTER TABLE chats ADD COLUMN manual_unread INTEGER NOT NULL DEFAULT 0;
`;

const MIGRATION_V14 = `
CREATE TABLE IF NOT EXISTS newsletters (
  jid TEXT PRIMARY KEY,
  followed_at TEXT NOT NULL
);
`;

const MIGRATION_V15 = `
ALTER TABLE scheduled_messages ADD COLUMN last_error TEXT;
`;

// T94-D-M3 (CODEX): the unscoped AFTER UPDATE trigger ran its unindexed FTS
// delete-scan on every row update — markChatRead's per-row UPDATE was
// O(rows x FTS size) on the event loop. Only content changes need a resync.
const MIGRATION_V16 = `
DROP TRIGGER IF EXISTS messages_fts_update;
CREATE TRIGGER messages_fts_update AFTER UPDATE OF content ON messages BEGIN
  DELETE FROM messages_fts WHERE message_id = old.id AND chat_jid = old.chat_jid;
  INSERT INTO messages_fts (content, chat_jid, message_id, timestamp)
  VALUES (new.content, new.chat_jid, new.id, new.timestamp);
END;
`;

const MIGRATION_V17 = `
ALTER TABLE scheduled_messages ADD COLUMN attempts INTEGER NOT NULL DEFAULT 0;
`;

const MIGRATION_V19 = `
CREATE TABLE IF NOT EXISTS notification_rules (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  chat_jid TEXT,
  from_jid TEXT,
  unread_only INTEGER NOT NULL DEFAULT 0,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at TEXT NOT NULL
);
ALTER TABLE notification_rules ADD COLUMN deliver TEXT NOT NULL DEFAULT '["mcp"]';
ALTER TABLE notification_rules ADD COLUMN sub_id TEXT;
`;

const MIGRATION_V18 = `
CREATE TABLE subscriptions (
  id TEXT PRIMARY KEY,
  chat_jid TEXT,
  from_jid TEXT,
  kinds TEXT NOT NULL DEFAULT '[]',
  include_media INTEGER NOT NULL DEFAULT 0,
  all_chats INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);
`;

const MIGRATION_V20 = `
CREATE TABLE IF NOT EXISTS transcripts (
  chat_jid TEXT NOT NULL,
  message_id TEXT NOT NULL,
  engine TEXT NOT NULL,
  text TEXT NOT NULL,
  language TEXT,
  created_at TEXT NOT NULL,
  PRIMARY KEY (chat_jid, message_id, engine)
);
ALTER TABLE transcripts ADD COLUMN kind TEXT NOT NULL DEFAULT 'voice';
`;

const MIGRATION_V21 = `
CREATE TABLE IF NOT EXISTS transcripts (
  chat_jid TEXT NOT NULL,
  message_id TEXT NOT NULL,
  engine TEXT NOT NULL,
  text TEXT NOT NULL,
  language TEXT,
  created_at TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'voice',
  write_seq INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (chat_jid, message_id, engine)
);
ALTER TABLE transcripts ADD COLUMN write_seq INTEGER NOT NULL DEFAULT 0;
`;

const MIGRATION_V22 = `
CREATE TABLE IF NOT EXISTS subscription_configs (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  chats TEXT NOT NULL DEFAULT '[]',
  filter TEXT NOT NULL DEFAULT '{}',
  prompt TEXT,
  delivery TEXT NOT NULL DEFAULT '{"mode":"inbox"}',
  enabled INTEGER NOT NULL DEFAULT 1,
  created TEXT NOT NULL
);
`;

const MIGRATIONS: ReadonlyArray<{ version: number; sql: string }> = [
  { version: 1, sql: SCHEMA_V1 },
  { version: 2, sql: MIGRATION_V2 },
  { version: 3, sql: MIGRATION_V3 },
  { version: 4, sql: MIGRATION_V4 },
  { version: 5, sql: MIGRATION_V5 },
  { version: 6, sql: MIGRATION_V6 },
  { version: 7, sql: MIGRATION_V7 },
  { version: 8, sql: MIGRATION_V8 },
  { version: 9, sql: MIGRATION_V9 },
  { version: 10, sql: MIGRATION_V10 },
  { version: 11, sql: MIGRATION_V11 },
  { version: 12, sql: MIGRATION_V12 },
  { version: 13, sql: MIGRATION_V13 },
  { version: 14, sql: MIGRATION_V14 },
  { version: 15, sql: MIGRATION_V15 },
  { version: 16, sql: MIGRATION_V16 },
  { version: 17, sql: MIGRATION_V17 },
  { version: 18, sql: MIGRATION_V18 },
  { version: 19, sql: MIGRATION_V19 },
  { version: 20, sql: MIGRATION_V20 },
  { version: 21, sql: MIGRATION_V21 },
  { version: 22, sql: MIGRATION_V22 },
];

/** T76 H3: each migration runs inside one transaction — a statement that
 * fails mid-script rolls back the WHOLE script (no partial schema, no
 * duplicated FTS rows on retry) and the version is never marked. */
export function applyMigrations(
  db: DatabaseSync,
  migrations: ReadonlyArray<{ version: number; sql: string }>,
): void {
  db.exec(
    "CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  const markApplied = db.prepare("INSERT INTO migrations (version, applied_at) VALUES (?, ?)");
  for (const migration of migrations) {
    const applied = db.prepare("SELECT 1 FROM migrations WHERE version = ?").get(migration.version);
    if (applied !== undefined) {
      continue;
    }
    db.exec("BEGIN");
    try {
      db.exec(migration.sql);
      markApplied.run(migration.version, new Date().toISOString());
      db.exec("COMMIT");
    } catch (err) {
      db.exec("ROLLBACK");
      throw err;
    }
  }
}

export function openStore(dir: string): Store {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
  const dbPath = join(dir, "store.db");
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode = WAL");
  db.exec("PRAGMA busy_timeout = 5000");
  db.exec(
    "CREATE TABLE IF NOT EXISTS migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)",
  );
  applyMigrations(db, MIGRATIONS);
  chmodSync(dbPath, 0o600);
  return {
    db,
    close: () => {
      db.close();
    },
  };
}

/** Run fn inside a single SQLite transaction (bulk history syncs must be
 * atomic and must not partially persist on a mid-batch failure). */
export function withTransaction<T>(store: Store, fn: () => T): T {
  store.db.exec("BEGIN");
  try {
    const result = fn();
    store.db.exec("COMMIT");
    return result;
  } catch (err) {
    store.db.exec("ROLLBACK");
    throw err;
  }
}
