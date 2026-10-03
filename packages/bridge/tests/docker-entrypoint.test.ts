import { chmodSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { execFileSync } from "node:child_process";
import { expect, test } from "vite-plus/test";

const ENTRYPOINT = join(__dirname, "..", "..", "docker", "entrypoint.sh");

/** PATH stubs record chown/su-exec invocations; the entrypoint execs its
 * args through su-exec when it drops privileges — the stub captures them. */
function stubBinDir(logPath: string): string {
  const dir = mkdirSync(join(tmpdir(), `wa-mcp-path-${Date.now()}-${Math.random()}`));
  writeFileSync(join(dir, "chown"), `#!/bin/sh\necho "chown $*" >> ${logPath}\nexit 0\n`);
  writeFileSync(join(dir, "su-exec"), `#!/bin/sh\necho "su-exec $*" >> ${logPath}\n`);
  chmodSync(join(dir, "chown"), 0o755);
  chmodSync(join(dir, "su-exec"), 0o755);
  return dir;
}

function runEntrypoint(env: Record<string, string>, logPath: string): string {
  const binDir = stubBinDir(logPath);
  execFileSync("sh", [ENTRYPOINT, "node", "dist/bin.mjs"], {
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH ?? ""}`,
      DATA_DIR: join(tmpdir(), "wa-mcp-docker-data"),
      ...env,
    },
  });
  return logPath;
}

test("T81 line67 — PUID/PGID chown the data dir and drop privileges", () => {
  const log = join(tmpdir(), `wa-mcp-ep-${Date.now()}-a.log`);
  runEntrypoint({ PUID: "1001", PGID: "1001" }, log);
  const recorded = readFileSync(log, "utf8");
  expect(recorded).toContain("chown -R 1001:1001");
  expect(recorded).toContain("su-exec 1001:1001 node dist/bin.mjs");
});

test("T81 line67 — default (no PUID/PGID) keeps current behavior", () => {
  const log = join(tmpdir(), `wa-mcp-ep-${Date.now()}-b.log`);
  runEntrypoint({}, log);
  const recorded = readFileSync(log, "utf8");
  expect(recorded).not.toContain("chown");
  expect(recorded).not.toContain("su-exec");
});
