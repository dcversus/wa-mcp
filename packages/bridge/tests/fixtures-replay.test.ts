import { existsSync, mkdtempSync, readdirSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { storeMessage } from "../src/store/messages.ts";
import { openStore } from "../src/store/schema.ts";
import type { WAMessage } from "baileys";

const FIXTURE_DIR = join(
  import.meta.dirname ?? ".",
  "..",
  "..",
  "..",
  "scripts",
  "fixtures",
  "engine-events",
);

test(
  "T102 replay — recorded engine events re-drive the ingest pipeline",
  { timeout: 30_000 },
  async () => {
    if (!existsSync(FIXTURE_DIR)) {
      console.log("[SKIP] no engine-event fixture dir:", FIXTURE_DIR);
      return;
    }
    const files = readdirSync(FIXTURE_DIR).filter((f) => f.endsWith(".jsonl"));
    if (files.length === 0) {
      console.log("[SKIP] no recorded fixtures in:", FIXTURE_DIR);
      return;
    }
    const upserts: WAMessage[] = [];
    for (const file of files) {
      if (!file.includes("messages.upsert")) {
        continue;
      }
      for (const line of readFileSync(join(FIXTURE_DIR, file), "utf8").split("\n")) {
        if (line.trim().length === 0) {
          continue;
        }
        const payload = JSON.parse(line) as { messages?: WAMessage[] };
        for (const message of payload.messages ?? []) {
          if (message.key?.id !== undefined) {
            upserts.push(message);
          }
        }
      }
    }
    console.log(
      `[REPLAY] ${upserts.length} messages.upsert payloads from ${files.length} fixture files`,
    );
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-replay-")));
    let stored = 0;
    for (const message of upserts.slice(0, 200)) {
      if (storeMessage(store, message)) {
        stored += 1;
      }
    }
    const rows = store.db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number };
    console.log(`[REPLAY] stored ${stored} rows (table count ${rows.n})`);
    expect(rows.n).toBeGreaterThan(0);
    store.close();
  },
);
