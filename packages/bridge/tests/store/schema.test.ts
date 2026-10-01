import { chmodSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openStore } from "../../src/store/schema.ts";

const EXPECTED_TABLES = [
  "aliases",
  "autoreply_rules",
  "chats",
  "contacts",
  "events",
  "media_files",
  "messages",
  "meta",
  "migrations",
  "poll_options",
  "poll_votes",
  "read_state",
  "scheduled",
  "templates",
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
];

test("openStore runs in a 0700 directory with a 0600 database file", () => {
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

test("migrations records schema versions 1 and 2", () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-store-")));
  try {
    const rows = store.db.prepare("SELECT version, applied_at FROM migrations ORDER BY version").all();
    expect(rows.map((row) => (row as { version: number }).version)).toEqual([1, 2]);
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
    expect(versions).toHaveLength(2);
  } finally {
    second.close();
  }
});
