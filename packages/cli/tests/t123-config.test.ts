import { chmodSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { loadConfig, CONFIG_KEYS, maskSecret } from "../src/config-store.ts";

function tmpDataDir(): string {
  return mkdtempSync(join(tmpdir(), "wa-mcp-t123-"));
}

test("loadConfig returns an empty config when no file exists", () => {
  const dir = tmpDataDir();
  try {
    const config = loadConfig(dir);
    expect(config.transcription).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("CONFIG_KEYS lists the transcription surface", () => {
  expect(CONFIG_KEYS.includes("transcription.engine")).toBe(true);
  expect(CONFIG_KEYS.includes("transcription.api_key")).toBe(true);
  expect(CONFIG_KEYS.includes("transcription.base_url")).toBe(true);
  expect(CONFIG_KEYS.includes("transcription.model")).toBe(true);
});

test("maskSecret hides the middle of a key", () => {
  expect(maskSecret("sk-test-abcdef123456")).toBe("sk-…3456");
  expect(maskSecret("short")).toBe("s…t");
});

test("loadConfig refuses a world-readable config file", () => {
  const dir = tmpDataDir();
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify({ transcription: { engine: "mock" } }), { mode: 0o644 });
  chmodSync(path, 0o644);
  try {
    expect(() => loadConfig(dir)).toThrowError(/permissions/);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test.skipIf(process.platform === "win32")("loadConfig reads a 0600 config file", () => {
  const dir = tmpDataDir();
  const path = join(dir, "config.json");
  writeFileSync(path, JSON.stringify({ transcription: { engine: "mock" } }), { mode: 0o600 });
  try {
    const config = loadConfig(dir);
    expect(config.transcription?.engine).toBe("mock");
    const stat = JSON.parse(readFileSync(path, "utf8"));
    expect(stat.transcription.engine).toBe("mock");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
