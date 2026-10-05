import { expect, test } from "vite-plus/test";
import {
  createTranscriptionEngine,
  OpenAITranscriptionEngine,
} from "../../src/media/transcribe.ts";
import { MediaError } from "../../src/media/resolve.ts";

test("openai engine without a key throws MediaError ENGINE_NOT_CONFIGURED with setup text", () => {
  try {
    new OpenAITranscriptionEngine({ baseUrl: "", apiKey: "", fetchFn: undefined });
    expect.unreachable("constructor should throw");
  } catch (err) {
    expect(err).toBeInstanceOf(MediaError);
    const mediaErr = err as MediaError;
    expect(mediaErr.code).toBe("ENGINE_NOT_CONFIGURED");
    expect(mediaErr.message).toContain("WA_OPENAI_API_KEY");
  }
});

test("createTranscriptionEngine('openai') with no key surfaces ENGINE_NOT_CONFIGURED", () => {
  const prevKey = process.env.WA_OPENAI_API_KEY;
  const prevUrl = process.env.WA_OPENAI_BASE_URL;
  delete process.env.WA_OPENAI_API_KEY;
  delete process.env.WA_OPENAI_BASE_URL;
  try {
    expect(() => createTranscriptionEngine("openai")).toThrowError(MediaError);
    try {
      createTranscriptionEngine("openai");
    } catch (err) {
      expect((err as MediaError).code).toBe("ENGINE_NOT_CONFIGURED");
    }
  } finally {
    if (prevKey !== undefined) {
      process.env.WA_OPENAI_API_KEY = prevKey;
    }
    if (prevUrl !== undefined) {
      process.env.WA_OPENAI_BASE_URL = prevUrl;
    }
  }
});

test("supported engines list includes whisper-local", async () => {
  const mod = await import("../../src/media/transcribe.ts");
  const engines: unknown = (mod as Record<string, unknown>).SUPPORTED_TRANSCRIPTION_ENGINES;
  expect(Array.isArray(engines)).toBe(true);
  expect((engines as string[]).includes("whisper-local")).toBe(true);
});

test("openai engine factory with key set does not throw", () => {
  const prevKey = process.env.WA_OPENAI_API_KEY;
  process.env.WA_OPENAI_API_KEY = "sk-test-x";
  try {
    const engine = createTranscriptionEngine("openai");
    expect(typeof engine.transcribe).toBe("function");
  } finally {
    if (prevKey === undefined) {
      delete process.env.WA_OPENAI_API_KEY;
    } else {
      process.env.WA_OPENAI_API_KEY = prevKey;
    }
  }
});
