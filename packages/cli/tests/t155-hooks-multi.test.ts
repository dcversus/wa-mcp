import { expect, test } from "vite-plus/test";
import {
  HOOK_MARKER,
  mergeHooks,
  removeHooks,
  renderClaudeHooks,
  renderCodexHooks,
  type HooksSettings,
} from "../src/hooks.ts";

const A = "/data/subs/sub-a/inbox.jsonl";
const B = "/data/subs/sub-b/inbox.jsonl";

function ours(settings: HooksSettings): string[] {
  const out: string[] = [];
  for (const entries of Object.values(settings.hooks ?? {})) {
    for (const entry of entries) {
      for (const hook of entry.hooks) {
        if (hook.command.includes(HOOK_MARKER)) {
          out.push(hook.command);
        }
      }
    }
  }
  return out;
}

test("T155 W3 — two subscriptions wire two hook entries", () => {
  let settings = mergeHooks({}, renderClaudeHooks("sub-a", A));
  settings = mergeHooks(settings, renderClaudeHooks("sub-b", B));
  expect(ours(settings).filter((cmd) => cmd.includes("sub-a"))).toHaveLength(2);
  expect(ours(settings).filter((cmd) => cmd.includes("sub-b"))).toHaveLength(2);
});

test("T155 W3 — installing the same subscription twice stays idempotent", () => {
  let settings = mergeHooks({}, renderClaudeHooks("sub-a", A));
  settings = mergeHooks(settings, renderClaudeHooks("sub-a", A));
  expect(ours(settings).filter((cmd) => cmd.includes("sub-a"))).toHaveLength(2);
});

test("T155 W3 — removing one sub keeps the other wired", () => {
  let settings = mergeHooks({}, renderClaudeHooks("sub-a", A));
  settings = mergeHooks(settings, renderClaudeHooks("sub-b", B));
  const cleaned = removeHooks(settings, B);
  expect(ours(cleaned).filter((cmd) => cmd.includes("sub-a"))).toHaveLength(2);
  expect(ours(cleaned).filter((cmd) => cmd.includes("sub-b"))).toHaveLength(0);
});

test("T155 W3 — a plain remove clears every wa-mcp entry", () => {
  let settings = mergeHooks({}, renderClaudeHooks("sub-a", A));
  settings = mergeHooks(settings, renderCodexHooks("sub-b", B));
  const cleaned = removeHooks(settings);
  expect(ours(cleaned)).toHaveLength(0);
  expect(cleaned.hooks?.FileChanged).toBeUndefined();
});

test("T155 W3 — foreign hooks survive wa-mcp installs", () => {
  const existing: HooksSettings = {
    hooks: {
      FileChanged: [{ matcher: "src/**", hooks: [{ type: "command", command: "npm test" }] }],
    },
  };
  const settings = mergeHooks(existing, renderClaudeHooks("sub-a", A));
  expect(settings.hooks?.FileChanged?.some((entry) => entry.matcher === "src/**")).toBe(true);
  expect(ours(settings).filter((cmd) => cmd.includes("sub-a"))).toHaveLength(2);
});
