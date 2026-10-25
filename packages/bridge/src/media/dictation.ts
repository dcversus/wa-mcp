import { spawn } from "node:child_process";
import { MediaError } from "./resolve.ts";
import type { Store } from "../store/schema.ts";

/** R2-14: ffmpeg argv turning any WhatsApp audio/video into the stream
 * Claude Code's /voice dictation consumes from its `rec` fallback —
 * signed 16-bit little-endian PCM, 16 kHz, mono (mirrors claude
 * 2.1.310's SoX invocation: rec ... -t raw -r 16000 -e signed -b 16 -c 1 -). */
export const DICTATION_PCM_ARGS = [
  "-i",
  "pipe:0",
  "-vn",
  "-ar",
  "16000",
  "-ac",
  "1",
  "-f",
  "s16le",
  "pipe:1",
] as const;

const CURSOR_KEY = "voice_dictation_cursor";

export interface PendingVoiceNote {
  rowid: number;
  id: string;
  chatJid: string;
  senderName: string | null;
  timestamp: string;
  mediaPath: string;
  mediaType: string;
}

interface VoiceRow {
  rowid: number;
  id: string;
  chat_jid: string;
  sender_name: string | null;
  timestamp: string;
  media_path: string;
  media_type: string;
}

const PENDING_WHERE =
  "rowid > ? AND is_from_me = 0 AND media_type IN ('audio', 'video') AND media_path IS NOT NULL";

export function toDictationPcm(
  buffer: Buffer,
  mime: string,
  opts: { ffmpegPath?: string; spawnFn?: typeof spawn } = {},
): Promise<Buffer> {
  const spawnFn = opts.spawnFn ?? spawn;
  const ffmpegPath = opts.ffmpegPath ?? process.env.WA_FFMPEG_BIN ?? "ffmpeg";
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnFn(ffmpegPath, [...DICTATION_PCM_ARGS]);
    } catch (err: unknown) {
      reject(pcmError(err, mime));
      return;
    }
    const chunks: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdin?.on("error", () => undefined);
    child.stdout?.on?.("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    child.stderr?.on?.("data", (chunk: Buffer) => stderr.push(Buffer.from(chunk)));
    child.on("error", (err: unknown) => reject(pcmError(err, mime)));
    child.on("close", (code) => {
      const out = Buffer.concat(chunks);
      if (code !== 0 || out.length === 0) {
        reject(
          new MediaError(
            "ENGINE_UNAVAILABLE",
            `ffmpeg exited ${code} — ${mime} may have no audio track — install ffmpeg (brew install ffmpeg / apk add ffmpeg)`,
          ),
        );
        return;
      }
      resolve(out);
    });
    child.stdin?.end(buffer);
  });
}

function pcmError(err: unknown, mime: string): MediaError {
  const code = (err as { code?: string }).code;
  if (code === "ENOENT") {
    return new MediaError(
      "ENGINE_UNAVAILABLE",
      `ffmpeg is not installed — install it (brew install ffmpeg / apt install ffmpeg / apk add ffmpeg) to dictate WhatsApp voice notes`,
    );
  }
  return new MediaError("ENGINE_UNAVAILABLE", `ffmpeg spawn failed for ${mime}: ${String(err)}`);
}

function readCursor(store: Store): number {
  const row = store.db.prepare("SELECT value FROM meta WHERE key = ?").get(CURSOR_KEY) as
    | { value: string }
    | undefined;
  const parsed = row === undefined ? Number.NaN : Number(row.value);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
}

function toNote(row: VoiceRow): PendingVoiceNote {
  return {
    rowid: row.rowid,
    id: row.id,
    chatJid: row.chat_jid,
    senderName: row.sender_name,
    timestamp: row.timestamp,
    mediaPath: row.media_path,
    mediaType: row.media_type,
  };
}

export function nextVoiceNote(store: Store): PendingVoiceNote | null {
  const row = store.db
    .prepare(
      `SELECT rowid, id, chat_jid, sender_name, timestamp, media_path, media_type FROM messages WHERE ${PENDING_WHERE} ORDER BY rowid ASC LIMIT 1`,
    )
    .get(readCursor(store)) as VoiceRow | undefined;
  return row === undefined ? null : toNote(row);
}

export function pendingVoiceCount(store: Store): number {
  const row = store.db
    .prepare(`SELECT COUNT(*) AS count FROM messages WHERE ${PENDING_WHERE}`)
    .get(readCursor(store)) as { count: number };
  return row.count;
}

export function advanceVoiceCursor(store: Store, rowid: number): void {
  const current = readCursor(store);
  if (rowid <= current) {
    return;
  }
  store.db
    .prepare(
      "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    )
    .run(CURSOR_KEY, String(rowid));
}
