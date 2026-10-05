import { readFileSync, statSync } from "node:fs";
import { inflateRawSync } from "node:zlib";
import { spawn } from "node:child_process";
import { MediaError } from "./resolve.ts";

const MAX_TEXT_CHARS = 1_000_000;
const MAX_INFLATED_BYTES = 20 * 1024 * 1024;
const MAX_ZIP_ENTRIES = 200;

export interface DocumentTextResult {
  text: string;
  truncated: boolean;
  engine: "docx" | "pdftotext";
}

interface ZipEntry {
  name: string;
  data: Buffer;
}

function parseZip(buffer: Buffer): ZipEntry[] {
  const entries: ZipEntry[] = [];
  const sig = 0x04034b50;
  let offset = 0;
  while (
    offset + 30 <= buffer.length &&
    buffer.readUInt32LE(offset) === sig &&
    entries.length < MAX_ZIP_ENTRIES
  ) {
    const method = buffer.readUInt16LE(offset + 8);
    const compressedSize = buffer.readUInt32LE(offset + 18);
    const nameLength = buffer.readUInt16LE(offset + 26);
    const extraLength = buffer.readUInt16LE(offset + 28);
    const name = buffer.subarray(offset + 30, offset + 30 + nameLength).toString("utf8");
    const dataStart = offset + 30 + nameLength + extraLength;
    const raw = buffer.subarray(dataStart, dataStart + compressedSize);
    if (method === 0) {
      entries.push({ name, data: Buffer.from(raw) });
    } else if (method === 8) {
      const inflated = inflateRawSync(raw, { maxOutputLength: MAX_INFLATED_BYTES });
      entries.push({ name, data: inflated });
    }
    offset = dataStart + compressedSize;
  }
  return entries;
}

function xmlToText(xml: string): string {
  return xml
    .replace(/<w:p[^>]*>/g, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

function clip(text: string): DocumentTextResult["text"] {
  return text.length > MAX_TEXT_CHARS ? text.slice(0, MAX_TEXT_CHARS) : text;
}

export async function extractDocumentText(
  path: string,
  mime: string,
  opts: { spawnFn?: typeof spawn } = {},
): Promise<DocumentTextResult> {
  if (mime === "application/vnd.openxmlformats-officedocument.wordprocessingml.document") {
    const buffer = readFileSync(path);
    const entries = parseZip(buffer);
    const doc = entries.find((entry) => entry.name === "word/document.xml");
    if (doc === undefined) {
      throw new MediaError("VALIDATION_ERROR", "docx has no word/document.xml entry");
    }
    const text = xmlToText(doc.data.toString("utf8"));
    return {
      text: clip(text),
      truncated: text.length > MAX_TEXT_CHARS,
      engine: "docx",
    };
  }
  if (mime === "application/pdf") {
    const spawnFn = opts.spawnFn ?? spawn;
    const text = await pdfText(path, spawnFn);
    return {
      text: clip(text),
      truncated: text.length > MAX_TEXT_CHARS,
      engine: "pdftotext",
    };
  }
  throw new MediaError(
    "VALIDATION_ERROR",
    `read_document supports docx and pdf, got ${mime} — install pdftotext (poppler) for PDFs`,
  );
}

function pdfText(path: string, spawnFn: typeof spawn): Promise<string> {
  return new Promise<string>((resolve, reject) => {
    const child = spawnFn("pdftotext", [path, "-layout", "-"]);
    const stdout: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => {
      stdout.push(chunk);
    });
    child.stderr.on("data", () => undefined);
    child.on("error", (spawnErr: NodeJS.ErrnoException) =>
      reject(
        new MediaError(
          "ENGINE_UNAVAILABLE",
          `pdftotext not runnable (${spawnErr.message}) — install with: brew install poppler`,
        ),
      ),
    );
    child.on("close", (code) => {
      if (code !== 0) {
        reject(new MediaError("ENGINE_UNAVAILABLE", `pdftotext exited ${code}`));
        return;
      }
      resolve(Buffer.concat(stdout).toString("utf8").trim());
    });
  });
}

export function documentSizeGuard(path: string): void {
  const stats = statSync(path);
  if (stats.size > 50 * 1024 * 1024) {
    throw new MediaError("TOO_LARGE", "document exceeds 50MB");
  }
}
