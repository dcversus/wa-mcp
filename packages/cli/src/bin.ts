#!/usr/bin/env node
import { existsSync, readFileSync, realpathSync } from "node:fs";
import { dirname, join } from "node:path";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import { buildStatusSummary, parseArgs } from "./commands.ts";
import { installService, isPortBusy, uninstallService } from "./service.ts";
import {
  buildUpdateReport,
  followLog,
  purgeDataDir,
  readLogTail,
  runRestart,
  startDaemon,
  stopDaemon,
  uninstallRegistrations,
} from "./service.ts";
import { runDoctor } from "./doctor.ts";
import { installSkills } from "./skills.ts";
import { runPair } from "./pair.ts";
import { runImport } from "./import-store.ts";
import { PLATFORMS } from "./platforms.ts";
import { listRegisteredPlatforms, writeServerEntry } from "./writers.ts";

const DEFAULT_DATA_DIR = join(process.env.HOME ?? "", ".wa-mcp");

const req = createRequire(import.meta.url);

function packageDir(name: string): string {
  return dirname(req.resolve(`${name}/package.json`));
}

const BRIDGE_BIN = join(packageDir("@wa-mcp/bridge"), "dist", "bin.mjs");
const MCP_BIN = join(packageDir("@wa-mcp/mcp-server"), "dist", "bin.mjs");
const BRIDGE_WEB = join(packageDir("@wa-mcp/bridge"), "dist", "web");
const SKILLS_SOURCE = join(packageDir("@wa-mcp/cli"), "skills", "wa-mcp");

export async function main(argv: string[]): Promise<void> {
  const { command, flags, positionals } = parseArgs(argv);
  const home = flags.home ?? process.env.HOME ?? "";
  const dataDir = flags["data-dir"] ?? DEFAULT_DATA_DIR;
  const bridgeUrl = flags["bridge-url"] ?? `http://127.0.0.1:${flags.port ?? 8080}`;
  if (command === "install" && flags.service !== undefined) {
    if (await isPortBusy(Number(flags.port ?? "8080"))) {
      console.error(
        `PORT_IN_USE: something is already listening on ${flags.port ?? "8080"} - a bridge may be running; stop it with wa-mcp stop`,
      );
      process.exitCode = 1;
      return;
    }
    const result = installService({
      home,
      nodePath: process.execPath,
      bridgeBin: BRIDGE_BIN,
      dataDir,
      port: flags.port ?? "8080",
    });
    console.log(`wrote ${result.path}`);
    console.log(
      result.loaded ? `loaded: ${result.loadCommand}` : `enable with: ${result.loadCommand}`,
    );
    return;
  }
  if (command === "install") {
    const token = flags.token ?? readToken(dataDir) ?? "";
    const spec = {
      command: process.execPath,
      args: [MCP_BIN, "--bridge-url", bridgeUrl, "--token", token],
      env: { WA_TOKEN: token },
    };
    const targets = (flags.target !== undefined ? [flags.target] : [...PLATFORMS]) as Array<string>;
    let failures = 0;
    for (const target of targets) {
      if (!PLATFORMS.includes(target as never)) {
        console.error(`unknown target: ${target}`);
        failures += 1;
        continue;
      }
      const result = writeServerEntry(target as never, { home, spec });
      console.log(
        `${result.platform}: ${result.path} ${result.verified ? "verified" : "VERIFY FAILED"}`,
      );
      if (!result.verified) {
        failures += 1;
      }
    }
    const skills = installSkills({ home, sourceDir: SKILLS_SOURCE, dataDir });
    console.log(`skills installed: ${skills.skillDir}`);
    if (failures > 0) {
      process.exitCode = 1;
    }
    return;
  }
  if (command === "uninstall" && flags.service !== undefined) {
    const result = uninstallService({ home });
    console.log(`unloaded: ${result.loadCommand}`);
    console.log(`removed: ${result.path}`);
    return;
  }
  if (command === "import") {
    const from = flags.from as import("../src/import-store.ts").SourceLayout | undefined;
    const path = flags.path as string | undefined;
    if (from !== "lharries" && from !== "gofork") {
      console.error("import: --from must be lharries or gofork");
      process.exitCode = 1;
      return;
    }
    if (path === undefined) {
      console.error("import: --path is required");
      process.exitCode = 1;
      return;
    }
    runImport({
      from,
      path,
      dataDir: (flags["data-dir"] as string | undefined) ?? DEFAULT_DATA_DIR,
      dryRun: flags["dry-run"] === "true" || flags["dry-run"] === "",
    });
    return;
  }
  if (command === "pair") {
    const token = flags.token ?? readToken(DEFAULT_DATA_DIR) ?? "";
    if (token.length === 0) {
      console.error("no bridge token found — start the bridge once or pass --token");
      process.exitCode = 1;
      return;
    }
    try {
      const exit = await runPair({
        baseUrl: flags["bridge-url"] ?? `http://127.0.0.1:${flags.port ?? 8080}`,
        token,
        timeoutMs: flags.timeout !== undefined ? Number(flags.timeout) : undefined,
        codePhone: flags.code,
        print: console.log,
      });
      if (exit !== 0) {
        process.exitCode = exit;
      }
    } catch (err) {
      console.error(`pair failed: ${err instanceof Error ? err.message : String(err)}`);
      process.exitCode = 1;
    }
    return;
  }
  if (command === "skills" && positionals[0] === "install") {
    const result = installSkills({ home, sourceDir: SKILLS_SOURCE, dataDir });
    console.log(`skills installed: ${result.skillDir}`);
    console.log(`command: ${result.commandFile}`);
    return;
  }
  if (command === "doctor") {
    const report = await runDoctor({ home, dataDir, bridgeUrl, minNodeMajor: 22 });
    for (const check of report.checks) {
      console.log(`${check.ok ? "ok" : "FAIL"}  ${check.name}: ${check.detail}`);
    }
    const registered = listRegisteredPlatforms(home);
    console.log(`registered platforms: ${registered.length > 0 ? registered.join(", ") : "none"}`);
    if (!report.ok) {
      process.exitCode = 1;
    }
    return;
  }
  if (command === "status") {
    try {
      const response = await fetch(`${bridgeUrl}/health`);
      const summary = buildStatusSummary(
        (await response.json()) as Record<string, never> & {
          connected?: boolean;
          loggedIn?: boolean;
          version?: string;
          uptime?: number;
        },
      );
      console.log(
        `bridge ${summary.connected ? "connected" : "not connected"} | loggedIn=${String(summary.loggedIn)} | v${summary.version} | uptime ${summary.uptimeSeconds}s`,
      );
      return;
    } catch (err) {
      console.error(
        `bridge unreachable at ${bridgeUrl}: ${err instanceof Error ? err.message : String(err)}`,
      );
      process.exitCode = 1;
      return;
    }
  }
  if (command === "start") {
    if (await isPortBusy(Number(flags.port ?? "8080"))) {
      console.error(
        `PORT_IN_USE: something is already listening on ${flags.port ?? "8080"} - a bridge may be running; stop it with wa-mcp stop`,
      );
      process.exitCode = 1;
      return;
    }
    if (!existsSync(BRIDGE_BIN)) {
      console.error(`bridge entry not found: ${BRIDGE_BIN}`);
      process.exitCode = 1;
      return;
    }
    const logPath = join(dataDir, "bridge.log");
    const started = startDaemon({
      bridgeBin: BRIDGE_BIN,
      dataDir,
      port: flags.port ?? "8080",
      logPath,
    });
    console.log(`bridge started (pid ${started.pid}); logs: ${logPath}`);
    return;
  }
  if (command === "stop") {
    console.log(stopDaemon(dataDir).message);
    return;
  }
  if (command === "restart") {
    if (!existsSync(BRIDGE_BIN)) {
      console.error(`bridge entry not found: ${BRIDGE_BIN}`);
      process.exitCode = 1;
      return;
    }
    const logPath = join(dataDir, "bridge.log");
    const result = runRestart({
      bridgeBin: BRIDGE_BIN,
      dataDir,
      port: flags.port ?? "8080",
      logPath,
      envExtras: { WA_UI_DIR: BRIDGE_WEB },
    });
    console.log(`restart: ${result.message}`);
    if (!result.stopped) {
      process.exitCode = 1;
    }
    return;
  }
  if (command === "logs") {
    const logPath = join(dataDir, "bridge.log");
    if (!existsSync(logPath)) {
      console.log(`no daemon log at ${logPath} — start the bridge first`);
      return;
    }
    if (flags.follow !== undefined) {
      void followLog(logPath, (line) => console.log(line), {
        intervalMs: 500,
        maxPolls: Number.MAX_SAFE_INTEGER,
      });
      return;
    }
    const tail = readLogTail(logPath, 50);
    console.log(tail.length > 0 ? tail : `(empty log) ${logPath}`);
    return;
  }
  if (command === "uninstall") {
    const targets = (flags.target !== undefined ? [flags.target] : [...PLATFORMS]) as Array<string>;
    const removed = uninstallRegistrations(
      home,
      targets.filter((target): target is (typeof PLATFORMS)[number] =>
        (PLATFORMS as readonly string[]).includes(target),
      ),
    );
    if (removed.length === 0) {
      console.log("no wa-mcp registrations found");
    }
    for (const entry of removed) {
      console.log(`removed ${entry.platform}: ${entry.path}`);
    }
    if (flags.purge !== undefined) {
      const result = purgeDataDir(dataDir, {
        yes: flags.yes !== undefined,
        readLine: () => {
          const chunk = process.stdin.read(1);
          return chunk ?? "";
        },
      });
      console.log(`purge: ${result.message}`);
      if (!result.purged) {
        process.exitCode = 1;
      }
    } else {
      console.log(`data dir kept: ${dataDir} (pass --purge to remove it)`);
    }
    return;
  }
  if (command === "update") {
    const version = JSON.parse(
      readFileSync(join(packageDir("@wa-mcp/cli"), "package.json"), "utf8"),
    ) as { version?: string };
    console.log(buildUpdateReport(version.version ?? "unknown"));
    return;
  }
  console.log(
    `wa-mcp — usage: wa-mcp <install|pair|doctor|status|start|stop|restart|logs|uninstall|update|skills> [--service [--remove]] [--target ...] [--home ...] [--data-dir ...] [--bridge-url ...] [--port ...] [--token ...] [--code ...] [--follow] [--purge] [--yes]`,
  );
}

function readToken(dataDir: string): string | null {
  const tokenPath = join(dataDir, "token");
  if (!existsSync(tokenPath)) {
    return null;
  }
  return readFileSync(tokenPath, "utf8").trim();
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  void main(process.argv.slice(2));
}
