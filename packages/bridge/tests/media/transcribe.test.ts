import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { createTranscriptionEngine, saveTranscript, getTranscript } from "../../src/media/transcribe.ts";
import { MockTtsEngine } from "../../src/media/tts.ts";
import { openStore, type Store } from "../../src/store/schema.ts";

function makeStore(): Store {
  return openStore(mkdtempSync(join(tmpdir(), "wa-mcp-transcribe-")));
}

test("the mock engine returns deterministic hash-based text", async () => {
  const engine = createTranscriptionEngine("mock");
  const first = await engine.transcribe(Buffer.from("oggdata-1"), "audio/ogg");
  const second = await engine.transcribe(Buffer.from("oggdata-1"), "audio/ogg");
  const other = await engine.transcribe(Buffer.from("oggdata-2"), "audio/ogg");
  expect(first.text).toBe(second.text);
  expect(first.text).not.toBe(other.text);
  expect(first.text).toContain("mock");
  expect(first.language).toBeUndefined();
});

test("the factory rejects unknown engine names with the supported list", () => {
  expect(() => createTranscriptionEngine("elevenlabs")).toThrowError(/mock/);
  expect(() => createTranscriptionEngine("mock")).not.toThrow();
});

test("transcripts persist per engine and round-trip", () => {
  const store = makeStore();
  try {
    saveTranscript(store, "g@g.us", "M1", "mock", "hello transcript", "en");
    expect(getTranscript(store, "g@g.us", "M1", "mock")).toEqual({
      text: "hello transcript",
      language: "en",
    });
    expect(getTranscript(store, "g@g.us", "M1", "other-engine")).toBeNull();
    saveTranscript(store, "g@g.us", "M1", "mock", "updated transcript");
    expect(getTranscript(store, "g@g.us", "M1", "mock")?.text).toBe("updated transcript");
  } finally {
    store.close();
  }
});

test("the mock tts engine returns a deterministic ogg buffer", async () => {
  const engine = new MockTtsEngine();
  const first = await engine.synthesize("hello there");
  const second = await engine.synthesize("hello there");
  expect(first.mime).toBe("audio/ogg");
  expect(first.buffer.equals(second.buffer)).toBe(true);
  expect(first.buffer.length).toBeGreaterThan(16);
  expect(first.buffer.subarray(0, 4).equals(Buffer.from("OggS"))).toBe(true);
  const other = await engine.synthesize("different");
  expect(first.buffer.equals(other.buffer)).toBe(false);
});
