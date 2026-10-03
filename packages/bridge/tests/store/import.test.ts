import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openStore } from "../../src/store/schema.ts";
import { importLayout } from "../../src/store/import.ts";

const ROOT = join(__dirname, "..", "..", "..", "..");
const LHARRIES = join(ROOT, "scripts", "fixtures", "lharries-store");
const GOFORK = join(ROOT, "scripts", "fixtures", "gofork-store");

test("T83 — lharries fixture imports chats + messages", () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-imp-lh-")));
  try {
    const report = importLayout(store, "lharries", LHARRIES, { dryRun: false });
    expect(report.chats).toBe(2);
    expect(report.messages).toBe(5);
    const row = store.db
      .prepare("SELECT sender_jid, content FROM messages WHERE id = 'LH-1'")
      .get() as { sender_jid: string | null; content: string };
    expect(row.content).toBe("hello from lharries");
    const chat = store.db
      .prepare("SELECT name FROM chats WHERE jid = '120363428874442773@g.us'")
      .get() as { name: string };
    expect(chat.name).toBe("Test Group");
  } finally {
    store.close();
  }
});

test("T83 — gofork fixture maps epoch seconds + from_me", () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-imp-gf-")));
  try {
    const report = importLayout(store, "gofork", GOFORK, { dryRun: false });
    expect(report.chats).toBe(2);
    expect(report.messages).toBe(5);
    const row = store.db
      .prepare("SELECT sender_jid, is_from_me, content, timestamp FROM messages WHERE id = 'GF-2'")
      .get() as { sender_jid: string; is_from_me: number; content: string; timestamp: string };
    expect(row.is_from_me).toBe(1);
    expect(row.content).toBe("gofork reply");
    // epoch seconds -> ISO timestamp
    expect(row.timestamp).toBe(new Date(1767228300 * 1000).toISOString());
  } finally {
    store.close();
  }
});

test("T83 — dry-run reports without writing", () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-imp-dry-")));
  try {
    const report = importLayout(store, "lharries", LHARRIES, { dryRun: true });
    expect(report.chats).toBe(2);
    expect(report.messages).toBe(5);
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM messages").get()).toEqual({ n: 0 });
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM chats").get()).toEqual({ n: 0 });
  } finally {
    store.close();
  }
});
