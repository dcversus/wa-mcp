import { join } from "node:path";

export const PLATFORMS = [
  "claude-code",
  "claude-desktop",
  "cursor",
  "codex",
  "pi",
  "hermes",
  "grok",
  "antigravity",
] as const;

export type Platform = (typeof PLATFORMS)[number];

export function resolveConfigPath(platform: Platform, home: string): string {
  switch (platform) {
    case "claude-code":
      return join(home, ".claude.json");
    case "claude-desktop":
      return join(home, "Library", "Application Support", "Claude", "claude_desktop_config.json");
    case "cursor":
      return join(home, ".cursor", "mcp.json");
    case "codex":
      return join(home, ".codex", "config.toml");
    case "pi":
      return join(home, ".pi", "agent", "mcp.json");
    case "hermes":
      return join(home, ".hermes", "config.yaml");
    case "grok":
      return join(home, ".grok", "mcp.json");
    case "antigravity":
      return join(home, ".gemini", "antigravity", "mcp_config.json");
    default:
      throw new Error(`unknown platform: ${String(platform)}`);
  }
}
