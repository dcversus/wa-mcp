import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { disconnectAgent } from "../src/connections.ts";

test("T187 disconnect codex — orphaned args arrays left by old installers go with the table", () => {
  const home = mkdtempSync(join(tmpdir(), "t187-bridge-"));
  mkdirSync(join(home, ".codex"), { recursive: true });
  const path = join(home, ".codex", "config.toml");
  writeFileSync(
    path,
    [
      "[mcp_servers.wa-mcp]",
      'command = "node"',
      'args = ["/x/bin.mjs", "--bridge-url", "http://127.0.0.1:27777"]',
      '["/x/bin.mjs", "--bridge-url", "http://127.0.0.1:8080"]',
      "",
      "[mcp_servers.other]",
      'command = "npx"',
      "",
    ].join("\n"),
  );
  expect(disconnectAgent(home, "mcp", "codex").removed).toBe(1);
  const text = readFileSync(path, "utf8");
  expect(text).not.toContain("/x/bin.mjs");
  expect(text).toContain('[mcp_servers.other]\ncommand = "npx"');
});
