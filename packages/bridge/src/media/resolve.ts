import { lookup as dnsLookup } from "node:dns/promises";
import { isIP } from "node:net";
import { chmod, mkdir, readFile, realpath, stat, writeFile } from "node:fs/promises";
import { extname, isAbsolute, join, resolve } from "node:path";
import type { Store } from "../store/schema.ts";

export type MediaErrorCode =
  | "PATH_FORBIDDEN"
  | "NOT_FOUND"
  | "TOO_LARGE"
  | "FETCH_FAILED"
  | "EMPTY"
  | "SSRF_BLOCKED"
  | "FFMPEG_UNAVAILABLE"
  | "PAYLOAD_TOO_LARGE"
  | "VALIDATION_ERROR";

export type LookupAddresses = Array<{ address: string; family: number }>;
export type LookupFn = (hostname: string, options: { all: true }) => Promise<LookupAddresses>;

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
  lookupFn?: LookupFn;
  maxBytes?: number;
}

/** T73 H3: every resolved address must be public — a send fetching media by
 * url must never become a probe of the daemon's own network (loopback,
 * RFC1918 private, link-local incl. the cloud-metadata service, unique-local
 * v6). DNS is resolved BEFORE any fetch; the guard runs again per redirect. */
function isBlockedAddress(address: string): boolean {
  const value = address.toLowerCase();
  // T94-E H1: pure dotted quads only — IPv4-EMBEDDED v6 (e.g.
  // ::ffff:127.0.0.1) contains dots too and must reach the v6 path
  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(value)) {
    const parts = value.split(".").map((part) => Number(part));
    if (
      parts.length !== 4 ||
      parts.some((part) => !Number.isInteger(part) || part < 0 || part > 255)
    ) {
      return false;
    }
    const [a, b] = parts as [number, number, number, number];
    if (a === 127 || a === 10 || a === 0) return true;
    if (a === 172 && b >= 16 && b <= 31) return true;
    if (a === 192 && b === 168) return true;
    if (a === 169 && b === 254) return true;
    if (a === 100 && b >= 64 && b <= 127) return true;
    return false;
  }
  // v6 (or unparseable — fail closed)
  let big: bigint;
  try {
    big = ipv6ToBigInt(value);
  } catch {
    return true;
  }
  if (big === 1n) return true; // ::1
  if (big === 0n) return true; // ::
  if (big >> 120n === 0xfcn) return true; // fc00::/7
  if (big >> 118n === 0x3fan) return true; // fe80::/10
  // T94-E H1 (RUNTIME review): IPv4-embedded v6 must be judged by the
  // EMBEDDED v4 — ::ffff:10.0.0.1, 64:ff9b::/96 and 2002::/16 all smuggle
  // private v4 targets past a pure-v6 prefix check
  const embedded = embeddedV4(big);
  if (embedded !== null) {
    return isBlockedAddress(embedded);
  }
  return false;
}

/** extracts the IPv4 address embedded in an IPv4-mapped (::ffff:0:0/96),
 * NAT64 (64:ff9b::/96) or 6to4 (2002::/16) address; null when none. */
function embeddedV4(big: bigint): string | null {
  const low32 = (shift: bigint) =>
    [
      (big >> (shift + 24n)) & 0xffn,
      (big >> (shift + 16n)) & 0xffn,
      (big >> (shift + 8n)) & 0xffn,
      big & 0xffn,
    ].join(".");
  // ::ffff:0:0/96 — 80 zero bits, ffff at bits 32-48, v4 in the low 32
  if (big >> 32n === 0xffffn) {
    return low32(0n);
  }
  // 64:ff9b::/96 — prefix groups 0-1 plus four zero groups, v4 in the low 32
  if (big >> 32n === 0x64ff9bn << 64n) {
    return low32(0n);
  }
  // 2002::/16 — prefix g0 (top 16 bits), v4 = groups 1-2 (bits 80-112)
  if (big >> 112n === 0x2002n) {
    return low32(80n);
  }
  return null;
}

function ipv6ToBigInt(value: string): bigint {
  const parsed = value.replace(/^\[|\]$/g, "");
  const zoneless = parsed.split("%")[0] ?? parsed;
  const sections = zoneless.split("::");
  if (sections.length > 2) throw new Error("bad v6");
  // T94-E H1: a trailing dotted-quad (::ffff:127.0.0.1) is ONE split group —
  // expand it to its two hex groups or the parse silently truncates
  const dotted = (group: string): string | string[] => {
    const parts = group.split(".");
    if (parts.length === 4 && parts.every((part) => /^\d+$/.test(part) && Number(part) <= 255)) {
      const [a, b, c, d] = parts.map(Number) as [number, number, number, number];
      return [(((a << 8) | b) >>> 0).toString(16), (((c << 8) | d) >>> 0).toString(16)];
    }
    return group;
  };
  const head = sections[0] === "" ? [] : (sections[0]?.split(":").map(dotted).flat() ?? []);
  const tail =
    sections.length === 2
      ? sections[1] === ""
        ? []
        : (sections[1]?.split(":").map(dotted).flat() ?? [])
      : [];
  const fill = 8 - head.length - tail.length;
  if (sections.length === 1 && head.length !== 8) throw new Error("bad v6");
  if (fill < 0) throw new Error("bad v6");
  const groups = [...head, ...Array<string>(fill).fill("0"), ...tail];
  let result = 0n;
  for (const group of groups) {
    const n = Number.parseInt(group, 16);
    if (!Number.isInteger(n) || n < 0 || n > 0xffff) throw new Error("bad v6");
    result = (result << 16n) | BigInt(n);
  }
  return result;
}

export async function assertPublicHttpUrl(rawUrl: string, lookupFn?: LookupFn): Promise<void> {
  const reject = () =>
    new MediaError(
      "SSRF_BLOCKED",
      `media url must be a public http(s) resource: ${rawUrl.slice(0, 120)}`,
    );
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw reject();
  }
  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw reject();
  }
  const hostname = parsed.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (hostname === "localhost" || hostname.endsWith(".localhost") || hostname === "::1") {
    throw reject();
  }
  const ipVersion = isIP(hostname);
  if (ipVersion !== 0) {
    // IP literals are checked without DNS
    if (isBlockedAddress(hostname)) {
      throw reject();
    }
    return;
  }
  if (hostname.includes(":")) {
    // malformed v6-ish literal — fail closed
    throw reject();
  }
  const lookup = lookupFn ?? (dnsLookup as unknown as LookupFn);
  let addresses: LookupAddresses;
  try {
    addresses = await lookup(parsed.hostname, { all: true });
  } catch {
    throw reject();
  }
  if (addresses.length === 0) {
    throw reject();
  }
  if (addresses.some((entry) => isBlockedAddress(entry.address))) {
    throw reject();
  }
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

export function sniffMimeType(buffer: Buffer): string {
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
    // T73 H3: validate the target BEFORE fetching and re-validate every
    // redirect hop (fetch runs with redirect:"manual" so nothing is followed
    // blindly). 3 hops max.
    let target = input.url;
    let response: Response | null = null;
    for (let hop = 0; hop < 4; hop += 1) {
      await assertPublicHttpUrl(target, opts.lookupFn);
      let fetched: Response;
      try {
        fetched = await fetchFn(target, { redirect: "manual" });
      } catch {
        throw new MediaError("FETCH_FAILED", `media fetch failed: ${input.url}`);
      }
      if (
        (fetched.status === 301 ||
          fetched.status === 302 ||
          fetched.status === 303 ||
          fetched.status === 307 ||
          fetched.status === 308) &&
        hop < 3
      ) {
        const location = fetched.headers.get("location");
        if (location === null) {
          throw new MediaError("FETCH_FAILED", "media fetch redirect without location");
        }
        try {
          target = new URL(location, target).toString();
        } catch {
          throw new MediaError("FETCH_FAILED", `media fetch redirect is not a URL: ${location}`);
        }
        continue;
      }
      response = fetched;
      break;
    }
    if (response === null) {
      throw new MediaError("FETCH_FAILED", "media fetch exceeded 3 redirects");
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
