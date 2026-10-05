import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { runDoctor } from "../src/doctor.ts";

function baseOptions(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  const dataDir = mkdtempSync(join(tmpdir(), "wa-mcp-t129-"));
  return {
    home: "/tmp",
    dataDir,
    bridgeUrl: "http://127.0.0.1:1",
    minNodeMajor: 18,
    fetchFn: (async () => {
      throw new Error("offline test");
    }) as unknown as typeof fetch,
    ...overrides,
  };
}

test("without --engines the check list is unchanged", async () => {
  const opts = baseOptions();
  try {
    const report = await runDoctor(opts as never);
    const names = report.checks.map((check) => check.name);
    expect(names).toEqual(["node version", "data dir writable", "bridge token", "bridge health"]);
  } finally {
    rmSync(opts.dataDir as string, { recursive: true, force: true });
  }
});

test("--engines reports optional engines as not-configured without failing", async () => {
  const opts = baseOptions({ engines: true, whichFn: async () => false });
  try {
    const report = await runDoctor(opts as never);
    const engineChecks = report.checks.filter((check) => check.name.startsWith("engine "));
    expect(engineChecks.length).toBeGreaterThanOrEqual(2);
    for (const check of engineChecks) {
      expect(check.ok).toBe(true);
      expect(["available", "not-configured (optional)", "unavailable (optional)"]).toContain(
        check.detail.split(" — ")[0] ?? "",
      );
    }
  } finally {
    rmSync(opts.dataDir as string, { recursive: true, force: true });
  }
});

test("--engines with a selected-but-missing whisper-local fails with a fix hint", async () => {
  const opts = baseOptions({
    engines: true,
    whichFn: async (bin: string) => bin === "ffmpeg",
    engine: "whisper-local",
  });
  try {
    const report = await runDoctor(opts as never);
    const whisper = report.checks.find((check) => check.name === "engine whisper-local");
    expect(whisper).toBeDefined();
    expect(whisper?.ok).toBe(false);
    expect(whisper?.detail).toContain("brew install whisper-cpp");
    expect(whisper?.detail).toContain("model missing");
  } finally {
    rmSync(opts.dataDir as string, { recursive: true, force: true });
  }
});

test("--engines masks the openai key", async () => {
  const opts = baseOptions({ engines: true, whichFn: async () => true });
  try {
    const report = await runDoctor(opts as never);
    const text = JSON.stringify(report.checks);
    expect(text).not.toMatch(/sk-[A-Za-z0-9]{10,}/);
  } finally {
    rmSync(opts.dataDir as string, { recursive: true, force: true });
  }
});
