import { execFileSync, spawn } from "node:child_process";
import { createServer } from "node:net";
import {
  existsSync,
  mkdirSync,
  openSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join } from "node:path";
import { resolveConfigPath, type Platform } from "./platforms.ts";
import { removeTomlTable, removeYamlServer } from "./writers.ts";

export type SpawnFn = (
  command: string,
  args: readonly string[],
  options: { detached: boolean; stdio: ["ignore", number, number]; env: NodeJS.ProcessEnv },
) => { pid: number | undefined; unref: () => void };

export function isPortBusy(port: number, host = "127.0.0.1"): Promise<boolean> {
  return new Promise((resolve) => {
    const probe = createServer();
    probe.once("error", () => resolve(true));
    probe.once("listening", () => probe.close(() => resolve(false)));
    probe.listen(port, host);
  });
}

export interface StartDeps {
  bridgeBin: string;
  dataDir: string;
  port: string;
  logPath: string;
  spawnFn?: SpawnFn;
  envExtras?: Record<string, string>;
}

export interface StartResult {
  pid: number | undefined;
  logPath: string;
}

export interface StopResult {
  stopped: boolean;
  message: string;
}

export interface RestartResult extends StopResult {
  startedPid: number | undefined;
  logPath: string;
}

export interface PurgeResult {
  purged: boolean;
  message: string;
}

export function startDaemon(deps: StartDeps): StartResult {
  const spawnFn = (deps.spawnFn ?? spawn) as SpawnFn;
  mkdirSync(dirname(deps.logPath), { recursive: true });
  const logFd = openSync(deps.logPath, "a");
  const child = spawnFn(
    process.execPath,
    [deps.bridgeBin, "--data-dir", deps.dataDir, "--port", deps.port],
    {
      detached: true,
      stdio: ["ignore", logFd, logFd],
      env: { ...process.env, ...deps.envExtras },
    },
  );
  child.unref();
  return { pid: child.pid, logPath: deps.logPath };
}

export function stopDaemon(dataDir: string): StopResult {
  const lockPath = join(dataDir, "bridge.lock");
  if (!existsSync(lockPath)) {
    return { stopped: false, message: "bridge not running" };
  }
  const parsed = JSON.parse(readFileSync(lockPath, "utf8")) as { pid?: number };
  if (typeof parsed.pid !== "number") {
    return { stopped: false, message: "lockfile has no pid" };
  }
  try {
    process.kill(parsed.pid, "SIGTERM");
  } catch {
    return { stopped: false, message: `process ${parsed.pid} already gone` };
  }
  return { stopped: true, message: `sent SIGTERM to ${parsed.pid}` };
}

export function runRestart(deps: StartDeps): RestartResult {
  const stop = stopDaemon(deps.dataDir);
  const start = startDaemon(deps);
  return {
    stopped: stop.stopped,
    message: `${stop.message}; started (pid ${start.pid})`,
    startedPid: start.pid,
    logPath: start.logPath,
  };
}

export function readLogTail(logPath: string, lines: number): string {
  if (!existsSync(logPath)) {
    return "";
  }
  const all = readFileSync(logPath, "utf8").split("\n");
  if (all.at(-1) === "") {
    all.pop();
  }
  return all.slice(Math.max(0, all.length - lines)).join("\n");
}

export async function followLog(
  logPath: string,
  onData: (line: string) => void,
  opts: { intervalMs: number; maxPolls: number },
): Promise<void> {
  let offset = existsSync(logPath) ? readFileSync(logPath, "utf8").length : 0;
  for (let poll = 0; poll < opts.maxPolls; poll += 1) {
    if (existsSync(logPath)) {
      const content = readFileSync(logPath, "utf8");
      if (content.length > offset) {
        const fresh = content.slice(offset);
        offset = content.length;
        for (const line of fresh.split("\n")) {
          if (line.length > 0) {
            onData(line);
          }
        }
      }
    }
    await new Promise((resolve) => setTimeout(resolve, opts.intervalMs));
  }
}

export function startReport(pid: number, port: string, logPath: string): string[] {
  return [
    `bridge started (pid ${pid}); logs: ${logPath}`,
    `Web UI: http://127.0.0.1:${port} — open it to link WhatsApp`,
  ];
}

export function uninstallRegistrations(
  home: string,
  targets: ReadonlyArray<Platform>,
): Array<{ platform: Platform; path: string }> {
  const removed: Array<{ platform: Platform; path: string }> = [];
  for (const platform of targets) {
    const path = resolveConfigPath(platform, home);
    if (removeServerEntry(platform, home)) {
      removed.push({ platform, path });
    }
  }
  return removed;
}

export function purgeDataDir(
  dataDir: string,
  opts: { yes: boolean; readLine: () => string },
): PurgeResult {
  if (!existsSync(dataDir)) {
    return { purged: false, message: `nothing to remove: ${dataDir} does not exist` };
  }
  if (!opts.yes) {
    console.log(`about to delete the ENTIRE data directory: ${dataDir}`);
    for (const entry of listTree(dataDir)) {
      console.log(`  - ${entry}`);
    }
    console.log("type y to confirm:");
    const answer = opts.readLine().trim().toLowerCase();
    if (answer !== "y" && answer !== "yes") {
      return { purged: false, message: "purge aborted" };
    }
  }
  rmSync(dataDir, { recursive: true, force: true });
  return { purged: true, message: `removed ${dataDir}` };
}

export interface ServiceRenderDeps {
  nodePath: string;
  bridgeBin: string;
  dataDir: string;
  port: string;
}

export function renderLaunchdPlist(deps: ServiceRenderDeps): string {
  const logPath = `${deps.dataDir}/bridge.log`;
  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    '<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">',
    '<plist version="1.0">',
    "<dict>",
    "  <key>Label</key>",
    "  <string>com.wa-mcp.bridge</string>",
    "  <key>ProgramArguments</key>",
    "  <array>",
    `    <string>${deps.nodePath}</string>`,
    `    <string>${deps.bridgeBin}</string>`,
    "    <string>--data-dir</string>",
    `    <string>${deps.dataDir}</string>`,
    "    <string>--port</string>",
    `    <string>${deps.port}</string>`,
    "  </array>",
    "  <key>KeepAlive</key>",
    "  <true/>",
    "  <key>RunAtLoad</key>",
    "  <true/>",
    "  <key>StandardOutPath</key>",
    `  <string>${logPath}</string>`,
    "  <key>StandardErrorPath</key>",
    `  <string>${logPath}</string>`,
    "</dict>",
    "</plist>",
    "",
  ].join("\n");
}

export function renderSystemdUnit(deps: ServiceRenderDeps): string {
  const logPath = `${deps.dataDir}/bridge.log`;
  return [
    "[Unit]",
    "Description=wa-mcp bridge",
    "After=network-online.target",
    "",
    "[Service]",
    "Type=simple",
    `ExecStart=${deps.nodePath} ${deps.bridgeBin} --data-dir ${deps.dataDir} --port ${deps.port}`,
    "Restart=always",
    "RestartSec=5",
    `StandardOutput=append:${logPath}`,
    `StandardError=append:${logPath}`,
    "",
    "[Install]",
    "WantedBy=default.target",
    "",
  ].join("\n");
}

export function serviceInstallDir(home: string): string {
  if (process.platform === "linux") {
    return join(home, ".config", "systemd", "user");
  }
  return join(home, "Library", "LaunchAgents");
}

export function serviceFileName(): string {
  return process.platform === "linux" ? "wa-mcp.service" : "com.wa-mcp.bridge.plist";
}

export interface ServiceInstallResult {
  path: string;
  loadCommand: string;
  loaded: boolean;
}

export function installService(deps: {
  home: string;
  nodePath: string;
  bridgeBin: string;
  dataDir: string;
  port: string;
  loadFn?: (cmd: string, args: string[]) => void;
}): ServiceInstallResult {
  const targetDir = serviceInstallDir(deps.home);
  mkdirSync(targetDir, { recursive: true });
  const path = join(targetDir, serviceFileName());
  const content = process.platform === "linux" ? renderSystemdUnit(deps) : renderLaunchdPlist(deps);
  writeFileSync(path, content, { mode: 0o600 });
  const isLinux = process.platform === "linux";
  const loadCommand = isLinux
    ? "systemctl --user enable --now wa-mcp.service"
    : `launchctl load ${path}`;
  if (process.env.WA_CLI_NO_SERVICE_LOAD === "1") {
    return { path, loadCommand, loaded: false };
  }
  if (!isLinux) {
    try {
      const loadFn = deps.loadFn ?? execFileSync;
      loadFn("launchctl", ["load", path]);
    } catch {
      console.log(`launchctl load failed - run manually: ${loadCommand}`);
    }
  }
  return { path, loadCommand, loaded: !isLinux };
}

export function uninstallService(deps: {
  home: string;
  unloadFn?: (cmd: string, args: string[]) => void;
}): ServiceInstallResult {
  const path = join(serviceInstallDir(deps.home), serviceFileName());
  const unloadCommand =
    process.platform === "linux"
      ? "systemctl --user disable --now wa-mcp.service"
      : `launchctl unload ${path}`;
  if (process.env.WA_CLI_NO_SERVICE_LOAD !== "1" && process.platform !== "linux") {
    try {
      const unloadFn = deps.unloadFn ?? execFileSync;
      unloadFn("launchctl", ["unload", path]);
    } catch {
      console.log("launchctl unload skipped (not loaded or unavailable)");
    }
  }
  if (existsSync(path)) {
    rmSync(path, { force: true });
  }
  return { path, loadCommand: unloadCommand, loaded: false };
}

export function buildUpdateReport(version: string): string {
  return [
    `wa-mcp ${version}`,
    "no self-update by design — the daemon owns live state a hot swap could corrupt",
    "to refresh: run scripts/pack-release.sh, then reinstall from the produced tarball",
  ].join("\n");
}

function removeServerEntry(platform: Platform, home: string): boolean {
  const path = resolveConfigPath(platform, home);
  if (!existsSync(path)) {
    return false;
  }
  if (platform === "pi") {
    const legacy = join(home, ".pi", "mcp", "wa-mcp.json");
    const hadLegacy = existsSync(legacy);
    const removedMain = removeJsonKeyEntry(path);
    rmSync(legacy, { force: true });
    return removedMain || hadLegacy;
  }
  const text = readFileSync(path, "utf8");
  let updated: string;
  if (platform === "codex") {
    updated = removeTomlTable(text, "mcp_servers.wa-mcp");
  } else if (platform === "hermes") {
    updated = removeYamlServer(text, "wa-mcp");
  } else {
    if (!removeJsonKeyEntry(path)) {
      return false;
    }
    return true;
  }
  if (updated === text) {
    return false;
  }
  writeFileSync(path, updated, { mode: 0o600 });
  return true;
}

function removeJsonKeyEntry(path: string): boolean {
  const text = readFileSync(path, "utf8");
  try {
    const parsed: unknown = JSON.parse(text);
    if (parsed === null || typeof parsed !== "object") {
      return false;
    }
    const record = parsed as Record<string, unknown>;
    let touched = false;
    for (const key of Object.keys(record)) {
      const container = record[key];
      if (
        container !== null &&
        typeof container === "object" &&
        "wa-mcp" in (container as Record<string, unknown>)
      ) {
        delete (container as Record<string, unknown>)["wa-mcp"];
        touched = true;
      }
    }
    if (!touched) {
      return false;
    }
    writeFileSync(path, `${JSON.stringify(record, null, 2)}\n`, { mode: 0o600 });
    return true;
  } catch {
    return false;
  }
}

function joinPath(parent: string, entry: string): string {
  return parent.endsWith("/") ? `${parent}${entry}` : `${parent}/${entry}`;
}

function listTree(dir: string): string[] {
  const out: string[] = [];
  const stack = [dir];
  while (stack.length > 0) {
    const current = stack.pop() as string;
    let entries: string[] = [];
    try {
      entries = readdirSync(current).sort();
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = joinPath(current, entry);
      out.push(full);
      let isDir = false;
      try {
        isDir = statSync(full).isDirectory();
      } catch {
        isDir = false;
      }
      if (isDir) {
        stack.push(full);
      }
    }
  }
  return out;
}
