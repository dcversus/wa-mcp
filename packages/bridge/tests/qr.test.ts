import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { asciiSafe } from "../src/qr.ts";

// real fs PNG writes: generous under load (T46 lesson)
vi.setConfig({ testTimeout: 20_000 });
import { renderQrAscii, saveQrPng } from "../src/qr.ts";

test("renderQrAscii returns pure printable ASCII", () => {
  const ascii = renderQrAscii("QRDATA-rotation-1");
  expect(ascii.length).toBeGreaterThan(0);
  expect(ascii).toMatch(/^[\x20-\x7E\n]*$/);
  expect(ascii).toContain("#");
});

test("renderQrAscii is deterministic and multi-line", () => {
  const first = renderQrAscii("QRDATA-rotation-1");
  const second = renderQrAscii("QRDATA-rotation-1");
  expect(first).toBe(second);
  expect(first.split("\n").length).toBeGreaterThan(10);
});

test("renderQrAscii changes when the payload rotates", () => {
  const first = renderQrAscii("QRDATA-rotation-1");
  const second = renderQrAscii("QRDATA-rotation-2");
  expect(first).not.toBe(second);
});

test("saveQrPng writes a real PNG file", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-mcp-qr-"));
  const file = join(dir, "qr.png");
  await saveQrPng("QRDATA-rotation-1", file);
  const bytes = await readFile(file);
  expect(bytes.length).toBeGreaterThan(100);
  expect(Array.from(bytes.subarray(0, 8))).toEqual([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
  ]);
});

test("saveQrPng creates missing parent directories", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-mcp-qr-"));
  const file = join(dir, "nested", "deeper", "qr.png");
  await saveQrPng("QRDATA-rotation-2", file);
  const bytes = await readFile(file);
  expect(bytes.length).toBeGreaterThan(100);
});

test("T80 line60 — asciiSafe replaces non-ASCII (cp1252-hostile) output", () => {
  const sanitized = asciiSafe("staleness — ok ✓ é 🎉\nnext");
  expect(sanitized).toMatch(/^[\x20-\x7E\n]*$/);
  expect(sanitized).toContain("?"); // replaced, not dropped
});
