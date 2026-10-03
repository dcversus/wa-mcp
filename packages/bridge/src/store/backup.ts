import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";

/** T80 line62: nightly-capable store backup — copies store.db (+ WAL/SHM)
 * and the media dir into backups/<timestamp>/, then prunes oldest runs
 * beyond `retention`. Returns the created backup dir. */
export function runBackup(
  dataDir: string,
  backupsRoot: string,
  retention: number,
  now: Date = new Date(),
): string {
  const stamp = now.toISOString().replace(/[:.]/g, "-");
  const target = join(backupsRoot, stamp);
  mkdirSync(target, { recursive: true });
  const dbPath = join(dataDir, "store.db");
  if (existsSync(dbPath)) {
    cpSync(dbPath, join(target, "store.db"));
    for (const sidecar of ["-wal", "-shm"]) {
      if (existsSync(dbPath + sidecar)) {
        cpSync(dbPath + sidecar, join(target, "store.db" + sidecar));
      }
    }
  }
  const mediaDir = join(dataDir, "media");
  if (existsSync(mediaDir)) {
    cpSync(mediaDir, join(target, "media"), { recursive: true });
  }
  prune(backupsRoot, retention);
  return target;
}

function prune(backupsRoot: string, retention: number): void {
  if (!existsSync(backupsRoot)) {
    return;
  }
  const runs = readdirSync(backupsRoot)
    .filter((name) => /^\d{4}-\d{2}-\d{2}T/.test(name))
    .sort();
  for (const stale of runs.slice(0, Math.max(0, runs.length - retention))) {
    rmSync(join(backupsRoot, stale), { recursive: true, force: true });
  }
}
