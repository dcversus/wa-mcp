import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import {
  HOOK_MARKER,
  codexHooksPath,
  installHooksFile,
  mergeHooks,
  removeHooks,
  renderClaudeHooks,
  renderCodexHooks,
} from "../src/hooks.ts";

const INBOX = "/Users/x/.wa-mcp/subs/abc123/inbox.jsonl";

test("merge preserves unrelated hooks, permissions, env, and key order", () => {
  const existing = {
    permissions: { allow: ["Bash(git status)"] },
    env: { FOO: "bar" },
    hooks: {
      PostToolUse: [
        {
          matcher: "Bash",
          hooks: [{ type: "command", command: "echo done" }],
        },
      ],
      FileChanged: [
        {
          matcher: "/tmp/notes.md",
          hooks: [{ type: "command", command: "echo notes" }],
        },
      ],
    },
  };
  const merged = mergeHooks(existing, renderClaudeHooks("abc123", INBOX));
  expect(Object.keys(merged)).toEqual(["permissions", "env", "hooks"]);
  expect(merged.permissions).toEqual(existing.permissions);
  expect(merged.env).toEqual(existing.env);
  expect(merged.hooks?.PostToolUse).toEqual(existing.hooks.PostToolUse);
  expect(merged.hooks?.FileChanged?.[0]?.matcher).toBe("/tmp/notes.md");
  const ours = merged.hooks?.FileChanged?.find((e) => e.hooks[0]?.command.includes(HOOK_MARKER));
  expect(ours?.matcher).toBe(INBOX);
  expect(JSON.parse(JSON.stringify(existing))).toEqual(existing);
});

test("install twice is idempotent (exactly one wa-mcp entry per event)", () => {
  const dir = mkdtempSync(join(tmpdir(), "t115-"));
  try {
    const path = join(dir, "settings.json");
    const ours = renderClaudeHooks("abc123", INBOX);
    installHooksFile(path, ours);
    installHooksFile(path, ours);
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const fileChanged = parsed.hooks.FileChanged ?? [];
    const oursCount = fileChanged.filter((e) =>
      e.hooks.some((h) => h.command.includes(HOOK_MARKER)),
    ).length;
    expect(oursCount).toBe(1);
    const rewake = parsed.hooks.asyncRewake ?? [];
    expect(rewake).toHaveLength(1);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("writes .bak before modifying; refuses on unparseable JSON (exit-path, no write)", () => {
  const dir = mkdtempSync(join(tmpdir(), "t115-"));
  try {
    const path = join(dir, "settings.json");
    writeFileSync(path, "{broken json");
    const result = installHooksFile(path, renderClaudeHooks("abc123", INBOX));
    expect(result.ok).toBe(false);
    expect(result.message).toContain("not valid JSON");
    expect(readFileSync(path, "utf8")).toBe("{broken json");
    writeFileSync(path, "{}");
    const ok = installHooksFile(path, renderClaudeHooks("abc123", INBOX), { now: () => "T1" });
    expect(ok.ok).toBe(true);
    expect(existsSync(`${path}.bak-T1`)).toBe(true);
    expect(readFileSync(`${path}.bak-T1`, "utf8")).toBe("{}");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("--remove deletes only wa-mcp entries and empty arrays we created; user entries untouched", () => {
  const existing = {
    hooks: {
      PostToolUse: [{ matcher: "Bash", hooks: [{ type: "command", command: "echo done" }] }],
      FileChanged: [
        { matcher: "/tmp/notes.md", hooks: [{ type: "command", command: "echo notes" }] },
        {
          matcher: INBOX,
          hooks: [{ type: "command", command: `wa-mcp inbox drain --inbox ${INBOX}` }],
        },
      ],
      asyncRewake: [
        {
          hooks: [{ type: "command", command: `wa-mcp inbox drain --inbox ${INBOX}`, async: true }],
        },
      ],
    },
  };
  const result = removeHooks(existing);
  expect(result.hooks?.PostToolUse).toHaveLength(1);
  expect(result.hooks?.FileChanged).toHaveLength(1);
  expect(result.hooks?.FileChanged?.[0]?.matcher).toBe("/tmp/notes.md");
  expect(result.hooks?.asyncRewake).toBeUndefined();
});

test("claude render: FileChanged matcher = inbox path; asyncRewake relies on exit 2", () => {
  const rendered = renderClaudeHooks("abc123", INBOX);
  const fc = rendered.FileChanged?.[0];
  expect(fc?.matcher).toBe(INBOX);
  expect(fc?.hooks[0]?.command).toContain("wa-mcp inbox drain");
  const rewake = rendered.asyncRewake?.[0];
  expect(rewake?.hooks[0]?.async).toBe(true);
  expect(rewake?.hooks[0]?.command).toContain("wa-mcp inbox drain");
});

test("codex render + merge guarantees on hooks.json path", () => {
  const dir = mkdtempSync(join(tmpdir(), "t115-"));
  try {
    const path = codexHooksPath(dir);
    const ours = renderCodexHooks("abc123", INBOX);
    installHooksFile(path, ours);
    installHooksFile(path, ours);
    const parsed = JSON.parse(readFileSync(path, "utf8")) as {
      hooks: Record<string, Array<{ hooks: Array<{ command: string }> }>>;
    };
    const oursCount = (parsed.hooks.FileChanged ?? []).filter((e) =>
      e.hooks.some((h) => h.command.includes(HOOK_MARKER)),
    ).length;
    expect(oursCount).toBe(1);
    const removed = installHooksFile(path, ours, { remove: true });
    expect(removed.ok).toBe(true);
    const after = JSON.parse(readFileSync(path, "utf8")) as { hooks?: Record<string, unknown> };
    expect(after.hooks).toBeUndefined();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
