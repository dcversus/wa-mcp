import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { expect, test } from "vite-plus/test";
import { openStore, type Store } from "../../src/store/schema.ts";
import {
  advanceVoiceCursor,
  DICTATION_PCM_ARGS,
  nextVoiceNote,
  toDictationPcm,
} from "../../src/media/dictation.ts";

function fakeSpawn(bytes: Buffer, exitCode = 0) {
  const calls: Array<{ file: string; args: string[] }> = [];
  const spawn = ((file: string, args: string[]) => {
    calls.push({ file, args });
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
      stdin: { end(chunk?: Buffer): void; on(event: string, cb: () => void): void };
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { end: () => undefined, on: () => undefined };
    queueMicrotask(() => {
      proc.stdout.emit("data", bytes);
      proc.emit("close", exitCode);
    });
    return proc;
  }) as unknown as typeof import("node:child_process").spawn;
  return { spawn, calls };
}

const PCM = Buffer.from([1, 0, 2, 0, 3, 0]);

test("R2-14 — toDictationPcm converts to raw s16le 16k mono via ffmpeg", async () => {
  const { spawn, calls } = fakeSpawn(PCM);
  const out = await toDictationPcm(Buffer.from("OggS"), "audio/ogg", { spawnFn: spawn });
  expect(out).toEqual(PCM);
  expect(calls[0]?.file).toBe("ffmpeg");
  expect(calls[0]?.args).toEqual(DICTATION_PCM_ARGS);
  expect(DICTATION_PCM_ARGS).toContain("-ar");
  expect(DICTATION_PCM_ARGS).toContain("16000");
  expect(DICTATION_PCM_ARGS).toContain("s16le");
});

test("R2-14 — missing ffmpeg is a structured ENGINE_UNAVAILABLE naming the install", async () => {
  const { spawn } = fakeSpawn(PCM, 127);
  await expect(
    toDictationPcm(Buffer.from("OggS"), "audio/ogg", { spawnFn: spawn }),
  ).rejects.toMatchObject({
    code: "ENGINE_UNAVAILABLE",
    message: expect.stringContaining("ffmpeg"),
  });
});

function seededStore(): Store {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-dictation-"));
  const store = openStore(dir);
  const insert = store.db.prepare(
    "INSERT INTO messages (id, chat_jid, sender_name, timestamp, content, media_type, media_path, is_from_me) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
  );
  insert.run(
    "M1",
    "chat@s.whatsapp.net",
    "Alice",
    "2026-10-25T01:00:00+02:00",
    null,
    "audio",
    join(dir, "m1.ogg"),
    0,
  );
  insert.run(
    "M2",
    "chat@s.whatsapp.net",
    "Alice",
    "2026-10-25T01:01:00+02:00",
    null,
    "text",
    null,
    0,
  );
  insert.run(
    "M3",
    "chat@s.whatsapp.net",
    "Bob",
    "2026-10-25T01:02:00+02:00",
    null,
    "audio",
    join(dir, "m3.ogg"),
    0,
  );
  insert.run(
    "M4",
    "chat@s.whatsapp.net",
    "Me",
    "2026-10-25T01:03:00+02:00",
    null,
    "audio",
    join(dir, "m4.ogg"),
    1,
  );
  insert.run(
    "M5",
    "chat@s.whatsapp.net",
    "Bob",
    "2026-10-25T01:04:00+02:00",
    null,
    "image",
    join(dir, "m5.jpg"),
    0,
  );
  insert.run(
    "M6",
    "chat@s.whatsapp.net",
    "Bob",
    "2026-10-25T01:05:00+02:00",
    null,
    "audio",
    null,
    0,
  );
  insert.run(
    "M7",
    "chat@s.whatsapp.net",
    "Bob",
    "2026-10-25T01:06:00+02:00",
    null,
    "video",
    join(dir, "m7.mp4"),
    0,
  );
  return store;
}

test("R2-14 — nextVoiceNote serves inbound audio/video FIFO, skipping non-voice rows", () => {
  const store = seededStore();
  const first = nextVoiceNote(store);
  expect(first?.id).toBe("M1");
  advanceVoiceCursor(store, first?.rowid ?? 0);
  const second = nextVoiceNote(store);
  expect(second?.id).toBe("M3");
  advanceVoiceCursor(store, second?.rowid ?? 0);
  const third = nextVoiceNote(store);
  expect(third?.id).toBe("M7");
  expect(third?.mediaPath).toContain("m7.mp4");
  expect(third?.senderName).toBe("Bob");
  expect(third?.chatJid).toBe("chat@s.whatsapp.net");
  advanceVoiceCursor(store, third?.rowid ?? 0);
  expect(nextVoiceNote(store)).toBeNull();
});

test("R2-14 — the cursor persists in meta across calls", () => {
  const store = seededStore();
  const first = nextVoiceNote(store);
  advanceVoiceCursor(store, first?.rowid ?? 0);
  const row = store.db
    .prepare("SELECT value FROM meta WHERE key = 'voice_dictation_cursor'")
    .get() as { value: string } | undefined;
  expect(row?.value).toBe(String(first?.rowid));
  expect(nextVoiceNote(store)?.id).toBe("M3");
});

test("R2-14 — advanceVoiceCursor never moves backwards", () => {
  const store = seededStore();
  const first = nextVoiceNote(store);
  advanceVoiceCursor(store, first?.rowid ?? 0);
  advanceVoiceCursor(store, 1);
  expect(nextVoiceNote(store)?.id).toBe("M3");
});
