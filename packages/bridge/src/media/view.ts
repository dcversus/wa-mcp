import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { statSync } from "node:fs";
import { MediaError } from "./resolve.ts";

export interface ViewFrame {
  data_base64: string;
}

export interface ViewResult {
  mime: string;
  frames: ViewFrame[];
}

export interface ViewOptions {
  spawnFn?: typeof spawn;
  maxBytes?: number;
}

const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const MAX_VIDEO_FRAMES = 8;

/** T90 line142: image content returned to the model (base64, ~5MB cap);
 * video content sampled to <=8 frames via ffmpeg evenly-seeked extraction
 * (-vf fps filter over the whole clip — no duration probe needed). */
export async function viewMedia(
  input: { path: string; mime: string },
  opts: ViewOptions = {},
): Promise<ViewResult> {
  if (input.mime.startsWith("image/")) {
    const stats = statSync(input.path);
    if (stats.size > (opts.maxBytes ?? MAX_IMAGE_BYTES)) {
      throw new MediaError(
        "PAYLOAD_TOO_LARGE",
        `image exceeds the ${Math.floor((opts.maxBytes ?? MAX_IMAGE_BYTES) / 1024 / 1024)}MB view cap`,
      );
    }
    const data = await readFile(input.path);
    return { mime: input.mime, frames: [{ data_base64: data.toString("base64") }] };
  }
  if (input.mime.startsWith("video/")) {
    return sampleVideo(input.path, opts);
  }
  throw new MediaError("VALIDATION_ERROR", `view supports image/* or video/*, got ${input.mime}`);
}

async function sampleVideo(path: string, opts: ViewOptions): Promise<ViewResult> {
  const spawnFn = opts.spawnFn ?? spawn;
  const args = [
    "-i",
    path,
    "-vf",
    "fps=1,scale=640:-1",
    "-c:v",
    "libjpeg",
    "-f",
    "image2pipe",
    "-vcodec",
    "mjpeg",
    "pipe:1",
  ];
  return new Promise((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawnFn("ffmpeg", args);
    } catch (err: unknown) {
      reject(ffmpegUnavailable(err));
      return;
    }
    const chunks: Buffer[] = [];
    child.stdout?.on?.("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    child.on("error", (err: NodeJS.ErrnoException) => reject(ffmpegUnavailable(err)));
    child.on("close", (code) => {
      const all = Buffer.concat(chunks);
      if (code !== 0 || all.length === 0) {
        reject(new MediaError("FFMPEG_UNAVAILABLE", `ffmpeg frame sampling failed: exit ${code}`));
        return;
      }
      // mjpeg pipe frames are delimited by the JPEG SOI marker
      const SOI = Buffer.from([0xff, 0xd8, 0xff]);
      const frames: ViewFrame[] = [];
      let start = all.indexOf(SOI);
      while (start !== -1 && frames.length < MAX_VIDEO_FRAMES) {
        const next = all.indexOf(SOI, start + 2);
        const end = next === -1 ? all.length : next;
        frames.push({ data_base64: all.subarray(start, end).toString("base64") });
        start = next;
      }
      resolve({ mime: "image/jpeg", frames });
    });
  });
}

function ffmpegUnavailable(err: unknown): MediaError {
  const code = (err as { code?: string }).code;
  return new MediaError(
    "FFMPEG_UNAVAILABLE",
    code === "ENOENT"
      ? "ffmpeg is not installed — install it to view video content"
      : `ffmpeg spawn failed: ${String(err)}`,
  );
}
