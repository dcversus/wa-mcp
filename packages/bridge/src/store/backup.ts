import { cpSync, existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { Store } from "./schema.ts";

/** Nightly store backup: a consistent `VACUUM INTO` snapshot of the open
 * store (safe while the daemon writes — copying the WAL-mode file is not)
 * plus a copy of the media dir, into backups/<timestamp>/; then prunes the
 * oldest runs beyond `keep`. keep = 0 turns backups off and removes old
 * runs. Returns the created backup dir, or null when off. */
export function runBackup(
  store: Store,
  backupsRoot: string,
  keep: number,
  opts: { mediaDir?: string; now?: Date } = {},
): string | null {
  if (keep <= 0) {
    prune(backupsRoot, 0);
    return null;
  }
  const stamp = (opts.now ?? new Date()).toISOString().replace(/[:.]/g, "-");
  const target = join(backupsRoot, stamp);
  mkdirSync(target, { recursive: true, mode: 0o700 });
  store.db.prepare("VACUUM INTO ?").run(join(target, "store.db"));
  if (opts.mediaDir !== undefined && existsSync(opts.mediaDir)) {
    cpSync(opts.mediaDir, join(target, "media"), { recursive: true });
  }
  prune(backupsRoot, keep);
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
