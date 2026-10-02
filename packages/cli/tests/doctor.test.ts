import { chmodSync, mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { runDoctor } from "../src/doctor.ts";

function homeWithDataDir(): { home: string; dataDir: string } {
  const home = mkdtempSync(join(tmpdir(), "wa-mcp-doctor-"));
  const dataDir = join(home, ".wa-mcp");
  mkdirSync(dataDir, { recursive: true });
  return { home, dataDir };
}

test("doctor reports ok on a healthy setup", async () => {
  const { home, dataDir } = homeWithDataDir();
  writeFileSync(join(dataDir, "token"), "tok\n", { mode: 0o600 });
  const fetchFn = (async () => new Response(JSON.stringify({ status: "connected", connected: true }), { status: 200 })) as unknown as typeof fetch;
  const report = await runDoctor({ home, dataDir, bridgeUrl: "http://127.0.0.1:8080", fetchFn, minNodeMajor: 20 });
  expect(report.ok).toBe(true);
  expect(report.checks.every((check) => check.ok)).toBe(true);
  expect(report.checks.map((check) => check.name)).toContain("node version");
  expect(report.checks.map((check) => check.name)).toContain("data dir writable");
  expect(report.checks.map((check) => check.name)).toContain("bridge token");
  expect(report.checks.map((check) => check.name)).toContain("bridge health");
});

test("doctor fails on unreachable bridge and missing token", async () => {
  const { home, dataDir } = homeWithDataDir();
  const fetchFn = (async () => {
    throw new Error("offline");
  }) as unknown as typeof fetch;
  const report = await runDoctor({ home, dataDir, bridgeUrl: "http://127.0.0.1:1", fetchFn, minNodeMajor: 20 });
  expect(report.ok).toBe(false);
  const byName = new Map(report.checks.map((check) => [check.name, check]));
  expect(byName.get("bridge health")?.ok).toBe(false);
  expect(byName.get("bridge token")?.ok).toBe(false);
});

test("doctor flags a world-readable token", () => {
  const { home, dataDir } = homeWithDataDir();
  writeFileSync(join(dataDir, "token"), "tok\n", { mode: 0o644 });
  const report = runDoctorSyncSafe({ home, dataDir });
  const byName = new Map(report.checks.map((check) => [check.name, check]));
  if (process.platform !== "win32") {
    expect(byName.get("bridge token")?.ok).toBe(false);
  }
});

function runDoctorSyncSafe(options: { home: string; dataDir: string }) {
  const fetchFn = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
  return runDoctorSync(options.home, options.dataDir, fetchFn);
}

import { runDoctorSync } from "../src/doctor.ts";

function runDoctorSync(home: string, dataDir: string, fetchFn: typeof fetch) {
  void chmodSync;
  return runDoctor({ home, dataDir, bridgeUrl: "http://127.0.0.1:8080", fetchFn, minNodeMajor: 20 });
}
