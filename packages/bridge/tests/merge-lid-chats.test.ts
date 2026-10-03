import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { storeMessage } from "../src/store/messages.ts";
import { mergeLidChats, readReverseMapping } from "../src/store/merge-lid-chats.ts";
import { openStore, type Store } from "../src/store/schema.ts";
import type { WAMessage } from "baileys";

function seed(store: Store, chatJid: string, id: string, text: string, ts: string): void {
  storeMessage(store, {
    key: { remoteJid: chatJid, fromMe: false, id },
    message: { conversation: text },
    messageTimestamp: Math.floor(new Date(ts).getTime() / 1000),
    pushName: "V",
  } as unknown as WAMessage);
}

test("readReverseMapping reads the engine's reverse file and rejects junk", () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-lidmap-"));
  writeFileSync(
    join(dir, "lid-mapping-55600000009854_reverse.json"),
    JSON.stringify("351930017568"),
  );
  writeFileSync(join(dir, "lid-mapping-1_reverse.json"), '"not a jid"');
  expect(readReverseMapping(dir, "55600000009854")).toBe("351930017568");
  expect(readReverseMapping(dir, "1")).toBeNull();
  expect(readReverseMapping(dir, "999")).toBeNull();
});

test("mergeLidChats moves messages, read_state and metadata into the PN chat and deletes the LID chat", () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-merge-")));
  const authDir = mkdtempSync(join(tmpdir(), "wa-mcp-lidmap-"));
  writeFileSync(
    join(authDir, "lid-mapping-55600000009854_reverse.json"),
    JSON.stringify("351930017568"),
  );

  seed(store, "351930017568@s.whatsapp.net", "pn1", "outbound to pn", "2026-10-02T10:00:00.000Z");
  seed(store, "55600000009854@lid", "lid1", "reply via lid", "2026-10-02T11:00:00.000Z");
  seed(store, "55600000009854@lid", "lid2", "another lid row", "2026-10-02T12:00:00.000Z");
  store.db
    .prepare("UPDATE chats SET name = ?, last_message_text = ?, last_message_ts = ? WHERE jid = ?")
    .run("Vasilisa (lid)", "another lid row", "2026-10-02T12:00:00.000Z", "55600000009854@lid");
  store.db
    .prepare("INSERT INTO read_state (chat_jid, unread_count, updated_at) VALUES (?, ?, ?)")
    .run("55600000009854@lid", 2, "2026-10-02T12:00:00.000Z");

  const result = mergeLidChats(store, authDir);

  expect(result.mergedChats).toBe(1);
  expect(result.movedMessages).toBe(2);
  const pnRows = store.db
    .prepare("SELECT id, content FROM messages WHERE chat_jid = ?")
    .all("351930017568@s.whatsapp.net") as Array<{ id: string; content: string }>;
  expect(pnRows.map((row) => row.id).sort()).toEqual(["lid1", "lid2", "pn1"]);
  const lidRows = store.db
    .prepare("SELECT COUNT(*) AS n FROM messages WHERE chat_jid = ?")
    .get("55600000009854@lid") as { n: number };
  expect(lidRows.n).toBe(0);
  const lidChat = store.db
    .prepare("SELECT COUNT(*) AS n FROM chats WHERE jid = ?")
    .get("55600000009854@lid") as { n: number };
  expect(lidChat.n).toBe(0);
  const pnChat = store.db
    .prepare("SELECT name, last_message_ts FROM chats WHERE jid = ?")
    .get("351930017568@s.whatsapp.net") as { name: string | null; last_message_ts: string };
  expect(pnChat.name).toBe("Vasilisa (lid)");
  expect(pnChat.last_message_ts.startsWith("2026-10-02T12")).toBe(true);
  const read = store.db
    .prepare("SELECT unread_count FROM read_state WHERE chat_jid = ?")
    .get("351930017568@s.whatsapp.net") as { unread_count: number };
  expect(read.unread_count).toBe(2);
});

test("LID chats without a reverse mapping are left untouched", () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-merge2-")));
  const authDir = mkdtempSync(join(tmpdir(), "wa-mcp-lidmap2-"));
  seed(store, "55600000009854@lid", "orphan", "no mapping", "2026-10-02T10:00:00.000Z");
  const result = mergeLidChats(store, authDir);
  expect(result.mergedChats).toBe(0);
  const rows = store.db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number };
  expect(rows.n).toBe(1);
});

test("duplicate message ids across chats keep the original row", () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-merge3-")));
  const authDir = mkdtempSync(join(tmpdir(), "wa-mcp-lidmap3-"));
  writeFileSync(
    join(authDir, "lid-mapping-55600000009854_reverse.json"),
    JSON.stringify("351930017568"),
  );
  seed(
    store,
    "351930017568@s.whatsapp.net",
    "same-id",
    "ORIGINAL PN ROW",
    "2026-10-02T09:00:00.000Z",
  );
  seed(store, "55600000009854@lid", "same-id", "LID DUPLICATE", "2026-10-02T09:00:00.000Z");
  const result = mergeLidChats(store, authDir);
  expect(result.movedMessages).toBe(0);
  expect(result.skippedMessages).toBe(1);
  const rows = store.db
    .prepare("SELECT content FROM messages WHERE chat_jid = ? AND id = ?")
    .all("351930017568@s.whatsapp.net", "same-id") as Array<{ content: string }>;
  expect(rows.length).toBe(1);
  expect(rows[0]?.content).toBe("ORIGINAL PN ROW");
});
