import { chmodSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { PLATFORMS } from "@wa-mcp/shared";
import { createEventBus } from "../src/events.ts";
import { createHttpServer } from "../src/http.ts";
import type { BridgeHandle } from "../src/lifecycle.ts";
import {
  INSTALL_PROBES,
  defaultInstallEnv,
  detectInstalled,
  type InstallEnv,
} from "../src/installed.ts";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) {
    await fn();
  }
});

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "t188-installed-"));
  cleanups.push(() => rmSync(root, { recursive: true, force: true }));
  return root;
}

function bin(dir: string, name: string, executable = true): void {
  mkdirSync(dir, { recursive: true });
  const path = join(dir, name);
  writeFileSync(path, "#!/bin/sh\n");
  chmodSync(path, executable ? 0o755 : 0o644);
}

function app(dir: string, name: string): void {
  mkdirSync(join(dir, name, "Contents"), { recursive: true });
}

function fakeEnv(root: string, os: NodeJS.Platform = "darwin"): InstallEnv {
  return {
    os,
    appDirs: [join(root, "Applications"), join(root, "home", "Applications")],
    pathDirs: [join(root, "bin"), join(root, "home", ".local", "bin")],
  };
}

test("T188 P1 — every platform has a documented probe", () => {
  expect(Object.keys(INSTALL_PROBES).sort()).toEqual([...PLATFORMS].sort());
  expect(INSTALL_PROBES["claude-code"]).toEqual({ apps: [], bins: ["claude"] });
  expect(INSTALL_PROBES["claude-desktop"]).toEqual({ apps: ["Claude.app"], bins: [] });
  expect(INSTALL_PROBES.codex).toEqual({ apps: ["Codex.app"], bins: ["codex"] });
  expect(INSTALL_PROBES.pi).toEqual({ apps: [], bins: ["pi"] });
  expect(INSTALL_PROBES.grok).toEqual({ apps: ["Grok.app"], bins: ["grok"] });
  expect(INSTALL_PROBES.antigravity).toEqual({
    apps: ["Antigravity.app"],
    bins: ["antigravity", "agy"],
  });
});

test("T188 P1 — macOS: an app bundle or an executable CLI on the search path means installed", () => {
  const root = tempRoot();
  const env = fakeEnv(root);
  app(join(root, "Applications"), "Claude.app");
  app(join(root, "home", "Applications"), "Grok.app");
  bin(join(root, "bin"), "claude");
  bin(join(root, "home", ".local", "bin"), "agy");
  bin(join(root, "bin"), "codex", false);
  expect(detectInstalled("claude-desktop", env)).toBe(true);
  expect(detectInstalled("grok", env)).toBe(true);
  expect(detectInstalled("claude-code", env)).toBe(true);
  expect(detectInstalled("codex", env)).toBe(false);
  expect(detectInstalled("antigravity", env)).toBe(true);
  expect(detectInstalled("pi", env)).toBe(false);
});

test("T188 P1 — hook agents map onto their host app; unknown agents are null", () => {
  const root = tempRoot();
  const env = fakeEnv(root);
  bin(join(root, "bin"), "claude");
  expect(detectInstalled("claude", env)).toBe(true);
  expect(detectInstalled("codex", env)).toBe(false);
  expect(detectInstalled("mystery", env)).toBeNull();
});

test("T188 P1 — off macOS app bundles are unknowable: app-only hosts are null, CLIs still probe", () => {
  const root = tempRoot();
  const env = fakeEnv(root, "linux");
  app(join(root, "Applications"), "Claude.app");
  bin(join(root, "bin"), "grok");
  expect(detectInstalled("claude-desktop", env)).toBeNull();
  expect(detectInstalled("grok", env)).toBe(true);
  expect(detectInstalled("pi", env)).toBe(false);
});

test("T188 P1 — Windows resolves CLI shims by extension", () => {
  const root = tempRoot();
  const env = fakeEnv(root, "win32");
  bin(join(root, "bin"), "codex.cmd");
  expect(detectInstalled("codex", env)).toBe(true);
  expect(detectInstalled("pi", env)).toBe(false);
});

test("T188 P1 — the daemon's search path covers CLI homes launchd leaves off PATH", () => {
  const env = defaultInstallEnv("/Users/someone", {
    os: "darwin",
    path: "/usr/bin:/bin",
    execPath: "/Users/someone/.nvm/versions/node/v22/bin/node",
  });
  expect(env.os).toBe("darwin");
  expect(env.appDirs).toEqual(["/Applications", "/Users/someone/Applications"]);
  for (const dir of [
    "/usr/bin",
    "/bin",
    "/Users/someone/.nvm/versions/node/v22/bin",
    "/Users/someone/.local/bin",
    "/opt/homebrew/bin",
    "/usr/local/bin",
    "/Users/someone/.bun/bin",
    "/Users/someone/.npm-global/bin",
    "/Users/someone/.claude/local",
  ]) {
    expect(env.pathDirs).toContain(dir);
  }
  expect(new Set(env.pathDirs).size).toBe(env.pathDirs.length);
});

function stubHandle(): BridgeHandle {
  return {
    status: "connected",
    events: createEventBus(),
    close: async () => {},
    getLastQr: () => null,
    hasPairedAccount: () => true,
    pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
    resumePairing: () => {},
    connectionQuality: () => ({ reconnects: 0, lastDisconnectAt: null }),
    logout: async () => {},
    fetchHistory: async () => ({ requested: false, request_id: "" }),
    contactsWarm: () => true,
  } as unknown as BridgeHandle;
}

function put(path: string, text: string): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
}

test("T188 P1 — GET /api/connections carries installed per connection", async () => {
  const root = tempRoot();
  const home = join(root, "home");
  const entry = { mcpServers: { "wa-mcp": { command: "node", args: ["wa-mcp"] } } };
  put(join(home, ".claude.json"), JSON.stringify(entry));
  put(join(home, ".grok", "mcp.json"), JSON.stringify(entry));
  bin(join(root, "bin"), "claude");
  const bridge = await createHttpServer(stubHandle(), {
    token: "t188",
    homeDir: home,
    installEnv: fakeEnv(root),
  });
  cleanups.push(() => bridge.close());
  const res = await fetch(`http://127.0.0.1:${bridge.port}/api/connections`, {
    headers: { authorization: "Bearer t188" },
  });
  const body = (await res.json()) as {
    connections: Array<{ agent: string; installed: boolean | null }>;
  };
  expect(body.connections.map((c) => [c.agent, c.installed])).toEqual([
    ["claude-code", true],
    ["grok", false],
  ]);
});
