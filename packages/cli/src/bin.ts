#!/usr/bin/env node
import { spawn } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { buildStatusSummary, parseArgs } from "./commands.ts";
import { runDoctor } from "./doctor.ts";
import { installSkills } from "./skills.ts";
import { PLATFORMS } from "./platforms.ts";
import { listRegisteredPlatforms, writeServerEntry } from "./writers.ts";

const DEFAULT_DATA_DIR = join(process.env.HOME ?? "", ".wa-mcp");

function bridgeProcessPath(): string {
  return fileURLToPath(new URL("../../bridge/dist/bin.mjs", import.meta.url));
}

async function main(argv: string[]): Promise<void> {
  const { command, flags, positionals } = parseArgs(argv);
  const home = flags.home ?? process.env.HOME ?? "";
  const dataDir = flags["data-dir"] ?? DEFAULT_DATA_DIR;
  const bridgeUrl = flags["bridge-url"] ?? `http://127.0.0.1:${flags.port ?? 8080}`;
  if (command === "install") {
    const spec = {
      command: process.execPath,
      args: [
        bridgeProcessPath(),
        "--bridge-url",
        bridgeUrl,
        "--token",
        flags.token ?? readToken(dataDir) ?? "",
      ],
      env: { WA_TOKEN: flags.token ?? readToken(dataDir) ?? "" },
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
    if (failures > 0) {
      process.exitCode = 1;
    }
    return;
  }
  if (command === "skills" && positionals[0] === "install") {
    const cliRoot = fileURLToPath(new URL("../../..", import.meta.url));
    const result = installSkills({ home, sourceDir: join(cliRoot, "skills", "wa-mcp") });
    console.log(`skills installed: ${result.skillDir}`);
    console.log(`command: ${result.commandFile}`);
    return;
  }
  if (command === "doctor") {
    const report = await runDoctor({ home, dataDir, bridgeUrl, minNodeMajor: 20 });
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
    const entry = bridgeProcessPath();
    if (!existsSync(entry)) {
      console.error(`bridge entry not found: ${entry}`);
      process.exitCode = 1;
      return;
    }
    const child = spawn(
      process.execPath,
      [entry, "--data-dir", dataDir, "--port", flags.port ?? "8080"],
      {
        detached: true,
        stdio: "ignore",
      },
    );
    child.unref();
    console.log(`bridge started (pid ${child.pid})`);
    return;
  }
  if (command === "stop") {
    const lockPath = join(dataDir, "bridge.lock");
    if (!existsSync(lockPath)) {
      console.log("bridge not running");
      return;
    }
    const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: number };
    if (typeof parsed.pid === "number") {
      process.kill(parsed.pid, "SIGTERM");
      console.log(`sent SIGTERM to ${parsed.pid}`);
      return;
    }
    console.log("lockfile has no pid");
    return;
  }
  console.log(
    `wa-mcp — usage: wa-mcp <install|doctor|status|start|stop> [--target ...] [--home ...] [--data-dir ...] [--bridge-url ...] [--port ...] [--token ...]`,
  );
}

function readToken(dataDir: string): string | null {
  const tokenPath = join(dataDir, "token");
  if (!existsSync(tokenPath)) {
    return null;
  }
  return readFileSync(tokenPath, "utf8").trim();
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main(process.argv.slice(2));
}
