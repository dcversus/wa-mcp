import { chmod, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, resolve } from "node:path";
import type { Store } from "../store/schema.ts";

export type MediaErrorCode =
  | "PATH_FORBIDDEN"
  | "NOT_FOUND"
  | "TOO_LARGE"
  | "FETCH_FAILED"
  | "EMPTY";

export class MediaError extends Error {
  readonly code: MediaErrorCode;

  constructor(code: MediaErrorCode, message: string) {
    super(message);
    this.code = code;
  }
}

export type MediaInput =
  | { base64: string; fileName?: string }
  | { path: string; fileName?: string }
  | { url: string; fileName?: string };

export interface ResolvedMedia {
  buffer: Buffer;
  mimeType: string;
  fileName: string;
}

export interface ResolveOptions {
  mediaDir: string;
  fetchFn?: typeof fetch;
  maxBytes?: number;
}

const DEFAULT_MAX_BYTES = 20_000_000;

const MIME_EXTENSIONS: Record<string, string> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "video/mp4": "mp4",
  "audio/mpeg": "mp3",
  "audio/ogg": "ogg",
  "application/pdf": "pdf",
  "application/zip": "zip",
  "application/octet-stream": "bin",
};

function sniffMimeType(buffer: Buffer): string {
  if (buffer.length < 4) {
    return "application/octet-stream";
  }
  if (buffer.subarray(0, 3).equals(Buffer.from([0xff, 0xd8, 0xff]))) {
    return "image/jpeg";
  }
  if (buffer.subarray(0, 4).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47]))) {
    return "image/png";
  }
  if (
    buffer.subarray(0, 4).equals(Buffer.from("RIFF")) &&
    buffer.subarray(8, 12).equals(Buffer.from("WEBP"))
  ) {
    return "image/webp";
  }
  if (buffer.subarray(4, 8).equals(Buffer.from("ftyp"))) {
    return "video/mp4";
  }
  if (
    buffer.subarray(0, 3).equals(Buffer.from("ID3")) ||
    (buffer[0] === 0xff && ((buffer[1] ?? 0) & 0xe0) === 0xe0)
  ) {
    return "audio/mpeg";
  }
  if (buffer.subarray(0, 4).equals(Buffer.from("OggS"))) {
    return "audio/ogg";
  }
  if (buffer.subarray(0, 5).equals(Buffer.from("%PDF-"))) {
    return "application/pdf";
  }
  if (buffer.subarray(0, 4).equals(Buffer.from([0x50, 0x4b, 0x03, 0x04]))) {
    return "application/zip";
  }
  return "application/octet-stream";
}

function fileNameFrom(
  mimeType: string,
  provided: string | undefined,
  urlPath: string | undefined,
): string {
  if (provided !== undefined && provided.length > 0) {
    return provided;
  }
  if (urlPath !== undefined) {
    const base = urlPath.split("/").pop();
    if (base !== undefined && base.length > 0 && base.includes(".")) {
      return base;
    }
  }
  return `file.${MIME_EXTENSIONS[mimeType] ?? "bin"}`;
}

async function resolveFromPath(
  inputPath: string,
  mediaDir: string,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const candidate = isAbsolute(inputPath) ? resolve(inputPath) : join(mediaDir, inputPath);
  const lexicalDir = resolve(mediaDir);
  if (!resolve(candidate).startsWith(lexicalDir + sep())) {
    throw new MediaError("PATH_FORBIDDEN", `media path escapes the media directory: ${inputPath}`);
  }
  const realDir = await realpath(mediaDir);
  let realFile: string;
  try {
    realFile = await realpath(candidate);
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === "ENOENT") {
      throw new MediaError("NOT_FOUND", `media file not found: ${inputPath}`);
    }
    throw err;
  }
  if (!realFile.startsWith(realDir + sep()) && realFile !== realDir) {
    throw new MediaError("PATH_FORBIDDEN", `media path escapes the media directory: ${inputPath}`);
  }
  const info = await stat(realFile);
  if (!info.isFile()) {
    throw new MediaError("PATH_FORBIDDEN", `media path is not a file: ${inputPath}`);
  }
  const buffer = await readFile(realFile);
  return { buffer, mimeType: sniffMimeType(buffer) };
}

function sep(): string {
  return process.platform === "win32" ? "\\" : "/";
}

export async function resolveMedia(
  input: MediaInput,
  opts: ResolveOptions,
): Promise<ResolvedMedia> {
  const maxBytes = opts.maxBytes ?? DEFAULT_MAX_BYTES;
  let buffer: Buffer;
  let mimeType: string;
  let urlPath: string | undefined;
  if ("base64" in input) {
    buffer = Buffer.from(input.base64, "base64");
    if (buffer.length === 0) {
      throw new MediaError("EMPTY", "media payload is empty");
    }
    if (buffer.length > maxBytes) {
      throw new MediaError("TOO_LARGE", `media exceeds ${maxBytes} bytes`);
    }
    mimeType = sniffMimeType(buffer);
  } else if ("path" in input) {
    const fromPath = await resolveFromPath(input.path, opts.mediaDir);
    buffer = fromPath.buffer;
    mimeType = fromPath.mimeType;
    if (buffer.length > maxBytes) {
      throw new MediaError("TOO_LARGE", `media exceeds ${maxBytes} bytes`);
    }
  } else {
    const fetchFn = opts.fetchFn ?? fetch;
    let response: Response;
    try {
      response = await fetchFn(input.url);
    } catch {
      throw new MediaError("FETCH_FAILED", `media fetch failed: ${input.url}`);
    }
    if (!response.ok) {
      throw new MediaError("FETCH_FAILED", `media fetch returned ${response.status}`);
    }
    const declared = Number(response.headers.get("content-length") ?? 0);
    if (declared > maxBytes) {
      throw new MediaError("TOO_LARGE", `media exceeds ${maxBytes} bytes`);
    }
    buffer = Buffer.from(await response.arrayBuffer());
    if (buffer.length > maxBytes) {
      throw new MediaError("TOO_LARGE", `media exceeds ${maxBytes} bytes`);
    }
    if (buffer.length === 0) {
      throw new MediaError("EMPTY", "media payload is empty");
    }
    urlPath = new URL(input.url).pathname;
    mimeType = sniffMimeType(buffer);
  }
  return {
    buffer,
    mimeType,
    fileName: fileNameFrom(mimeType, input.fileName, urlPath),
  };
}

export async function saveOutboundMedia(
  store: Store,
  mediaDir: string,
  messageId: string,
  buffer: Buffer,
  mimeType: string,
  kind?: string,
  caption?: string,
): Promise<string> {
  await mkdir(mediaDir, { recursive: true, mode: 0o700 });
  await chmod(mediaDir, 0o700);
  const declaredExt = extname(`x.${MIME_EXTENSIONS[mimeType] ?? "bin"}`);
  const filePath = join(mediaDir, `${messageId}${declaredExt}`);
  await writeFile(filePath, buffer, { mode: 0o644 });
  await chmod(filePath, 0o644);
  store.db
    .prepare(
      "UPDATE messages SET media_path = ?, media_type = COALESCE(?, media_type), content = COALESCE(?, content) WHERE id = ?",
    )
    .run(filePath, kind ?? null, caption ?? null, messageId);
  return filePath;
}
