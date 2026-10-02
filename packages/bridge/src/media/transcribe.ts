import { createHash } from "node:crypto";
import type { Store } from "../store/schema.ts";

export interface TranscriptionResult {
  text: string;
  language?: string;
  duration?: number;
}

export interface TranscriptionEngine {
  transcribe(buffer: Buffer, mime: string): Promise<TranscriptionResult>;
}

export class MockTranscriptionEngine implements TranscriptionEngine {
  async transcribe(buffer: Buffer, _mime: string): Promise<TranscriptionResult> {
    const hash = createHash("sha256").update(buffer).digest("hex").slice(0, 12);
    const words = ["alpha", "bravo", "charlie", "delta", "echo", "foxtrot", "golf", "hotel"];
    const text = `mock transcript ${hash}: ${words[parseInt(hash.slice(0, 2), 16) % words.length]}`;
    return { text };
  }
}

export const SUPPORTED_TRANSCRIPTION_ENGINES = ["mock"] as const;

export function createTranscriptionEngine(engine: string): TranscriptionEngine {
  if (engine === "mock") {
    return new MockTranscriptionEngine();
  }
  throw new Error(
    `unsupported transcription engine: ${engine} (supported: ${SUPPORTED_TRANSCRIPTION_ENGINES.join(", ")}; openai/whisper engines are planned, not implemented)`,
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
