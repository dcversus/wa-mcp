import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openStore } from "../../src/store/schema.ts";
import { listMessages } from "../../src/store/queries.ts";
import { saveTranscript } from "../../src/media/transcribe.ts";

function makeStore() {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-t122-"));
  const store = openStore(dir);
  store.db
    .prepare(
      "INSERT INTO messages (id, chat_jid, sender_jid, timestamp, content) VALUES (?, ?, ?, ?, ?)",
    )
    .run("m1", "chat1@g.us", "u1@s.whatsapp.net", "2026-10-05T10:00:00Z", "hello");
  store.db
    .prepare(
      "INSERT INTO messages (id, chat_jid, sender_jid, timestamp, content) VALUES (?, ?, ?, ?, ?)",
    )
    .run("m2", "chat1@g.us", "u1@s.whatsapp.net", "2026-10-05T10:01:00Z", "world");
  return { store, dir };
}

test("V20 migration adds transcripts.kind with default 'voice'", () => {
  const { store, dir } = makeStore();
  try {
    const columns = store.db.prepare("PRAGMA table_info(transcripts)").all() as Array<{
      name: string;
      dflt_value: string | null;
    }>;
    const kind = columns.find((column) => column.name === "kind");
    expect(kind).toBeDefined();
    expect(kind?.dflt_value).toBe("'voice'");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listMessages surfaces saved transcripts", () => {
  const { store, dir } = makeStore();
  try {
    saveTranscript(store, "chat1@g.us", "m1", "mock", "transcribed text", "en");
    const rows = listMessages(store, { chatJid: "chat1@g.us", limit: 10 });
    const m1 = rows.find((row) => row.id === "m1");
    expect(m1?.transcript).toBeDefined();
    const transcript = m1?.transcript as { text: string; engine: string; kind: string };
    expect(transcript.text).toBe("transcribed text");
    expect(transcript.engine).toBe("mock");
    expect(transcript.kind).toBe("voice");
    const m2 = rows.find((row) => row.id === "m2");
    expect(m2?.transcript === null || m2?.transcript === undefined).toBe(true);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("listMessages surfaces the LATEST transcript when engines disagree", () => {
  const { store, dir } = makeStore();
  try {
    saveTranscript(store, "chat1@g.us", "m1", "mock", "stale mock text", undefined);
    saveTranscript(store, "chat1@g.us", "m1", "openai", "fresh real text", undefined);
    const rows = listMessages(store, { chatJid: "chat1@g.us", limit: 10 });
    const m1 = rows.find((row) => row.id === "m1");
    expect(m1?.transcript?.text).toBe("fresh real text");
    expect(m1?.transcript?.engine).toBe("openai");
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
