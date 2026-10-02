import { expect, test } from "vite-plus/test";
import { PLATFORMS, resolveConfigPath } from "../src/platforms.ts";

test("all eight platforms are known", () => {
  expect([...PLATFORMS].sort()).toEqual(
    [
      "antigravity",
      "claude-code",
      "claude-desktop",
      "codex",
      "cursor",
      "grok",
      "hermes",
      "pi",
    ].sort(),
  );
});

test("paths resolve under the provided home", () => {
  const home = "/home/test";
  expect(resolveConfigPath("claude-code", home)).toBe("/home/test/.claude.json");
  expect(resolveConfigPath("claude-desktop", home)).toBe(
    "/home/test/Library/Application Support/Claude/claude_desktop_config.json",
  );
  expect(resolveConfigPath("cursor", home)).toBe("/home/test/.cursor/mcp.json");
  expect(resolveConfigPath("codex", home)).toBe("/home/test/.codex/config.toml");
  expect(resolveConfigPath("pi", home)).toBe("/home/test/.pi/mcp/wa-mcp.json");
  expect(resolveConfigPath("hermes", home)).toBe("/home/test/.hermes/config.yaml");
  expect(resolveConfigPath("grok", home)).toBe("/home/test/.grok/mcp.json");
  expect(resolveConfigPath("antigravity", home)).toBe(
    "/home/test/.gemini/antigravity/mcp_config.json",
  );
});

test("unknown platform throws", () => {
  expect(() => resolveConfigPath("nope" as never, "/home")).toThrowError(/unknown platform/i);
});
