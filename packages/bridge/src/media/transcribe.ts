import { createHash } from "node:crypto";
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

export const SUPPORTED_TRANSCRIPTION_ENGINES = ["mock", "openai"] as const;

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
    if (config.baseUrl.length === 0 || config.apiKey.length === 0) {
      throw new Error(
        "CONFIG: openai transcription needs WA_OPENAI_BASE_URL and WA_OPENAI_API_KEY",
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

export function createTranscriptionEngine(engine: string): TranscriptionEngine {
  if (engine === "mock") {
    return new MockTranscriptionEngine();
  }
  if (engine === "openai") {
    return new OpenAITranscriptionEngine({
      baseUrl: process.env.WA_OPENAI_BASE_URL ?? "",
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
): void {
  store.db
    .prepare(
      "INSERT INTO transcripts (chat_jid, message_id, engine, text, language, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(chat_jid, message_id, engine) DO UPDATE SET text = excluded.text, language = excluded.language",
    )
    .run(chatJid, messageId, engine, text, language ?? null, new Date().toISOString());
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
