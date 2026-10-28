import { appendFileSync, mkdtempSync, renameSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { followLog, renderLaunchdPlist, renderSystemdUnit, startDaemon } from "../src/service.ts";

const deps = {
  nodePath: "/usr/bin/node",
  bridgeBin: "/opt/bridge.mjs",
  dataDir: "/d",
  port: "8091",
};

test("the daemon owns bridge.log (WA_LOG_FILE, rotated by retention); raw stderr goes elsewhere", () => {
  const plist = renderLaunchdPlist(deps);
  expect(plist).toContain("<key>WA_LOG_FILE</key>");
  expect(plist).toContain("<string>/d/bridge.log</string>");
  expect(plist).toMatch(
    /<key>StandardErrorPath<\/key>\s*<string>\/d\/bridge\.stderr\.log<\/string>/,
  );
  const unit = renderSystemdUnit(deps);
  expect(unit).toContain("Environment=WA_LOG_FILE=/d/bridge.log");
  expect(unit).toContain("StandardError=append:/d/bridge.stderr.log");
  expect(unit).not.toContain("append:/d/bridge.log");
});

test("wa-mcp start hands the daemon WA_LOG_FILE, unless the user already set one", () => {
  const dataDir = mkdtempSync(join(tmpdir(), "wa-mcp-t202-start-"));
  const spawnFn = vi.fn(() => ({ pid: 1, unref: () => {} }) as never);
  const run = () =>
    startDaemon({
      bridgeBin: "/opt/bridge.mjs",
      dataDir,
      port: "8091",
      logPath: join(dataDir, "bridge.log"),
      spawnFn: spawnFn as never,
    });
  const saved = process.env.WA_LOG_FILE;
  try {
    delete process.env.WA_LOG_FILE;
    run();
    process.env.WA_LOG_FILE = "/custom.log";
    run();
  } finally {
    if (saved === undefined) delete process.env.WA_LOG_FILE;
    else process.env.WA_LOG_FILE = saved;
  }
  const envs = spawnFn.mock.calls.map(
    (call) => (call as unknown as [string, string[], { env: Record<string, string> }])[2].env,
  );
  expect(envs[0]?.WA_LOG_FILE).toBe(join(dataDir, "bridge.log"));
  expect(envs[1]?.WA_LOG_FILE).toBe("/custom.log");
});

test("wa-mcp logs --follow keeps following across a rotation", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-t202-follow-"));
  const path = join(dir, "bridge.log");
  writeFileSync(path, "old-1\nold-2\nold-3\n");
  const seen: string[] = [];
  const following = followLog(path, (line) => seen.push(line), { intervalMs: 20, maxPolls: 6 });
  await new Promise((resolve) => setTimeout(resolve, 30));
  renameSync(path, `${path}.1`);
  // longer than the old file, so only the inode change reveals the rotation
  writeFileSync(path, "fresh-and-already-longer-than-the-rotated-file\n");
  await new Promise((resolve) => setTimeout(resolve, 30));
  appendFileSync(path, "fresh-2\n");
  await following;
  expect(seen).toEqual(["fresh-and-already-longer-than-the-rotated-file", "fresh-2"]);
});
