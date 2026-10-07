import { expect, test } from "vite-plus/test";
import { HOOK_MARKER, renderClaudeHooks, renderCodexHooks } from "../src/hooks.ts";

test("T171 A3 — the Claude hook shape matches the real settings.json schema", () => {
  const hooks = renderClaudeHooks("sub1", "/data/subs/sub1/inbox.jsonl");
  const keys = Object.keys(hooks);
  expect(keys).toEqual(["FileChanged"]);
  const entry = hooks.FileChanged?.[0] as {
    matcher?: string;
    hooks: Array<{ type: string; command: string; async?: boolean }>;
  };
  expect(entry.matcher).toBe("/data/subs/sub1/inbox.jsonl");
  expect(entry.hooks).toHaveLength(1);
  const hook = entry.hooks[0] as { type: string; command: string; async?: boolean };
  expect(hook.type).toBe("command");
  expect(hook.command).toBe("wa-mcp inbox drain --inbox /data/subs/sub1/inbox.jsonl");
  expect(hook.async).toBe(true);
  expect(JSON.stringify(hooks)).not.toContain("asyncRewake");
});

test("T171 A3 — the codex shape stays a plain FileChanged watcher", () => {
  const hooks = renderCodexHooks("sub1", "/data/subs/sub1/inbox.jsonl");
  expect(Object.keys(hooks)).toEqual(["FileChanged"]);
  expect(JSON.stringify(hooks)).toContain(HOOK_MARKER);
  expect(JSON.stringify(hooks)).not.toContain("asyncRewake");
});

test("T171 A3 — the full settings.json round-trips with foreign hooks intact", () => {
  const settings = {
    permissions: { allow: ["Bash"] },
    hooks: {
      FileChanged: [{ matcher: "src/**", hooks: [{ type: "command", command: "npm test" }] }],
    },
  };
  const ours = renderClaudeHooks("sub1", "/data/subs/sub1/inbox.jsonl");
  const merged = {
    ...settings,
    hooks: {
      FileChanged: [...(settings.hooks.FileChanged ?? []), ...(ours.FileChanged ?? [])],
    },
  };
  const serialized = JSON.stringify(merged, null, 2);
  const parsed = JSON.parse(serialized) as typeof merged;
  expect(parsed.permissions).toEqual({ allow: ["Bash"] });
  expect(parsed.hooks.FileChanged).toHaveLength(2);
  expect(serialized).toContain("async");
});
