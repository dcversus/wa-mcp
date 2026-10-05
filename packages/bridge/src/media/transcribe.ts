import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { MediaError } from "./resolve.ts";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { Store } from "../store/schema.ts";

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
}

export interface TranscriptionEngine {
  transcribe(buffer: Buffer, mime: string, fileName?: string): Promise<TranscriptionResult>;
}

export class MockTranscriptionEngine implements TranscriptionEngine {
  async transcribe(buffer: Buffer, _mime: string): Promise<TranscriptionResult> {
    const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 12);
    const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];
    const text = `mock transcript ${hash}: ${words[parseInt(hash.slice(0, 2), 16) % words.length]}`;
    return { text };
  }
}

export const SUPPORTED_TRANSCRIPTION_ENGINES = ["mock", "openai", "mlx", "whisper-local"] as const;

export interface TranscribeCallOptions {
  fileName?: string;
}

/** T90 line147: engines upload under a filename — map WhatsApp's OGG
 * variants to the extension the engine expects. */
export function normalizeAudioName(name: string): string {
  if (/\.(oga|webm)$/i.test(name)) {
    return name.replace(/\.(oga|webm)$/i, ".ogg");
  }
  if (!/\.[a-z0-9]+$/i.test(name)) {
    return `${name}.ogg`;
  }
  return name;
}

/** T90 line143: any OpenAI-compatible /audio/transcriptions endpoint. */
export class OpenAITranscriptionEngine implements TranscriptionEngine {
  constructor(
    private readonly config: {
      baseUrl: string;
      apiKey: string;
      fetchFn?: typeof fetch;
      model?: string;
    },
  ) {
    if (config.apiKey.length === 0) {
      throw new MediaError(
        "ENGINE_NOT_CONFIGURED",
        "openai transcription needs an API key — set WA_OPENAI_API_KEY (or config transcription.api_key) to use this engine",
      );
    }
  }

  async transcribe(
    buffer: Buffer,
    mime: string,
    fileName = "audio.ogg",
  ): Promise<TranscriptionResult> {
    const fetchFn = this.config.fetchFn ?? fetch;
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(buffer)], { type: mime }),
      normalizeAudioName(fileName),
    );
    form.append("model", this.config.model ?? "whisper-1");
    const response = await fetchFn(
      `${this.config.baseUrl.replace(/\/$/, "")}/audio/transcriptions`,
      {
        method: "POST",
        headers: { authorization: `Bearer ${this.config.apiKey}` },
        body: form,
      },
    );
    if (!response.ok) {
      throw new Error(`openai transcribe failed: ${response.status}`);
    }
    const parsed = (await response.json()) as {
      text?: string;
      language?: string;
      duration?: number;
    };
    return { text: parsed.text ?? "", language: parsed.language, duration: parsed.duration };
  }
}

export class MlxTranscriptionEngine implements TranscriptionEngine {
  constructor(
    private readonly binPath: string,
    private readonly spawnFn: typeof import("node:child_process").spawn = spawn,
  ) {}

  async transcribe(buffer: Buffer, mime: string): Promise<TranscriptionResult> {
    const dir = mkdtempSync(join(tmpdir(), "wa-mcp-mlx-"));
    const input = join(dir, "input.ogg");
    const output = join(dir, "out.json");
    writeFileSync(input, buffer);
    try {
      await new Promise<void>((resolve, reject) => {
        let child: ReturnType<typeof this.spawnFn>;
        try {
          child = this.spawnFn(this.binPath, [input, "--output-json", output]);
        } catch (err: unknown) {
          reject(
            new MediaError(
              "ENGINE_UNAVAILABLE",
              `mlx binary not runnable at ${this.binPath}: ${String(err)} — install with: pip install mlx-whisper`,
            ),
          );
          return;
        }
        child.on("error", (err: NodeJS.ErrnoException) =>
          reject(
            new MediaError(
              "ENGINE_UNAVAILABLE",
              `mlx binary not runnable at ${this.binPath}: ${err.message} — install with: pip install mlx-whisper`,
            ),
          ),
        );
        child.on("close", (code) => {
          if (code !== 0) {
            reject(new MediaError("ENGINE_UNAVAILABLE", `mlx exited ${code}`));
            return;
          }
          resolve();
        });
      });
      const parsed = JSON.parse(readFileSync(output, "utf8")) as {
        text?: string;
        language?: string;
      };
      return { text: parsed.text ?? "", language: parsed.language };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

export class WhisperLocalTranscriptionEngine implements TranscriptionEngine {
  constructor(
    private readonly config: {
      binPath: string;
      modelPath: string;
      ffmpegPath: string;
      spawnFn?: typeof spawn;
    },
  ) {
    if (config.modelPath.length === 0) {
      throw new MediaError(
        "ENGINE_NOT_CONFIGURED",
        "whisper-local needs a model — set WA_WHISPER_MODEL to a ggml .bin model path (e.g. ggml-base.bin from https://huggingface.co/ggerganov/whisper.cpp)",
      );
    }
  }

  async transcribe(buffer: Buffer, mime: string): Promise<TranscriptionResult> {
    const spawnFn = this.config.spawnFn ?? spawn;
    const dir = mkdtempSync(join(tmpdir(), "wa-mcp-whisper-"));
    const input = join(dir, "input.wav");
    const output = join(dir, "out.json");
    try {
      await new Promise<void>((resolve, reject) => {
        const ffmpeg = spawnFn(this.config.ffmpegPath, [
          "-i",
          "pipe:0",
          "-ar",
          "16000",
          "-ac",
          "1",
          "-f",
          "wav",
          input,
        ]);
        ffmpeg.stdin.on("error", () => undefined);
        ffmpeg.stdin.end(buffer);
        ffmpeg.on("error", (err: NodeJS.ErrnoException) =>
          reject(
            new MediaError(
              "ENGINE_UNAVAILABLE",
              `ffmpeg not runnable at ${this.config.ffmpegPath}: ${err.message} — install with: brew install ffmpeg`,
            ),
          ),
        );
        ffmpeg.on("close", (code) => {
          if (code !== 0) {
            reject(new MediaError("ENGINE_UNAVAILABLE", `ffmpeg exited ${code} for ${mime} input`));
            return;
          }
          const whisper = spawnFn(this.config.binPath, [
            "-m",
            this.config.modelPath,
            "-f",
            input,
            "-oj",
            "-of",
            output.replace(/\.json$/, ""),
          ]);
          whisper.on("error", (err: NodeJS.ErrnoException) =>
            reject(
              new MediaError(
                "ENGINE_UNAVAILABLE",
                `whisper binary not runnable at ${this.config.binPath}: ${err.message} — install with: brew install whisper-cpp`,
              ),
            ),
          );
          whisper.on("close", (wcode) => {
            if (wcode !== 0) {
              reject(new MediaError("ENGINE_UNAVAILABLE", `whisper-cli exited ${wcode}`));
              return;
            }
            resolve();
          });
        });
      });
      const raw = JSON.parse(readFileSync(output, "utf8")) as {
        transcription?: Array<{ text?: string }>;
        text?: string;
      };
      const text =
        raw.transcription
          ?.map((part) => part.text ?? "")
          .join("")
          .trim() ??
        raw.text ??
        "";
      return { text };
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
}

export function createTranscriptionEngine(engine: string): TranscriptionEngine {
  if (engine === "mock") {
    return new MockTranscriptionEngine();
  }
  if (engine === "mlx") {
    const binPath = process.env.WA_MLX_BIN ?? "mlx_whisper";
    return new MlxTranscriptionEngine(binPath);
  }
  if (engine === "whisper-local") {
    return new WhisperLocalTranscriptionEngine({
      binPath: process.env.WA_WHISPER_BIN ?? "whisper-cli",
      modelPath: process.env.WA_WHISPER_MODEL ?? "",
      ffmpegPath: process.env.WA_FFMPEG_BIN ?? "ffmpeg",
    });
  }
  if (engine === "openai") {
    return new OpenAITranscriptionEngine({
      baseUrl: process.env.WA_OPENAI_BASE_URL ?? "https://api.openai.com/v1",
      apiKey: process.env.WA_OPENAI_API_KEY ?? "",
    });
  }
  throw new Error(
    `unsupported transcription engine: ${engine} (supported: ${SUPPORTED_TRANSCRIPTION_ENGINES.join(", ")})`,
  );
}

interface TranscriptRow {
  text: string;
  language: string | null;
}

export function saveTranscript(
  store: Store,
  chatJid: string,
  messageId: string,
  engine: string,
  text: string,
  language?: string,
  kind = "voice",
): void {
  store.db
    .prepare(
      "INSERT INTO transcripts (chat_jid, message_id, engine, text, language, kind, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(chat_jid, message_id, engine) DO UPDATE SET text = excluded.text, language = excluded.language, kind = excluded.kind",
    )
    .run(chatJid, messageId, engine, text, language ?? null, kind, new Date().toISOString());
}

export function getTranscript(
  store: Store,
  chatJid: string,
  messageId: string,
  engine: string,
): { text: string; language: string | null } | null {
  const row = store.db
    .prepare(
      "SELECT text, language FROM transcripts WHERE chat_jid = ? AND message_id = ? AND engine = ?",
    )
    .get(chatJid, messageId, engine) as TranscriptRow | undefined;
  return row === undefined ? null : { text: row.text, language: row.language };
}
