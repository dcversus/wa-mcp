import { chmodSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { DatabaseSync } from "node:sqlite";
import { openStore } from "../../src/store/schema.ts";

const POSIX_PERMS = process.platform !== "win32";

const EXPECTED_TABLES = [
  "aliases",
  "autoreply_rules",
  "chats",
  "contacts",
  "events",
  "group_participants",
  "media_files",
  "messages",
  "messages_fts",
  "reactions",
  "meta",
  "migrations",
  "newsletters",
  "notification_rules",
  "poll_options",
  "poll_votes",
  "read_state",
  "scheduled",
  "scheduled_messages",
  "send_rules",
  "labels",
  "chat_labels",
  "subscriptions",
  "templates",
  "transcripts",
].sort();

const EXPECTED_MESSAGE_COLUMNS = [
  "id",
  "chat_jid",
  "sender_jid",
  "sender_name",
  "timestamp",
  "content",
  "media_type",
  "media_path",
  "quoted_message_id",
  "mentions",
  "is_from_me",
  "is_unread",
  "reactions",
  "raw",
  "deleted",
  "edited",
];

test.skipIf(!POSIX_PERMS)("openStore runs in a 0700 directory with a 0600 database file", () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-store-"));
  chmodSync(dir, 0o777);
  const store = openStore(dir);
  try {
    expect(statSync(dir).mode & 0o777).toBe(0o700);
    expect(statSync(join(dir, "store.db")).mode & 0o777).toBe(0o600);
  } finally {
    store.close();
  }
});

test("schema v1 creates exactly the expected tables", () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-store-")));
  try {
    const tables = store.db
      .prepare("PRAGMA table_list")
      .all()
      .map((row) => String((row as { name: string }).name))
      .filter((name) => !name.startsWith("sqlite_"))
      .filter((name) => !name.startsWith("messages_fts_"))
      .sort();
    expect(tables).toEqual(EXPECTED_TABLES);
  } finally {
    store.close();
  }
});

test("messages table matches the GOAL column contract exactly", () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-store-")));
  try {
    const columns = store.db
      .prepare("PRAGMA table_info(messages)")
      .all()
      .map((row) => String((row as { name: string }).name));
    expect(columns).toEqual(EXPECTED_MESSAGE_COLUMNS);
  } finally {
    store.close();
  }
});

test("chats and meta tables have pinned columns", () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-store-")));
  try {
    const names = (table: string) =>
      store.db
        .prepare(`PRAGMA table_info(${table})`)
        .all()
        .map((row) => String((row as { name: string }).name));
    expect(names("chats")).toEqual([
      "jid",
      "name",
      "archived",
      "pinned",
      "muted_until",
      "ephemeral",
      "ephemeral_expiry",
      "last_message_text",
      "last_message_ts",
      "history_synced_at",
      "ephemeral_duration",
      "ephemeral_setting_ts",
      "manual_unread",
    ]);
    expect(names("meta")).toEqual(["key", "value"]);
  } finally {
    store.close();
  }
});

test("WAL mode and busy_timeout are configured", () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-store-")));
  try {
    expect(store.db.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    expect(store.db.prepare("PRAGMA busy_timeout").get()).toEqual({ timeout: 5000 });
  } finally {
    store.close();
  }
});

test("migrations records schema versions 1 through 3", () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-store-")));
  try {
    const rows = store.db
      .prepare("SELECT version, applied_at FROM migrations ORDER BY version")
      .all();
    expect(rows.map((row) => (row as { version: number }).version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20,
    ]);
    expect(typeof (rows[0] as { applied_at: string }).applied_at).toBe("string");
  } finally {
    store.close();
  }
});

test("reopening the store is idempotent", () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-store-"));
  const first = openStore(dir);
  first.close();
  const second = openStore(dir);
  try {
    const versions = second.db.prepare("SELECT version FROM migrations").all();
    expect(versions).toHaveLength(20);
  } finally {
    second.close();
  }
});

describe("T62 deleted tombstone migration (v7)", () => {
  test("a fresh store has the deleted column and migration v7 applied", () => {
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-v7-fresh-")));
    try {
      const columns = store.db.prepare("PRAGMA table_info(messages)").all() as Array<{
        name: string;
      }>;
      expect(columns.some((column) => column.name === "deleted")).toBe(true);
      const applied = store.db.prepare("SELECT 1 FROM migrations WHERE version = 7").get();
      expect(applied).toBeDefined();
    } finally {
      store.close();
    }
  });

  test("a pre-v7 store is upgraded on open", () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-mcp-v7-upgrade-"));
    const dbPath = join(dir, "store.db");
    const raw = new DatabaseSync(dbPath);
    raw.exec("CREATE TABLE migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    for (const version of [1, 2, 3, 4, 5, 6]) {
      raw
        .prepare("INSERT INTO migrations (version, applied_at) VALUES (?, ?)")
        .run(version, "2026-01-01");
    }
    raw.exec(
      "CREATE TABLE messages (id TEXT NOT NULL, chat_jid TEXT NOT NULL, sender_jid TEXT, sender_name TEXT, timestamp TEXT NOT NULL, content TEXT, media_type TEXT, media_path TEXT, quoted_message_id TEXT, mentions TEXT, is_from_me INTEGER NOT NULL DEFAULT 0, is_unread INTEGER NOT NULL DEFAULT 1, reactions TEXT, raw TEXT, PRIMARY KEY (chat_jid, id))",
    );
    // v1 always creates chats — v10's ALTER TABLE needs it present
    raw.exec("CREATE TABLE chats (jid TEXT PRIMARY KEY, name TEXT)");
    raw.close();
    const store = openStore(dir);
    try {
      const columns = store.db.prepare("PRAGMA table_info(messages)").all() as Array<{
        name: string;
      }>;
      expect(columns.some((column) => column.name === "deleted")).toBe(true);
    } finally {
      store.close();
    }
  });
});

describe("T62/I group participants table (v8)", () => {
  test("a fresh store creates group_participants with migration v8 applied", () => {
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-v8-fresh-")));
    try {
      const table = store.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='group_participants'")
        .get();
      expect(table).toBeDefined();
      const applied = store.db.prepare("SELECT 1 FROM migrations WHERE version = 8").get();
      expect(applied).toBeDefined();
    } finally {
      store.close();
    }
  });

  test("a pre-v8 store gains the table on open", () => {
    const dir = mkdtempSync(join(tmpdir(), "wa-mcp-v8-upgrade-"));
    const raw = new DatabaseSync(join(dir, "store.db"));
    raw.exec("CREATE TABLE migrations (version INTEGER PRIMARY KEY, applied_at TEXT NOT NULL)");
    for (const version of [1, 2, 3, 4, 5, 6, 7]) {
      raw
        .prepare("INSERT INTO migrations (version, applied_at) VALUES (?, ?)")
        .run(version, "2026-01-01");
    }
    // v1 chats table (v10 ALTERs it) + messages (v12 ALTERs it)
    raw.exec("CREATE TABLE chats (jid TEXT PRIMARY KEY, name TEXT)");
    raw.exec(
      "CREATE TABLE messages (id TEXT NOT NULL, chat_jid TEXT NOT NULL, PRIMARY KEY (chat_jid, id))",
    );
    raw.close();
    const store = openStore(dir);
    try {
      const table = store.db
        .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name='group_participants'")
        .get();
      expect(table).toBeDefined();
    } finally {
      store.close();
    }
  });
});

test("T94-D-M3 — the FTS update trigger fires only on content changes", () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-fts-m3-")));
  try {
    const triggers = store.db
      .prepare(
        "SELECT name, sql FROM sqlite_master WHERE type = 'trigger' AND name LIKE 'messages_fts%'",
      )
      .all() as Array<{ name: string; sql: string }>;
    const update = triggers.find((trigger) => trigger.name === "messages_fts_update");
    expect(update).toBeDefined();
    // CODEX M3: the unscoped AFTER UPDATE trigger ran its unindexed FTS
    // delete-scan on EVERY row update — markChatRead's per-row UPDATE was
    // O(rows x FTS size) on the event loop
    expect(update?.sql).toContain("AFTER UPDATE OF content");
  } finally {
    store.close();
  }
});
