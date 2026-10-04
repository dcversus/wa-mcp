import { existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { main } from "../src/bin.ts";

process.env.WA_CLI_NO_SERVICE_LOAD = "1";

function tmpHome(): string {
  return mkdtempSync(join(tmpdir(), "wa-mcp-t103-home-"));
}

test("T103 — renderLaunchdPlist renders the launchd unit with resolved paths", async () => {
  const { renderLaunchdPlist } = (await import("../src/service.ts")) as {
    renderLaunchdPlist: (deps: {
      nodePath: string;
      bridgeBin: string;
      dataDir: string;
      port: string;
    }) => string;
  };
  const plist = renderLaunchdPlist({
    nodePath: "/usr/local/bin/node",
    bridgeBin: "/repo/packages/bridge/dist/bin.mjs",
    dataDir: "/Users/x/.wa-mcp",
    port: "8080",
  });
  expect(plist).toContain("<key>Label</key>");
  expect(plist).toContain("<string>com.wa-mcp.bridge</string>");
  expect(plist).toContain("<key>KeepAlive</key>");
  expect(plist).toContain("<key>RunAtLoad</key>");
  expect(plist).toContain("/usr/local/bin/node");
  expect(plist).toContain("/repo/packages/bridge/dist/bin.mjs");
  expect(plist).toContain("/Users/x/.wa-mcp/bridge.log");
});

test("T103 — renderSystemdUnit renders the user unit", async () => {
  const { renderSystemdUnit } = (await import("../src/service.ts")) as {
    renderSystemdUnit: (deps: {
      nodePath: string;
      bridgeBin: string;
      dataDir: string;
      port: string;
    }) => string;
  };
  const unit = renderSystemdUnit({
    nodePath: "/usr/bin/node",
    bridgeBin: "/repo/packages/bridge/dist/bin.mjs",
    dataDir: "/home/u/.wa-mcp",
    port: "8080",
  });
  expect(unit).toContain("[Unit]");
  expect(unit).toContain("[Service]");
  expect(unit).toContain("Restart=always");
  expect(unit).toContain("ExecStart=/usr/bin/node /repo/packages/bridge/dist/bin.mjs");
  expect(unit).toContain("[Install]");
  expect(unit).toContain("WantedBy=default.target");
});

test("T103 — install --service writes the plist into the user LaunchAgents dir", async () => {
  process.env.WA_CLI_TEST_HOME = tmpHome();
  const home = process.env.WA_CLI_TEST_HOME as string;
  const dataDir = mkdtempSync(join(tmpdir(), "wa-mcp-t103-data-"));
  await main(["install", "--service", "--home", home, "--data-dir", dataDir, "--port", "8080"]);
  const plistPath = join(home, "Library", "LaunchAgents", "com.wa-mcp.bridge.plist");
  expect(existsSync(plistPath)).toBe(true);
  const plist = readFileSync(plistPath, "utf8");
  expect(plist).toContain(process.execPath);
  expect(plist).toContain(join(dataDir, "bridge.log"));
});

test("T103 — uninstall --service --remove unloads and removes the plist", async () => {
  const home = tmpHome();
  const plistPath = join(home, "Library", "LaunchAgents", "com.wa-mcp.bridge.plist");
  mkdirSync(dirname(plistPath), { recursive: true });
  writeFileSync(plistPath, "<plist/>");
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await main(["uninstall", "--service", "--remove", "--home", home]);
    expect(existsSync(plistPath)).toBe(false);
    const printed = logSpy.mock.calls.map((call) => call.join(" ")).join("\n");
    expect(printed).toContain("launchctl unload");
  } finally {
    logSpy.mockRestore();
  }
});

test("T103 — parseArgs treats --service as a boolean flag", async () => {
  const { parseArgs } = (await import("../src/commands.ts")) as {
    parseArgs: (argv: string[]) => { command: string; flags: Record<string, string> };
  };
  const parsed = parseArgs(["install", "--service", "--home", "/h"]);
  expect(parsed.flags.service).toBe("");
  expect(parsed.flags.home).toBe("/h");
  const removed = parseArgs(["uninstall", "--service", "--remove", "--home", "/h"]);
  expect(removed.flags.service).toBe("");
  expect(removed.flags.remove).toBe("");
});
