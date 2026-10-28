import {
  closeSync,
  existsSync,
  fstatSync,
  openSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import type { Store } from "./store/schema.ts";

const MB = 1024 * 1024;
const DAY_MS = 24 * 60 * 60 * 1000;
/** a file this fresh may still be mid-download — never pruned */
const MEDIA_GRACE_MS = 5 * 60 * 1000;

/** Size and age limits for everything the daemon accumulates on disk.
 * 0 means "no limit" for the media caps; every other value is a hard cap. */
export interface RetentionSettings {
  /** daemon log file; null keeps logging to stderr (the old behavior) */
  logFile: string | null;
  logMaxBytes: number;
  /** rotated copies kept next to the live file (bridge.log.1 … .N) */
  logFiles: number;
  /** per subscription spool, before it rotates to <name>.1.jsonl */
  inboxMaxBytes: number;
  mediaMaxBytes: number;
  mediaMaxAgeDays: number;
  /** nightly store backups kept; 0 turns backups off */
  backupsKeep: number;
  /** agent activity rows (the Agents page's delivery/reply log) */
  activityMaxAgeDays: number;
}

interface FileSection {
  log_file?: unknown;
  log_max_mb?: unknown;
  log_files?: unknown;
  inbox_max_mb?: unknown;
  media_max_mb?: unknown;
  media_max_age_days?: unknown;
  backups_keep?: unknown;
  activity_max_age_days?: unknown;
}

function readSection(dataDir: string | undefined): FileSection {
  if (dataDir === undefined) {
    return {};
  }
  try {
    const parsed = JSON.parse(readFileSync(join(dataDir, "config.json"), "utf8")) as {
      retention?: FileSection;
    };
    return parsed.retention ?? {};
  } catch {
    return {};
  }
}

/** env wins over config.json `retention`; anything unparsable or negative
 * falls back to the default instead of disabling a limit by accident */
function amount(envValue: string | undefined, fileValue: unknown, fallback: number): number {
  for (const candidate of [envValue, fileValue]) {
    if (candidate === undefined || candidate === null || candidate === "") {
      continue;
    }
    const parsed = Number(candidate);
    if (Number.isFinite(parsed) && parsed >= 0) {
      return parsed;
    }
  }
  return fallback;
}

export function resolveRetentionSettings(
  dataDir: string | undefined,
  env: NodeJS.ProcessEnv = process.env,
): RetentionSettings {
  const file = readSection(dataDir);
  const logFile =
    env.WA_LOG_FILE !== undefined && env.WA_LOG_FILE.length > 0
      ? env.WA_LOG_FILE
      : typeof file.log_file === "string" && file.log_file.length > 0
        ? file.log_file
        : null;
  return {
    logFile,
    logMaxBytes: Math.max(1, amount(env.WA_LOG_MAX_MB, file.log_max_mb, 10)) * MB,
    logFiles: Math.trunc(amount(env.WA_LOG_FILES, file.log_files, 3)),
    inboxMaxBytes: Math.max(0.01, amount(env.WA_INBOX_MAX_MB, file.inbox_max_mb, 2)) * MB,
    mediaMaxBytes: amount(env.WA_MEDIA_MAX_MB, file.media_max_mb, 0) * MB,
    mediaMaxAgeDays: amount(env.WA_MEDIA_MAX_AGE_DAYS, file.media_max_age_days, 0),
    backupsKeep: Math.trunc(amount(env.WA_BACKUPS_KEEP, file.backups_keep, 1)),
    activityMaxAgeDays: amount(env.WA_ACTIVITY_MAX_AGE_DAYS, file.activity_max_age_days, 30),
  };
}

export interface RotatingLog {
  write(chunk: string): boolean;
  close(): void;
}

/** A size-capped log file for pino: when the next line would cross
 * `maxBytes` the file shifts to .1 (older copies to .2 … .keep, the oldest
 * dropped) and a fresh file opens. Writes are synchronous like
 * pino.destination's default, so a crash never loses the last lines. */
export function openRotatingLog(path: string, maxBytes: number, keep: number): RotatingLog {
  let fd = openSync(path, "a", 0o600);
  let size = fstatSync(fd).size;
  const rotate = (): void => {
    closeSync(fd);
    if (keep <= 0) {
      rmSync(path, { force: true });
    } else {
      rmSync(`${path}.${keep}`, { force: true });
      for (let index = keep - 1; index >= 1; index -= 1) {
        if (existsSync(`${path}.${index}`)) {
          renameSync(`${path}.${index}`, `${path}.${index + 1}`);
        }
      }
      renameSync(path, `${path}.1`);
    }
    fd = openSync(path, "a", 0o600);
    size = 0;
  };
  return {
    write(chunk) {
      const bytes = Buffer.byteLength(chunk);
      if (size > 0 && size + bytes > maxBytes) {
        rotate();
      }
      writeSync(fd, chunk);
      size += bytes;
      return true;
    },
    close() {
      closeSync(fd);
    },
  };
}

interface MediaFile {
  path: string;
  size: number;
  mtimeMs: number;
}

function mediaFiles(dir: string): MediaFile[] {
  if (!existsSync(dir)) {
    return [];
  }
  const files: MediaFile[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true, recursive: true })) {
    if (!entry.isFile()) {
      continue;
    }
    const path = join(entry.parentPath, entry.name);
    try {
      const stats = statSync(path);
      files.push({ path, size: stats.size, mtimeMs: stats.mtimeMs });
    } catch {
      continue;
    }
  }
  return files;
}

/** Deletes downloaded media past the age limit, then the oldest files until
 * the directory fits the size cap. Messages keep their media keys, so a
 * pruned file downloads again on demand while WhatsApp still serves it. */
export function pruneMedia(
  dir: string,
  limits: { maxBytes: number; maxAgeDays: number },
  now: number = Date.now(),
): { removed: number; freedBytes: number } {
  if (limits.maxBytes <= 0 && limits.maxAgeDays <= 0) {
    return { removed: 0, freedBytes: 0 };
  }
  const files = mediaFiles(dir)
    .filter((file) => now - file.mtimeMs >= MEDIA_GRACE_MS)
    .sort((a, b) => a.mtimeMs - b.mtimeMs);
  let total = mediaFiles(dir).reduce((sum, file) => sum + file.size, 0);
  let removed = 0;
  let freedBytes = 0;
  const cutoff = limits.maxAgeDays > 0 ? now - limits.maxAgeDays * DAY_MS : -Infinity;
  for (const file of files) {
    const tooOld = file.mtimeMs < cutoff;
    const overCap = limits.maxBytes > 0 && total > limits.maxBytes;
    if (!tooOld && !overCap) {
      continue;
    }
    try {
      rmSync(file.path, { force: true });
    } catch {
      continue;
    }
    total -= file.size;
    freedBytes += file.size;
    removed += 1;
  }
  return { removed, freedBytes };
}

export function pruneActivity(store: Store, maxAgeDays: number, now: number = Date.now()): number {
  if (maxAgeDays <= 0) {
    return 0;
  }
  const cutoff = new Date(now - maxAgeDays * DAY_MS).toISOString();
  return Number(store.db.prepare("DELETE FROM agent_activity WHERE ts < ?").run(cutoff).changes);
}
