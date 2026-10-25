import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { hostname } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { acquireLock, readLockIdentity } from "../src/lock.ts";

const LINUX = process.platform === "linux";

function writeLock(dir: string, payload: Record<string, unknown>): void {
  writeFileSync(join(dir, "bridge.lock"), `${JSON.stringify(payload)}\n`, { mode: 0o600 });
}

test("T195 — a stale lock from a DIFFERENT hostname (container restart) is not held, even when the pid is alive", () => {
  const dir = mkdtempSync(join(tmpdir(), "t195-lock-"));
  writeLock(dir, {
    pid: process.pid,
    hostname: "old-container-id",
    acquired_at: "2026-10-25T00:00:00Z",
  });
  const lock = acquireLock(dir);
  expect(lock).toBeDefined();
  lock.release();
});

test("T195 — a lock held by THIS live process (matching hostname) is held", () => {
  const dir = mkdtempSync(join(tmpdir(), "t195-lock-"));
  writeLock(dir, { pid: process.pid, hostname: hostname() });
  expect(() => acquireLock(dir)).toThrow("session held");
});

test("T195 — a dead pid is stale regardless of payload", () => {
  const dir = mkdtempSync(join(tmpdir(), "t195-lock-"));
  writeLock(dir, { pid: 999_999, hostname: hostname() });
  const lock = acquireLock(dir);
  expect(lock).toBeDefined();
  lock.release();
});

test.skipIf(!LINUX)("T195 (linux) — same pid and hostname but a different boot_id is stale", () => {
  const dir = mkdtempSync(join(tmpdir(), "t195-lock-"));
  writeLock(dir, { pid: process.pid, hostname: hostname(), boot_id: "not-the-real-boot-id" });
  const lock = acquireLock(dir);
  expect(lock).toBeDefined();
  lock.release();
});

test.skipIf(!LINUX)(
  "T195 (linux) — same pid, hostname and boot_id but a different starttime (pid reuse) is stale",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "t195-lock-"));
    const identity = readLockIdentity();
    writeLock(dir, {
      pid: process.pid,
      hostname: hostname(),
      ...(identity.bootId !== null ? { boot_id: identity.bootId } : {}),
      starttime: String((Number(identity.startTime ?? 1) as number) === 1 ? 2 : 1),
    });
    const lock = acquireLock(dir);
    expect(lock).toBeDefined();
    lock.release();
  },
);

test.skipIf(!LINUX)(
  "T195 (linux) — the full own identity (pid+hostname+boot_id+starttime) IS held",
  () => {
    const dir = mkdtempSync(join(tmpdir(), "t195-lock-"));
    const identity = readLockIdentity();
    writeLock(dir, {
      pid: process.pid,
      hostname: hostname(),
      ...(identity.bootId !== null ? { boot_id: identity.bootId } : {}),
      ...(identity.startTime !== null ? { starttime: identity.startTime } : {}),
    });
    expect(() => acquireLock(dir)).toThrow("session held");
  },
);

test("T195 — malformed lock content is not held", () => {
  const dir = mkdtempSync(join(tmpdir(), "t195-lock-"));
  writeFileSync(join(dir, "bridge.lock"), "not-json", { mode: 0o600 });
  const lock = acquireLock(dir);
  expect(lock).toBeDefined();
  lock.release();
});

test("T195 — acquire writes the full identity payload (boot-safe on next container boot)", () => {
  const dir = mkdtempSync(join(tmpdir(), "t195-lock-"));
  const lock = acquireLock(dir);
  const stored = JSON.parse(readFileSync(join(dir, "bridge.lock"), "utf8")) as Record<
    string,
    unknown
  >;
  expect(stored.pid).toBe(process.pid);
  expect(stored.hostname).toBe(hostname());
  expect(typeof stored.acquired_at).toBe("string");
  if (LINUX) {
    expect(typeof stored.boot_id).toBe("string");
    expect(typeof stored.starttime).toBe("string");
  }
  lock.release();
});
