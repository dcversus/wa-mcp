import { expect, test } from "vite-plus/test";
import { join } from "node:path";
import { PLATFORMS, resolveConfigPath } from "../src/platforms.ts";

const HOME = "/home/test";

test("all six platforms are known", () => {
  expect([...PLATFORMS].sort()).toEqual(
    ["antigravity", "claude-code", "claude-desktop", "codex", "grok", "pi"].sort(),
  );
});

test("paths resolve under the provided home", () => {
  expect(resolveConfigPath("claude-code", HOME)).toBe(join(HOME, ".claude.json"));
  expect(resolveConfigPath("claude-desktop", HOME)).toBe(
    join(HOME, "Library", "Application Support", "Claude", "claude_desktop_config.json"),
  );
  expect(resolveConfigPath("codex", HOME)).toBe(join(HOME, ".codex", "config.toml"));
  expect(resolveConfigPath("pi", HOME)).toBe(join(HOME, ".pi", "agent", "mcp.json"));
  expect(resolveConfigPath("grok", HOME)).toBe(join(HOME, ".grok", "mcp.json"));
  expect(resolveConfigPath("antigravity", HOME)).toBe(
    join(HOME, ".gemini", "antigravity", "mcp_config.json"),
  );
});

test("unknown platform throws", () => {
  expect(() => resolveConfigPath("nope" as never, "/home")).toThrowError(/unknown platform/i);
});
