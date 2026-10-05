import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { ocrImage } from "../../src/media/ocr.ts";

test("ocr disabled by default rejects with ENGINE_NOT_CONFIGURED and setup text", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-t128-"));
  try {
    const path = join(dir, "img.jpg");
    writeFileSync(path, Buffer.from("x"));
    await expect(ocrImage(path, {})).rejects.toThrowError(/WA_OCR_ENGINE/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("tesseract engine spawns with the right args and returns text", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-t128b-"));
  try {
    const path = join(dir, "img.jpg");
    writeFileSync(path, Buffer.from("x"));
    const calls: Array<{ bin: string; args: string[] }> = [];
    const text = await ocrImage(path, {
      engine: "tesseract",
      spawnFn: ((bin: string, args: string[]) => {
        calls.push({ bin, args });
        const child: unknown = {
          stdout: {
            on: (event: string, cb: (chunk: Buffer) => void) => {
              if (event === "data") cb(Buffer.from("scanned text"));
            },
          },
          stderr: { on: () => undefined },
          on: (event: string, cb: (arg?: unknown) => void) => {
            if (event === "close") setImmediate(() => cb(0));
          },
        };
        return child as never;
      }) as never,
    });
    expect(calls[0]?.bin).toBe("tesseract");
    expect(calls[0]?.args).toEqual([path, "-", "-l", "eng"]);
    expect(text).toContain("scanned text");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("missing tesseract binary rejects with ENGINE_UNAVAILABLE and install hint", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-t128c-"));
  try {
    const path = join(dir, "img.jpg");
    writeFileSync(path, Buffer.from("x"));
    await expect(
      ocrImage(path, {
        engine: "tesseract",
        spawnFn: ((bin: string) => {
          void bin;
          const child: unknown = {
            stdout: { on: () => undefined },
            stderr: { on: () => undefined },
            on: (event: string, cb: (arg?: unknown) => void) => {
              if (event === "error")
                setImmediate(() =>
                  cb(Object.assign(new Error("spawn ENOENT"), { code: "ENOENT" })),
                );
            },
          };
          return child as never;
        }) as never,
      }),
    ).rejects.toThrowError(/tesseract/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
