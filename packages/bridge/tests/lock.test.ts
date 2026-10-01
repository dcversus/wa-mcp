import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { acquireLock } from "../src/lock.ts";

test("acquire writes a lockfile containing the pid", () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-lock-"));
  acquireLock(dir);
  const lockPath = join(dir, "bridge.lock");
  expect(existsSync(lockPath)).toBe(true);
  const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as { pid: number };
  expect(parsed.pid).toBe(process.pid);
});

test("a second acquire in the same process throws session held", () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-lock-"));
  acquireLock(dir);
  expect(() => acquireLock(dir)).toThrow("session held");
});

test("release removes the lock and allows re-acquire", () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-lock-"));
  const lock = acquireLock(dir);
  lock.release();
  expect(existsSync(join(dir, "bridge.lock"))).toBe(false);
  expect(() => acquireLock(dir)).not.toThrow();
});

test("a lock left by a dead process is broken, not honored", () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-lock-"));
  const dead = spawnSync("true");
  if (dead.pid === undefined) {
    throw new Error("could not spawn a short-lived process");
  }
  writeFileSync(join(dir, "bridge.lock"), JSON.stringify({ pid: dead.pid }));
  expect(() => acquireLock(dir)).not.toThrow();
});

test("a corrupt lockfile is treated as stale", () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-lock-"));
  writeFileSync(join(dir, "bridge.lock"), "not json at all");
  expect(() => acquireLock(dir)).not.toThrow();
});

test("release does not remove a lockfile replaced by another owner", () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-lock-"));
  const lock = acquireLock(dir);
  const lockPath = join(dir, "bridge.lock");
  writeFileSync(lockPath, JSON.stringify({ pid: -1 }));
  lock.release();
  expect(JSON.parse(readFileSync(lockPath, "utf8"))).toEqual({ pid: -1 });
});
