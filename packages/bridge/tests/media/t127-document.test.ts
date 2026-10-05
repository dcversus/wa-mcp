import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { inflateRawSync } from "node:zlib";
import { expect, test } from "vite-plus/test";
import { extractDocumentText } from "../../src/media/document.ts";

function makeDocx(text: string): Buffer {
  const docXml = `<?xml version="1.0"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:p><w:r><w:t>${text}</w:t></w:r></w:p></w:body></w:document>`;
  const zipEntries: Array<{ name: string; data: Buffer }> = [
    { name: "[Content_Types].xml", data: Buffer.from('<?xml version="1.0"?>') },
    { name: "word/document.xml", data: Buffer.from(docXml) },
  ];
  const chunks: Buffer[] = [];
  const central: Buffer[] = [];
  let offset = 0;
  for (const entry of zipEntries) {
    const nameBuf = Buffer.from(entry.name);
    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4);
    local.writeUInt16LE(0, 6);
    local.writeUInt16LE(0, 8);
    local.writeUInt16LE(0, 10);
    local.writeUInt16LE(0, 12);
    local.writeUInt16LE(0x9e66 | 0x81a4, 14);
    local.writeUInt32LE(0, 16);
    local.writeUInt32LE(entry.data.length, 18);
    local.writeUInt32LE(0, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28);
    chunks.push(local, nameBuf, entry.data);
    const centralEntry = Buffer.alloc(46);
    centralEntry.writeUInt32LE(0x02014b50, 0);
    centralEntry.writeUInt16LE(20, 4);
    centralEntry.writeUInt16LE(20, 6);
    centralEntry.writeUInt16LE(8, 8);
    centralEntry.writeUInt32LE(0, 16);
    centralEntry.writeUInt32LE(entry.data.length, 20);
    centralEntry.writeUInt16LE(nameBuf.length, 28);
    centralEntry.writeUInt32LE(0, 32);
    centralEntry.writeUInt32LE(offset, 42);
    central.push(centralEntry, nameBuf);
    offset += local.length + nameBuf.length + entry.data.length;
  }
  const centralBuf = Buffer.concat(central);
  const end = Buffer.alloc(22);
  end.writeUInt32LE(0x06054b50, 0);
  end.writeUInt16LE(zipEntries.length, 8);
  end.writeUInt16LE(zipEntries.length, 10);
  end.writeUInt32LE(centralBuf.length, 12);
  end.writeUInt32LE(offset, 16);
  const crcTable: number[] = [];
  for (let n = 0; n < 256; n += 1) {
    let c = n;
    for (let k = 0; k < 8; k += 1) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    crcTable[n] = c >>> 0;
  }
  void crcTable;
  return Buffer.concat([...chunks, centralBuf, end]);
}

test("docx text extraction pulls paragraph text", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-t127-"));
  try {
    const path = join(dir, "doc.docx");
    writeFileSync(path, makeDocx("hello from the document"));
    const result = await extractDocumentText(
      path,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(result.text).toContain("hello from the document");
    expect(result.truncated).toBe(false);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("unsupported mime rejects with VALIDATION_ERROR", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-t127b-"));
  try {
    const path = join(dir, "file.zip");
    writeFileSync(path, Buffer.from("x"));
    await expect(extractDocumentText(path, "application/zip")).rejects.toThrowError(/zip/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("oversized text is truncated with truncated flag", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-t127c-"));
  try {
    const path = join(dir, "doc.docx");
    writeFileSync(path, makeDocx("word ".repeat(400000)));
    const result = await extractDocumentText(
      path,
      "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
    );
    expect(result.truncated).toBe(true);
    expect(result.text.length).toBeLessThanOrEqual(1_100_000);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pdf uses pdftotext via spawn", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-t127d-"));
  try {
    const path = join(dir, "doc.pdf");
    writeFileSync(path, Buffer.from("%PDF-1.4 fake"));
    const calls: Array<{ bin: string; args: string[] }> = [];
    const result = await extractDocumentText(path, "application/pdf", {
      spawnFn: ((bin: string, args: string[]) => {
        calls.push({ bin, args });
        const child: unknown = {
          stdout: {
            on: (event: string, cb: (chunk: Buffer) => void) => {
              if (event === "data") cb(Buffer.from("pdf text here"));
            },
          },
          stderr: { on: () => undefined },
          on: (event: string, cb: (arg?: unknown) => void) => {
            if (event === "close") {
              setImmediate(() => cb(0));
            }
          },
        };
        return child as never;
      }) as never,
    });
    expect(calls[0]?.bin).toBe("pdftotext");
    expect(calls[0]?.args).toEqual([path, "-layout", "-"]);
    expect(result.text).toContain("pdf text here");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("pdf with pdftotext missing rejects with ENGINE_UNAVAILABLE", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-t127e-"));
  try {
    const path = join(dir, "doc.pdf");
    writeFileSync(path, Buffer.from("%PDF-1.4 fake"));
    await expect(
      extractDocumentText(path, "application/pdf", {
        spawnFn: ((bin: string) => {
          const child: unknown = {
            stdout: { on: () => undefined },
            stderr: { on: () => undefined },
            on: (event: string, cb: (arg?: unknown) => void) => {
              if (event === "error") {
                setImmediate(() =>
                  cb(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })),
                );
              }
            },
          };
          return child as never;
        }) as never,
      }),
    ).rejects.toThrowError(/pdftotext/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

void inflateRawSync;
