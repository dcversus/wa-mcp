import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { uninstallRegistrations } from "../src/service.ts";

test("T148 — pi uninstall removes only the wa-mcp key and the legacy file", () => {
  const home = join(tmpdir(), `wa-mcp-cli-${Math.random().toString(36).slice(2)}`);
  mkdirSync(join(home, ".pi", "agent"), { recursive: true });
  const agentJson = join(home, ".pi", "agent", "mcp.json");
  writeFileSync(
    agentJson,
    JSON.stringify({ mcpServers: { other: { command: "x" }, "wa-mcp": { command: "node" } } }),
  );
  mkdirSync(join(home, ".pi", "mcp"), { recursive: true });
  writeFileSync(join(home, ".pi", "mcp", "wa-mcp.json"), "{}");
  const removed = uninstallRegistrations(home, ["pi"]);
  expect(removed).toEqual([{ platform: "pi", path: agentJson }]);
  const parsed = JSON.parse(readFileSync(agentJson, "utf8")) as {
    mcpServers: Record<string, unknown>;
  };
  expect(parsed.mcpServers.other).toBeDefined();
  expect(parsed.mcpServers["wa-mcp"]).toBeUndefined();
  expect(existsSync(join(home, ".pi", "mcp", "wa-mcp.json"))).toBe(false);
});
