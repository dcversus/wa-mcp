import { spawn } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { PLATFORMS, resolveConfigPath } from "../src/platforms.ts";
import { writeServerEntry, listRegisteredPlatforms } from "../src/writers.ts";

function tempHome(): string {
  return mkdtempSync(join(tmpdir(), "wa-mcp-t98-home-"));
}

function seedSpec(home: string, platform: (typeof PLATFORMS)[number]): void {
  writeServerEntry(platform, {
    home,
    spec: { command: "node", args: ["mcp.mjs"], env: { WA_TOKEN: "t" } },
  });
}

test("T98 restart — stops the fake daemon and starts a replacement", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "wa-mcp-t98-data-"));
  const fake = spawn(process.execPath, ["-e", "setInterval(() => 0, 250)"], {
    detached: true,
    stdio: "ignore",
  });
  fake.unref();
  writeFileSync(join(dataDir, "bridge.lock"), JSON.stringify({ pid: fake.pid }));
  const { runRestart } = (await import("../src/service.ts")) as {
    runRestart: (deps: {
      dataDir: string;
      bridgeBin: string;
      port: string;
      logPath: string;
      spawnFn: typeof spawn;
    }) => { stopped: boolean; message: string; startedPid?: number };
  };
  const spawnFn = vi.fn(() => ({ pid: 4242, unref: () => {} }) as never);
  let exited = false;
  fake.once("exit", () => {
    exited = true;
  });
  const result = await (async () => {
    const { stopDaemon } = (await import("../src/service.ts")) as {
      stopDaemon: (dataDir: string) => { stopped: boolean; message: string };
    };
    return runRestart({ dataDir, bridgeBin: process.execPath, port: "8081", logPath: join(dataDir, "bridge.log"), spawnFn });
  })();
  await new Promise((resolve) => setTimeout(resolve, 200));
  expect(exited).toBe(true);
  expect(result.stopped).toBe(true);
  expect(result.startedPid).toBe(4242);
  expect(spawnFn).toHaveBeenCalledTimes(1);
}, 15_000);

test("T98 logs — tail returns the last N lines; follow streams appends", async () => {
  const logPath = join(mkdtempSync(join(tmpdir(), "wa-mcp-t98-log-")), "bridge.log");
  const lines = Array.from({ length: 60 }, (_, i) => `line-${i + 1}`);
  writeFileSync(logPath, lines.map((l) => `${l}\n`).join(""));
  const { readLogTail } = (await import("../src/service.ts")) as {
    readLogTail: (logPath: string, lines: number) => string;
  };
  const tail = readLogTail(logPath, 50);
  const tailLines = tail.split("\n").filter((l) => l.length > 0);
  expect(tailLines).toHaveLength(50);
  expect(tailLines[0]).toBe("line-11");
  expect(tailLines.at(-1)).toBe("line-60");

  const { followLog } = (await import("../src/service.ts")) as {
    followLog: (
      logPath: string,
      onData: (line: string) => void,
      opts: { intervalMs: number; maxPolls: number },
    ) => Promise<void>;
  };
  const seen: string[] = [];
  const following = followLog(
    logPath,
    (line) => seen.push(line),
    { intervalMs: 10, maxPolls: 3 },
  );
  await new Promise((resolve) => setTimeout(resolve, 15));
  writeFileSync(logPath, `${readFileSync(logPath, "utf8")}line-61\n`);
  await following;
  expect(seen.some((line) => line.includes("line-61"))).toBe(true);
}, 15_000);

test("T98 uninstall — removes every registration; purge needs confirmation", async () => {
  const home = tempHome();
  for (const platform of PLATFORMS) {
    seedSpec(home, platform);
  }
  // pi's standalone spec file carries no "wa-mcp" marker, so the registry
  // list sees 7 — the removal path still covers all 8 targets explicitly
  expect(listRegisteredPlatforms(home).length).toBeGreaterThanOrEqual(7);
  const { uninstallRegistrations } = (await import("../src/service.ts")) as {
    uninstallRegistrations: (
      home: string,
      targets: ReadonlyArray<(typeof PLATFORMS)[number]>,
    ) => Array<{ platform: string; path: string }>;
  };
  const removed = uninstallRegistrations(home, [...PLATFORMS]);
  expect(removed).toHaveLength(8);
  expect(listRegisteredPlatforms(home)).toEqual([]);

  const dataDir = mkdtempSync(join(tmpdir(), "wa-mcp-t98-purge-"));
  const { purgeDataDir } = (await import("../src/service.ts")) as {
    purgeDataDir: (
      dataDir: string,
      opts: { yes: boolean; readLine: () => string },
    ) => { purged: boolean; message: string };
  };
  const refused = purgeDataDir(dataDir, { yes: false, readLine: () => "n" });
  expect(refused.purged).toBe(false);
  expect(existsSync(dataDir)).toBe(true);
  const accepted = purgeDataDir(dataDir, { yes: false, readLine: () => "y" });
  expect(accepted.purged).toBe(true);
  expect(existsSync(dataDir)).toBe(false);
}, 15_000);

test("T98 update — reports the version and the tarball flow, no self-update", async () => {
  const { buildUpdateReport } = (await import("../src/service.ts")) as {
    buildUpdateReport: (version: string) => string;
  };
  const report = buildUpdateReport("0.9.0");
  expect(report).toContain("0.9.0");
  expect(report).toContain("pack-release.sh");
  expect(report).toContain("no self-update");
});
