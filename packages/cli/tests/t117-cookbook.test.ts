import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { CLI_COMMANDS, CLI_GLOBAL_FLAGS } from "@wa-mcp/shared";
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

const DOCS_ROOT = join(import.meta.dirname, "../../../docs");

function docPages(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (entry.name.startsWith(".") || ["raw", "adr"].includes(entry.name)) {
      return [];
    }
    const path = join(dir, entry.name);
    return entry.isDirectory() ? docPages(path) : entry.name.endsWith(".md") ? [path] : [];
  });
}

function knownFlags(): Record<string, string[]> {
  const globals = [...CLI_GLOBAL_FLAGS.matchAll(/--[a-z-]+/g)].map((match) => match[0]);
  return Object.fromEntries(
    CLI_COMMANDS.map((command) => [
      command.name,
      [...new Set([...[...command.usage.matchAll(/--[a-z-]+/g)].map((m) => m[0]), ...globals])],
    ]),
  );
}

test("every wa-mcp command in the docs is a real command with real flags (from the CLI reference)", () => {
  const known = knownFlags();
  let checked = 0;
  for (const page of docPages(DOCS_ROOT)) {
    const text = readFileSync(page, "utf8");
    for (const fence of text.match(/```bash\n([\s\S]*?)```/g) ?? []) {
      for (const line of fence.replace(/```bash\n?/g, "").split("\n")) {
        const trimmed = line.trim();
        if (!trimmed.startsWith("wa-mcp ")) {
          continue;
        }
        const parts = trimmed.split(/\s+/);
        const cmd = parts[1] ?? "";
        expect(Object.keys(known), `${page}: ${trimmed}`).toContain(cmd);
        for (const flag of parts.slice(2).filter((part) => part.startsWith("--"))) {
          expect(known[cmd] ?? [], `${page}: ${trimmed}`).toContain(flag.split("=")[0]);
        }
        checked += 1;
      }
    }
  }
  expect(checked).toBeGreaterThanOrEqual(10);
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
