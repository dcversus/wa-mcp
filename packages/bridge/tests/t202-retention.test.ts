import {
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openInbox } from "../src/inbox.ts";
import {
  openRotatingLog,
  pruneActivity,
  pruneMedia,
  resolveRetentionSettings,
} from "../src/retention.ts";
import { openStore } from "../src/store/schema.ts";

const MB = 1024 * 1024;
const DAY = 24 * 60 * 60 * 1000;
const tmp = (prefix: string) => mkdtempSync(join(tmpdir(), `wa-mcp-t202-${prefix}-`));

test("defaults: bounded logs, 2 MB spools, one backup, 30 days of activity, media kept", () => {
  expect(resolveRetentionSettings(undefined, {})).toEqual({
    logFile: null,
    logMaxBytes: 10 * MB,
    logFiles: 3,
    inboxMaxBytes: 2 * MB,
    mediaMaxBytes: 0,
    mediaMaxAgeDays: 0,
    backupsKeep: 1,
    activityMaxAgeDays: 30,
  });
});

test("config.json `retention` sets limits; env wins; junk falls back to the default", () => {
  const dir = tmp("cfg");
  writeFileSync(
    join(dir, "config.json"),
    JSON.stringify({
      retention: { log_file: "/var/log/wa.log", log_max_mb: 5, media_max_mb: 500, backups_keep: 3 },
    }),
  );
  const settings = resolveRetentionSettings(dir, {
    WA_LOG_MAX_MB: "2",
    WA_MEDIA_MAX_AGE_DAYS: "14",
    WA_ACTIVITY_MAX_AGE_DAYS: "-1",
  });
  expect(settings).toMatchObject({
    logFile: "/var/log/wa.log",
    logMaxBytes: 2 * MB,
    mediaMaxBytes: 500 * MB,
    mediaMaxAgeDays: 14,
    backupsKeep: 3,
    activityMaxAgeDays: 30,
  });
});

test("the log file rotates at the cap and keeps exactly N old copies", () => {
  const dir = tmp("log");
  const path = join(dir, "bridge.log");
  const log = openRotatingLog(path, 100, 2);
  for (let index = 0; index < 20; index += 1) {
    log.write(`${JSON.stringify({ n: index, pad: "x".repeat(20) })}\n`);
  }
  log.close();
  expect(readdirSync(dir).sort()).toEqual(["bridge.log", "bridge.log.1", "bridge.log.2"]);
  for (const name of readdirSync(dir)) {
    expect(statSync(join(dir, name)).size).toBeLessThanOrEqual(100);
  }
  // the newest line is in the live file, the one before it in .1
  expect(readFileSync(path, "utf8")).toContain('"n":19');
  const lastRotated = readFileSync(`${path}.1`, "utf8").trim().split("\n").at(-1) ?? "";
  expect(JSON.parse(lastRotated).n).toBeLessThan(19);
});

test("a reopened log keeps counting from the existing file's size", () => {
  const dir = tmp("reopen");
  const path = join(dir, "bridge.log");
  writeFileSync(path, "x".repeat(90));
  const log = openRotatingLog(path, 100, 1);
  log.write("y".repeat(20));
  log.close();
  expect(readFileSync(`${path}.1`, "utf8")).toBe("x".repeat(90));
  expect(readFileSync(path, "utf8")).toBe("y".repeat(20));
});

test("media: files past the age limit go, then the oldest until the size cap fits", () => {
  const dir = tmp("media");
  mkdirSync(join(dir, "sub"));
  const now = Date.parse("2026-10-28T12:00:00Z");
  const file = (name: string, bytes: number, ageDays: number) => {
    const path = join(dir, name);
    writeFileSync(path, Buffer.alloc(bytes));
    const at = (now - ageDays * DAY) / 1000;
    utimesSync(path, at, at);
  };
  file("ancient.jpg", 10, 40);
  file("old.ogg", 400, 20);
  file("sub/mid.png", 400, 10);
  file("new.webp", 400, 1);
  const result = pruneMedia(dir, { maxBytes: 900, maxAgeDays: 30 }, now);
  expect(result).toEqual({ removed: 2, freedBytes: 410 });
  expect(
    readdirSync(dir, { recursive: true, encoding: "utf8" }).sort((a, b) => a.localeCompare(b)),
  ).toEqual(["new.webp", "sub", join("sub", "mid.png")]);
});

test("media: a file still being written (under 5 minutes old) is never pruned", () => {
  const dir = tmp("fresh");
  writeFileSync(join(dir, "downloading.mp4"), Buffer.alloc(1000));
  expect(pruneMedia(dir, { maxBytes: 1, maxAgeDays: 0 }).removed).toBe(0);
});

test("media: no limits configured means nothing is touched", () => {
  const dir = tmp("nolimit");
  writeFileSync(join(dir, "a.jpg"), "x");
  utimesSync(join(dir, "a.jpg"), 0, 0);
  expect(pruneMedia(dir, { maxBytes: 0, maxAgeDays: 0 })).toEqual({ removed: 0, freedBytes: 0 });
});

test("agent activity older than the limit is deleted, newer rows stay", () => {
  const store = openStore(tmp("store"));
  try {
    const now = Date.parse("2026-10-28T12:00:00Z");
    const insert = store.db.prepare(
      "INSERT INTO agent_activity (ts, kind, chat_jid, message_id) VALUES (?, 'delivery', 'c', ?)",
    );
    insert.run(new Date(now - 40 * DAY).toISOString(), "old");
    insert.run(new Date(now - 2 * DAY).toISOString(), "new");
    expect(pruneActivity(store, 30, now)).toBe(1);
    expect(store.db.prepare("SELECT message_id FROM agent_activity").all()).toEqual([
      { message_id: "new" },
    ]);
  } finally {
    store.close();
  }
});

test("the inbox spool honours a configured cap", () => {
  const dir = tmp("inbox");
  const inbox = openInbox(dir, 300);
  for (let index = 0; index < 10; index += 1) {
    inbox.append({
      ts: "t",
      kind: "message",
      chat: "c",
      chatName: null,
      from: "f",
      fromName: null,
      fromMe: false,
      id: `M${index}`,
      text: "hello there",
      media: false,
      subId: "s",
    });
  }
  expect(statSync(join(dir, "inbox.jsonl")).size).toBeLessThanOrEqual(300);
  expect(readdirSync(dir).sort()).toEqual(["inbox.1.jsonl", "inbox.jsonl"]);
});
