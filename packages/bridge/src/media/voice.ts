import { spawn } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { assertPublicHttpUrl, MediaError, type LookupFn } from "./resolve.ts";

export interface VoiceInput {
  path?: string;
  url?: string;
}

export interface VoiceOptions {
  spawnFn?: typeof spawn;
  fetchFn?: typeof fetch;
  lookupFn?: LookupFn;
  tmpDir?: string;
  /** test hook: observe the fetched temp file (the caller never sees it) */
  onTempWrite?: (path: string) => void;
}

const FFMPEG_ARGS = (input: string) => [
  "-i",
  input,
  "-c:a",
  "libopus",
  "-b:a",
  "32k",
  "-ar",
  "48000",
  "-f",
  "ogg",
  "pipe:1",
];

/** T81 line72: convert mp3/wav/m4a (file path or URL) to WhatsApp voice-note
 * codec (ogg/opus 32k 48kHz) via ffmpeg. URLs are SSRF-guarded and fetched
 * to a temp file that is always removed. */
export async function toVoiceOgg(input: VoiceInput, opts: VoiceOptions = {}): Promise<Buffer> {
  const spawnFn = opts.spawnFn ?? spawn;
  if (input.url !== undefined) {
    await assertPublicHttpUrl(input.url, opts.lookupFn);
    const fetchFn = opts.fetchFn ?? fetch;
    let response: Response;
    try {
      response = await fetchFn(input.url);
    } catch {
      throw new MediaError("FETCH_FAILED", `voice fetch failed: ${input.url}`);
    }
    if (!response.ok) {
      throw new MediaError("FETCH_FAILED", `voice fetch returned ${response.status}`);
    }
    const dir = mkdtempSync(join(opts.tmpDir ?? tmpdir(), "wa-mcp-voice-"));
    const temp = join(dir, "voice-input.mp3");
    writeFileSync(temp, Buffer.from(await response.arrayBuffer()));
    opts.onTempWrite?.(temp);
    try {
      return await runFfmpeg(temp, spawnFn);
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }
  if (input.path !== undefined) {
    return runFfmpeg(input.path, spawnFn);
  }
  throw new MediaError("EMPTY", "voice input needs a path or url");
}

function runFfmpeg(inputPath: string, spawnFn: typeof spawn): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnFn("ffmpeg", FFMPEG_ARGS(inputPath));
    } catch (err: unknown) {
      const code = (err as { code?: string }).code;
      reject(
        new MediaError(
          "FFMPEG_UNAVAILABLE",
          code === "ENOENT"
            ? "ffmpeg is not installed — install it (brew install ffmpeg / apt install ffmpeg) to send real voice notes"
            : `ffmpeg spawn failed: ${String(err)}`,
        ),
      );
      return;
    }
    const chunks: Buffer[] = [];
    const stderr: Buffer[] = [];
    child.stdout?.on?.("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    child.stderr?.on?.("data", (chunk: Buffer) => stderr.push(Buffer.from(chunk)));
    child.on("error", (err: NodeJS.ErrnoException) => {
      reject(
        new MediaError(
          "FFMPEG_UNAVAILABLE",
          err.code === "ENOENT"
            ? "ffmpeg is not installed — install it (brew install ffmpeg / apt install ffmpeg) to send real voice notes"
            : `ffmpeg spawn failed: ${String(err)}`,
        ),
      );
    });
    child.on("close", (code) => {
      const out = Buffer.concat(chunks);
      if (code !== 0 || out.length === 0) {
        reject(
          new MediaError(
            "FFMPEG_UNAVAILABLE",
            `ffmpeg exited ${code}: ${Buffer.concat(stderr).toString("utf8").slice(0, 200)}`,
          ),
        );
        return;
      }
      resolve(out);
    });
  });
}
