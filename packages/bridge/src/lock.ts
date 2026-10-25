import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { hostname } from "node:os";
import { join } from "node:path";

export interface LockHandle {
  release(): void;
}

const LOCK_FILE = "bridge.lock";

export interface LockIdentity {
  bootId: string | null;
  startTime: string | null;
}

/** Linux-only identity probes; null everywhere else (graceful degradation to
 * the pid+hostname check). boot_id is the HOST kernel's — stable across
 * container restarts — so it pairs with the per-container hostname, and
 * starttime (proc field 22) disambiguates pid reuse on one booted host. */
export function readLockIdentity(): LockIdentity {
  let bootId: string | null = null;
  try {
    const raw = readFileSync("/proc/sys/kernel/random/boot_id", "utf8").trim();
    if (raw.length > 0) {
      bootId = raw;
    }
  } catch {
    bootId = null;
  }
  return { bootId, startTime: processStartTime(process.pid) };
}

function processStartTime(pid: number): string | null {
  try {
    const stat = readFileSync(`/proc/${pid}/stat`, "utf8");
    // comm can contain spaces/parens — fields resume after the LAST ')'
    const rest = stat.slice(stat.lastIndexOf(")") + 2).split(" ");
    // rest[0] is field 3 (state); starttime is field 22 → index 22 - 3
    const starttime = rest[19];
    return starttime === undefined ? null : starttime;
  } catch {
    return null;
  }
}

function isProcessAlive(pid: number): boolean {
  if (!Number.isInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    return (err as NodeJS.ErrnoException).code === "EPERM";
  }
}

interface StoredLock {
  pid?: unknown;
  hostname?: unknown;
  boot_id?: unknown;
  starttime?: unknown;
}

/** A lock is HELD only when the pid is alive AND every recorded identity
 * component that both sides know still matches. Containers restart pids
 * from 1, so a bare pid-alive check collides with unrelated processes
 * (entrypoint, supervisor) and crash-loops the bridge — the hostname alone
 * separates container lifetimes; boot_id + starttime separate host reboots
 * and same-host pid reuse. */
function lockHeldByLiveProcess(lockPath: string): boolean {
  if (!existsSync(lockPath)) {
    return false;
  }
  let parsed: StoredLock;
  try {
    parsed = JSON.parse(readFileSync(lockPath, "utf8")) as StoredLock;
  } catch {
    return false;
  }
  const pid = parsed.pid;
  if (typeof pid !== "number" || !isProcessAlive(pid)) {
    return false;
  }
  if (typeof parsed.hostname === "string" && parsed.hostname !== hostname()) {
    return false;
  }
  if (typeof parsed.boot_id === "string") {
    const identity = readLockIdentity();
    if (identity.bootId !== null && parsed.boot_id !== identity.bootId) {
      return false;
    }
  }
  if (typeof parsed.starttime === "string") {
    const live = processStartTime(pid);
    if (live !== null && parsed.starttime !== live) {
      return false;
    }
  }
  return true;
}

export function acquireLock(dataDir: string): LockHandle {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const lockPath = join(dataDir, LOCK_FILE);
  if (lockHeldByLiveProcess(lockPath)) {
    throw new Error("session held: another bridge instance owns this data directory");
  }
  const identity = readLockIdentity();
  const payload = {
    pid: process.pid,
    hostname: hostname(),
    acquired_at: new Date().toISOString(),
    ...(identity.bootId !== null ? { boot_id: identity.bootId } : {}),
    ...(identity.startTime !== null ? { starttime: identity.startTime } : {}),
  };
  const tempPath = `${lockPath}.${process.pid}.tmp`;
  writeFileSync(tempPath, `${JSON.stringify(payload)}\n`, { mode: 0o600 });
  renameSync(tempPath, lockPath);
  return {
    release() {
      try {
        const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: number };
        if (parsed.pid === process.pid) {
          rmSync(lockPath);
        }
      } catch {
        return;
      }
    },
  };
}
