import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { resolveConfigPath } from "@wa-mcp/shared";
import {
  ensureClaudeCertTrust,
  removeClaudeCertTrust,
} from "../src/cert-trust.ts";
import { HTTP_PLATFORMS, writeServerEntry, type Platform } from "../src/writers.ts";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) rmSync(home, { recursive: true, force: true });
});
function fakeHome(): string {
  const home = mkdtempSync(join(tmpdir(), "wa-mcp-t205-"));
  homes.push(home);
  return home;
}

const URL_S = "https://127.0.0.1:27777/mcp";
const STDIO = {
  command: "node",
  args: ["/opt/wa-mcp/bin.mjs", "--bridge-url", "http://127.0.0.1:27777", "--token", "tok"],
  env: { WA_TOKEN: "tok" },
};
const http = { url: URL_S, token: "tok" };
const headers = (agent: string) => ({ Authorization: "Bearer tok", "X-WA-Agent": agent });
const readJson = (path: string) => JSON.parse(readFileSync(path, "utf8")) as Record<string, any>;

test("the hosts that can use a URL are exactly the documented ones", () => {
  expect([...HTTP_PLATFORMS].sort()).toEqual(["antigravity", "claude-code", "codex", "pi"]);
});

test("Claude Code gets type http + url + headers and nothing that spawns a process", () => {
  const home = fakeHome();
  const result = writeServerEntry("claude-code", { home, spec: STDIO, http });
  expect(result.verified).toBe(true);
  expect(readJson(result.path).mcpServers["wa-mcp"]).toEqual({
    type: "http",
    url: URL_S,
    headers: headers("claude-code"),
  });
});

test("Antigravity gets serverUrl + headers", () => {
  const home = fakeHome();
  const result = writeServerEntry("antigravity", { home, spec: STDIO, http });
  expect(result.verified).toBe(true);
  expect(readJson(result.path).mcpServers["wa-mcp"]).toEqual({
    serverUrl: URL_S,
    headers: headers("antigravity"),
  });
});

test("pi gets the streamable-http transport", () => {
  const home = fakeHome();
  const result = writeServerEntry("pi", { home, spec: STDIO, http });
  expect(result.verified).toBe(true);
  expect(readJson(result.path).mcpServers["wa-mcp"]).toEqual({
    transport: "streamable-http",
    lifecycle: "eager",
    url: URL_S,
    headers: headers("pi"),
  });
});

test("Codex gets url + http_headers in its table", () => {
  const home = fakeHome();
  const result = writeServerEntry("codex", { home, spec: STDIO, http });
  expect(result.verified).toBe(true);
  const text = readFileSync(result.path, "utf8");
  expect(text).toContain(`[mcp_servers.wa-mcp]\nurl = "${URL_S}"\n`);
  expect(text).toContain(
    'http_headers = { "Authorization" = "Bearer tok", "X-WA-Agent" = "codex" }',
  );
  expect(text).not.toContain("command");
});

test.each(["claude-desktop", "grok"] as Platform[])(
  "%s stays on stdio even when a URL is offered",
  (platform) => {
    const home = fakeHome();
    const result = writeServerEntry(platform, { home, spec: STDIO, http });
    const entry = readJson(result.path).mcpServers["wa-mcp"];
    expect(entry.command).toBe("node");
    expect(entry.url).toBeUndefined();
  },
);

test.each(["claude-code", "antigravity", "pi"] as Platform[])(
  "migrating %s replaces the old stdio entry and keeps everything else",
  (platform) => {
    const home = fakeHome();
    const path = resolveConfigPath(platform, home);
    mkdirSync(dirname(path), { recursive: true });
    writeFileSync(
      path,
      JSON.stringify({
        keepMe: 1,
        mcpServers: {
          other: { command: "x" },
          "wa-mcp": { type: "stdio", ...STDIO, serverUrl: "http://old/mcp" },
        },
      }),
    );
    writeServerEntry(platform, { home, spec: STDIO, http });
    const parsed = readJson(path);
    expect(parsed.keepMe).toBe(1);
    expect(parsed.mcpServers.other).toEqual({ command: "x" });
    const entry = parsed.mcpServers["wa-mcp"];
    expect(entry.command).toBeUndefined();
    expect(entry.args).toBeUndefined();
    expect(entry.env).toBeUndefined();
  },
);

test("migrating Codex replaces the old table and leaves other servers alone", () => {
  const home = fakeHome();
  const path = resolveConfigPath("codex", home);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    '[mcp_servers.wa-mcp]\ncommand = "node"\nargs = ["/opt/bin.mjs"]\n\n[mcp_servers.other]\ncommand = "npx"\n',
  );
  writeServerEntry("codex", { home, spec: STDIO, http });
  const text = readFileSync(path, "utf8");
  expect(text).not.toContain("/opt/bin.mjs");
  expect(text).toContain("[mcp_servers.other]");
});

test("without a URL the old stdio form is still written (install --stdio)", () => {
  const home = fakeHome();
  const result = writeServerEntry("claude-code", { home, spec: STDIO });
  expect(readJson(result.path).mcpServers["wa-mcp"].type).toBe("stdio");
});

const CERT = "/data/tls/cert.pem";
const settingsPath = (home: string) => join(home, ".claude", "settings.json");

test("trust is added to Claude Code settings, keeping what's there", () => {
  const home = fakeHome();
  mkdirSync(join(home, ".claude"));
  writeFileSync(settingsPath(home), JSON.stringify({ model: "x", env: { FOO: "1" } }));
  expect(ensureClaudeCertTrust(home, CERT, {})).toEqual({ status: "added" });
  expect(readJson(settingsPath(home))).toEqual({
    model: "x",
    env: { FOO: "1", NODE_EXTRA_CA_CERTS: CERT },
  });
  expect(ensureClaudeCertTrust(home, CERT, {})).toEqual({ status: "present" });
});

test("trust creates the settings file when there is none", () => {
  const home = fakeHome();
  expect(ensureClaudeCertTrust(home, CERT, {}).status).toBe("added");
  expect(readJson(settingsPath(home)).env.NODE_EXTRA_CA_CERTS).toBe(CERT);
});

test("someone else's CA setting is never overwritten", () => {
  const home = fakeHome();
  mkdirSync(join(home, ".claude"));
  writeFileSync(settingsPath(home), JSON.stringify({ env: { NODE_EXTRA_CA_CERTS: "/corp.pem" } }));
  expect(ensureClaudeCertTrust(home, CERT, {})).toEqual({ status: "conflict", current: "/corp.pem" });
  expect(readJson(settingsPath(home)).env.NODE_EXTRA_CA_CERTS).toBe("/corp.pem");
});

test("a CA set in the shell counts as a conflict too", () => {
  const home = fakeHome();
  expect(ensureClaudeCertTrust(home, CERT, { NODE_EXTRA_CA_CERTS: "/corp.pem" })).toEqual({
    status: "conflict",
    current: "/corp.pem",
  });
  expect(existsSync(settingsPath(home))).toBe(false);
});

test("settings that don't parse are left untouched", () => {
  const home = fakeHome();
  mkdirSync(join(home, ".claude"));
  writeFileSync(settingsPath(home), "{ not json");
  expect(ensureClaudeCertTrust(home, CERT, {}).status).toBe("unreadable");
  expect(readFileSync(settingsPath(home), "utf8")).toBe("{ not json");
});

test("uninstall removes only our own trust entry", () => {
  const home = fakeHome();
  ensureClaudeCertTrust(home, CERT, {});
  expect(removeClaudeCertTrust(home, CERT)).toBe(true);
  expect(readJson(settingsPath(home)).env).toBeUndefined();

  writeFileSync(settingsPath(home), JSON.stringify({ env: { NODE_EXTRA_CA_CERTS: "/corp.pem" } }));
  expect(removeClaudeCertTrust(home, CERT)).toBe(false);
  expect(readJson(settingsPath(home)).env.NODE_EXTRA_CA_CERTS).toBe("/corp.pem");
});
