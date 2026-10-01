import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export interface LockHandle {
  release(): void;
}

const LOCK_FILE = "bridge.lock";

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

function lockHeldByLiveProcess(lockPath: string): boolean {
  if (!existsSync(lockPath)) {
    return false;
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(lockPath, "utf8"));
    if (parsed === null || typeof parsed !== "object") {
      return false;
    }
    const pid = (parsed as { pid?: unknown }).pid;
    return typeof pid === "number" && isProcessAlive(pid);
  } catch {
    return false;
  }
}

export function acquireLock(dataDir: string): LockHandle {
  mkdirSync(dataDir, { recursive: true, mode: 0o700 });
  const lockPath = join(dataDir, LOCK_FILE);
  if (lockHeldByLiveProcess(lockPath)) {
    throw new Error("session held: another bridge instance owns this data directory");
  }
  writeFileSync(
    lockPath,
    `${JSON.stringify({ pid: process.pid, acquired_at: new Date().toISOString() })}\n`,
    {
      mode: 0o600,
    },
  );
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
