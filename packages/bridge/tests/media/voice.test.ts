import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { describe, expect, test } from "vite-plus/test";
import { toVoiceOgg } from "../../src/media/voice.ts";

/** spawn stub: records args, emits ogg bytes, exits 0 */
function fakeSpawn(bytes: Buffer, exitCode = 0) {
  const calls: Array<{ file: string; args: string[] }> = [];
  const spawn = ((file: string, args: string[]) => {
    calls.push({ file, args });
    const proc = new EventEmitter() as EventEmitter & {
      stdout: EventEmitter;
      stderr: EventEmitter;
    };
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    queueMicrotask(() => {
      proc.stdout.emit("data", bytes);
      proc.emit("close", exitCode);
    });
    return proc;
  }) as unknown as typeof import("node:child_process").spawn;
  return { spawn: spawn as typeof spawn, calls };
}

const OGG = Buffer.from("OggS0000");

test("T81 line72 — file input converts via ffmpeg to ogg/opus PTT args", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-voice-"));
  const mp3 = join(dir, "clip.mp3");
  writeFileSync(mp3, "fake-mp3");
  const { spawn, calls } = fakeSpawn(OGG);
  const out = await toVoiceOgg({ path: mp3 }, { spawnFn: spawn });
  expect(out).toEqual(OGG);
  const call = calls[0];
  expect(call?.file).toBe("ffmpeg");
  expect(call?.args).toEqual([
    "-i",
    mp3,
    "-c:a",
    "libopus",
    "-b:a",
    "32k",
    "-ar",
    "48000",
    "-f",
    "ogg",
    "pipe:1",
  ]);
});

test("T81 line72 — ffmpeg absence is a structured FFMPEG_UNAVAILABLE", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-voice-"));
  const mp3 = join(dir, "clip.mp3");
  writeFileSync(mp3, "fake-mp3");
  const { spawn } = fakeSpawn(OGG, 127);
  await expect(toVoiceOgg({ path: mp3 }, { spawnFn: spawn })).rejects.toHaveProperty(
    "code",
    "FFMPEG_UNAVAILABLE",
  );
});

test("T81 line72 — url input is SSRF-guarded, fetched to a temp file, cleaned up", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-voice-"));
  const { spawn, calls } = fakeSpawn(OGG);
  const written: string[] = [];
  const realWrite = writeFileSync;
  const opts = {
    spawnFn: spawn,
    fetchFn: (async () =>
      new Response(Buffer.from("remote-audio"), { status: 200 })) as typeof fetch,
    lookupFn: async () => [{ address: "93.184.216.34", family: 4 }],
    tmpDir: dir,
    onTempWrite: (path: string) => written.push(path),
  };
  const out = await toVoiceOgg({ url: "https://cdn.example/voice.mp3" }, opts);
  expect(out).toEqual(OGG);
  expect(calls[0]?.args[0]).toBe("-i");
  expect(String(calls[0]?.args[1])).toMatch(/\.mp3$/);
  // temp cleanup: the fetched file is gone after conversion
  for (const path of written) {
    expect(existsSync(path)).toBe(false);
  }
  void realWrite;
});

test("T81 line72 — private-IP url is refused BEFORE any fetch", async () => {
  const { spawn, calls } = fakeSpawn(OGG);
  await expect(
    toVoiceOgg(
      { url: "http://169.254.169.254/latest" },
      {
        spawnFn: spawn,
        lookupFn: async () => [{ address: "169.254.169.254", family: 4 }],
        tmpDir: tmpdir(),
      },
    ),
  ).rejects.toHaveProperty("code", "SSRF_BLOCKED");
  expect(calls).toHaveLength(0);
});

import { OpenAITranscriptionEngine, normalizeAudioName } from "../../src/media/transcribe.ts";

describe("T90 line143 — OpenAI-compatible transcription engine", () => {
  test("posts the audio to the configured base URL with the key", async () => {
    const calls: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      calls.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ text: "hello from openai" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const engine = new OpenAITranscriptionEngine({
      baseUrl: "https://api.example/v1",
      apiKey: "sk-test",
      fetchFn,
    });
    const result = await engine.transcribe(Buffer.from("ogg-bytes"), "audio/ogg");
    expect(result.text).toBe("hello from openai");
    const call = calls[0];
    expect(call?.url).toBe("https://api.example/v1/audio/transcriptions");
    const headers = call?.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer sk-test");
    const form = call?.init.body as FormData;
    expect(form).toBeInstanceOf(FormData);
    expect((form.get("file") as File).name).toBe("audio.ogg");
  });

  test("missing baseUrl or key is a structured CONFIG error", () => {
    expect(() => new OpenAITranscriptionEngine({ baseUrl: "", apiKey: "" })).toThrow(
      /WA_OPENAI_BASE_URL/,
    );
  });
});

describe("T90 line147 — per-engine input normalization", () => {
  test(".oga and .webm normalize to .ogg", () => {
    expect(normalizeAudioName("voice.oga")).toBe("voice.ogg");
    expect(normalizeAudioName("voice.webm")).toBe("voice.ogg");
    expect(normalizeAudioName("voice.mp3")).toBe("voice.mp3");
    expect(normalizeAudioName("noext")).toBe("noext.ogg");
  });

  test("the engine transcribe call receives the normalized name", async () => {
    const names: string[] = [];
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      const form = init?.body as FormData;
      names.push((form.get("file") as File).name);
      return new Response(JSON.stringify({ text: "ok" }), { status: 200 });
    }) as unknown as typeof fetch;
    const engine = new OpenAITranscriptionEngine({
      baseUrl: "https://api.example/v1",
      apiKey: "k",
      fetchFn,
    });
    await engine.transcribe(Buffer.from("x"), "audio/ogg", "voice.oga");
    expect(names[0]).toBe("voice.ogg");
  });
});
