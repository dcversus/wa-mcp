import { accessSync, constants, existsSync, statSync } from "node:fs";
import { delimiter, dirname, join } from "node:path";
import type { Platform } from "@wa-mcp/shared";

export interface InstallProbe {
  apps: string[];
  bins: string[];
}

export interface InstallEnv {
  os: NodeJS.Platform;
  appDirs: string[];
  pathDirs: string[];
}

export const INSTALL_PROBES: Record<Platform, InstallProbe> = {
  "claude-code": { apps: [], bins: ["claude"] },
  "claude-desktop": { apps: ["Claude.app"], bins: [] },
  codex: { apps: ["Codex.app"], bins: ["codex"] },
  pi: { apps: [], bins: ["pi"] },
  grok: { apps: ["Grok.app"], bins: ["grok"] },
  antigravity: { apps: ["Antigravity.app"], bins: ["antigravity", "agy"] },
};

const HOOK_HOSTS: Record<string, Platform> = { claude: "claude-code" };

const WINDOWS_SUFFIXES = ["", ".exe", ".cmd", ".bat"];

export function defaultInstallEnv(
  home: string,
  runtime: { os: NodeJS.Platform; path: string; execPath: string } = {
    os: process.platform,
    path: process.env.PATH ?? "",
    execPath: process.execPath,
  },
): InstallEnv {
  const pathDirs = [
    ...runtime.path.split(delimiter),
    dirname(runtime.execPath),
    join(home, ".local", "bin"),
    "/opt/homebrew/bin",
    "/usr/local/bin",
    join(home, ".bun", "bin"),
    join(home, ".npm-global", "bin"),
    join(home, ".claude", "local"),
  ].filter((dir) => dir.length > 0);
  return {
    os: runtime.os,
    appDirs: ["/Applications", join(home, "Applications")],
    pathDirs: [...new Set(pathDirs)],
  };
}

function isExecutable(path: string, os: NodeJS.Platform): boolean {
  try {
    if (!statSync(path).isFile()) {
      return false;
    }
    if (os !== "win32") {
      accessSync(path, constants.X_OK);
    }
    return true;
  } catch {
    return false;
  }
}

function onPath(bin: string, env: InstallEnv): boolean {
  const suffixes = env.os === "win32" ? WINDOWS_SUFFIXES : [""];
  return env.pathDirs.some((dir) =>
    suffixes.some((suffix) => isExecutable(join(dir, `${bin}${suffix}`), env.os)),
  );
}

export function detectInstalled(agent: string, env: InstallEnv): boolean | null {
  const platform = HOOK_HOSTS[agent] ?? agent;
  const probe = Object.hasOwn(INSTALL_PROBES, platform)
    ? INSTALL_PROBES[platform as Platform]
    : undefined;
  if (probe === undefined) {
    return null;
  }
  const appsKnowable = env.os === "darwin" && probe.apps.length > 0;
  if (!appsKnowable && probe.bins.length === 0) {
    return null;
  }
  if (
    appsKnowable &&
    probe.apps.some((name) => env.appDirs.some((dir) => existsSync(join(dir, name))))
  ) {
    return true;
  }
  return probe.bins.some((bin) => onPath(bin, env));
}
