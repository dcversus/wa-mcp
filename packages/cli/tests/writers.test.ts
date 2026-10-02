import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { listRegisteredPlatforms, writeServerEntry, type Platform } from "../src/writers.ts";

const SPEC = { command: "node", args: ["/opt/wa-mcp/mcp-server/bin.mjs"], env: { WA_TOKEN: "tok" } };

function fakeHome(): string {
  const dir = join(tmpdir(), `wa-mcp-cli-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

test("every platform writer verifies its own write", () => {
  const home = fakeHome();
  for (const platform of Object.keys(PLATFORM_SHAPE) as Platform[]) {
    const result = writeServerEntry(platform, { home, spec: SPEC });
    expect(result.verified, platform).toBe(true);
    expect(existsSync(result.path), platform).toBe(true);
  }
});

const PLATFORM_SHAPE: Record<Platform, () => void> = {
  "claude-code": () => {},
  "claude-desktop": () => {},
  cursor: () => {},
  grok: () => {},
  antigravity: () => {},
  pi: () => {},
  codex: () => {},
  hermes: () => {},
};

test("json platforms merge into existing config without dupes", () => {
  const home = fakeHome();
  const claudeJson = join(home, ".claude.json");
  writeFileSync(claudeJson, JSON.stringify({ otherSetting: true, mcpServers: { other: { command: "x" } } }));
  writeServerEntry("claude-code", { home, spec: SPEC });
  writeServerEntry("claude-code", { home, spec: SPEC });
  const parsed = JSON.parse(readFileSync(claudeJson, "utf8")) as {
    otherSetting: boolean;
    mcpServers: Record<string, unknown>;
  };
  expect(parsed.otherSetting).toBe(true);
  expect(parsed.mcpServers.other).toBeDefined();
  expect(Object.keys(parsed.mcpServers).filter((key) => key === "wa-mcp")).toHaveLength(1);
  expect(parsed.mcpServers["wa-mcp"]).toMatchObject({ command: "node" });
});

test("codex toml gets a wa-mcp table and stays parseable on re-write", () => {
  const home = fakeHome();
  writeServerEntry("codex", { home, spec: SPEC });
  writeServerEntry("codex", { home, spec: SPEC });
  const text = readFileSync(join(home, ".codex", "config.toml"), "utf8");
  expect(text).toContain("[mcp_servers.wa-mcp]");
  expect(text).toContain('command = "node"');
  expect(text.match(/\[mcp_servers\.wa-mcp\]/g)).toHaveLength(1);
});

test("hermes yaml gets mcp_servers.wa-mcp and preserves other keys", () => {
  const home = fakeHome();
  const config = join(home, ".hermes", "config.yaml");
  mkdirSync(join(home, ".hermes"), { recursive: true });
  writeFileSync(config, "platform_toolsets:\n  cli:\n    - browser\n");
  writeServerEntry("hermes", { home, spec: SPEC });
  const text = readFileSync(config, "utf8");
  expect(text).toContain("platform_toolsets:");
  expect(text).toContain("mcp_servers:");
  expect(text).toContain("wa-mcp:");
  expect(text).toContain("command: node");
});

test("antigravity carries command and args keys", () => {
  const home = fakeHome();
  writeServerEntry("antigravity", { home, spec: SPEC });
  const parsed = JSON.parse(readFileSync(join(home, ".gemini", "antigravity", "mcp_config.json"), "utf8")) as {
    mcpServers: { "wa-mcp": { command?: string; serverUrl?: string } };
  };
  expect(parsed.mcpServers["wa-mcp"].command).toBe("node");
});

test("listRegisteredPlatforms reports verified installs", () => {
  const home = fakeHome();
  expect(listRegisteredPlatforms(home)).toEqual([]);
  writeServerEntry("cursor", { home, spec: SPEC });
  expect(listRegisteredPlatforms(home)).toEqual(["cursor"]);
});
