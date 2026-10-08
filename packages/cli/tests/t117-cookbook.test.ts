import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { renderClaudeHooks, renderCodexHooks } from "../src/hooks.ts";

const doc = readFileSync(
  join(import.meta.dirname, "../../../docs/cookbook/react-to-messages.md"),
  "utf8",
);

test("the cookbook doc exists and covers the three paths", () => {
  expect(doc).toContain("Claude Code");
  expect(doc).toContain("Codex");
  expect(doc).toContain("tail -F");
  expect(doc).toContain("resources/subscribe");
});

test("every wa-mcp command in the doc matches real CLI commands", () => {
  const fences = doc.match(/```bash\n([\s\S]*?)```/g) ?? [];
  const commands: Array<{ cmd: string; flags: string[] }> = [];
  for (const fence of fences) {
    for (const line of fence.replace(/```bash\n?/g, "").split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("wa-mcp ")) {
        continue;
      }
      const parts = trimmed.split(/\s+/);
      commands.push({
        cmd: parts[1] ?? "",
        flags: parts
          .slice(2)
          .filter((p) => p.startsWith("--"))
          .map((p) => p.split("=")[0]!),
      });
    }
  }
  const known: Record<string, string[]> = {
    subscribe: ["--chat", "--kind", "--all", "--token", "--bridge-url", "--port"],
    install: ["--hooks", "--sub", "--remove", "--home", "--service"],
    inbox: ["--inbox", "--state"],
    subs: [
      "--name",
      "--chat",
      "--all-chats",
      "--like",
      "--mention-only",
      "--prompt",
      "--delivery",
      "--session",
      "--command",
      "--arg",
      "--env",
      "--disable",
      "--enable",
    ],
  };
  for (const entry of commands) {
    expect(Object.keys(known)).toContain(entry.cmd);
    for (const flag of entry.flags) {
      expect(known[entry.cmd] ?? []).toContain(flag);
    }
  }
  expect(commands.length).toBeGreaterThanOrEqual(4);
});

test("T180 the cookbook documents the subscription model and all three delivery modes", () => {
  expect(doc).toContain("wa-mcp subs create");
  expect(doc).toContain("%like%");
  expect(doc).toContain("--mention-only");
  for (const mode of ["--delivery inbox", "--delivery session", "--delivery spawn"]) {
    expect(doc).toContain(mode);
  }
  expect(doc).toContain("WAMCP_EVENT");
  expect(doc).toContain("session.jsonl");
  expect(doc).not.toContain("--kind message");
});

test("hook shapes in the doc match renderClaudeHooks/renderCodexHooks output", () => {
  const inbox = "/home/u/.wa-mcp/subs/abc/inbox.jsonl";
  const claude = renderClaudeHooks("abc", inbox);
  expect(claude.FileChanged?.[0]?.matcher).toBe(inbox);
  expect(claude.FileChanged?.[0]?.hooks[0]?.async).toBe(true);
  expect(claude.asyncRewake).toBeUndefined();
  const codex = renderCodexHooks("abc", inbox);
  expect(codex.FileChanged?.[0]?.matcher).toBe(inbox);
  expect(doc).toContain("FileChanged");
  expect(doc).toContain("async");
  expect(doc).toContain("wa-mcp inbox drain");
  expect(doc).toContain("exit `2`");
});
