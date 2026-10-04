import { mkdtempSync, readFileSync, existsSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { createEventRecorder } from "../../src/ingest/event-recorder.ts";

test("recorder never persists creds.update payloads", () => {
  const dir = mkdtempSync(join(tmpdir(), "rec-"));
  try {
    const recorder = createEventRecorder(dir);
    recorder.record("creds.update", { pairingEphemeralKeyPair: { private: { 0: 1 } } });
    recorder.record("messages.upsert", { messages: [{ key: { id: "X" } }] });
    expect(existsSync(join(dir, "creds.update.jsonl"))).toBe(false);
    expect(existsSync(join(dir, "messages.upsert.jsonl"))).toBe(true);
    const upsert = JSON.parse(readFileSync(join(dir, "messages.upsert.jsonl"), "utf8"));
    expect(upsert.messages[0].key.id).toBe("X");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
