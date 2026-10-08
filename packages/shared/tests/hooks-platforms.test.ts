import { expect, test } from "vite-plus/test";
import {
  PLATFORMS,
  claudeSettingsPath,
  codexHooksPath,
  isWaMcpHookEntry,
  removeHooks,
  resolveConfigPath,
  waMcpInboxPaths,
} from "../src/index.ts";

const OURS = {
  matcher: "/d/subs/a/inbox.jsonl",
  hooks: [{ type: "command", command: "wa-mcp inbox drain --inbox /d/subs/a/inbox.jsonl" }],
};
const OTHER = {
  matcher: "/d/subs/b/inbox.jsonl",
  hooks: [{ type: "command", command: "wa-mcp inbox drain --inbox /d/subs/b/inbox.jsonl" }],
};
const FOREIGN = { hooks: [{ type: "command", command: "echo hi" }] };

test("hook entries are recognised by the drain marker and expose their inbox paths", () => {
  expect(isWaMcpHookEntry(OURS)).toBe(true);
  expect(isWaMcpHookEntry(FOREIGN)).toBe(false);
  expect(waMcpInboxPaths(OURS)).toEqual(["/d/subs/a/inbox.jsonl"]);
  expect(waMcpInboxPaths({ hooks: [{ type: "command", command: "wa-mcp inbox drain" }] })).toEqual(
    [],
  );
});

test("removeHooks drops wa-mcp entries (all or one inbox) and keeps foreign ones", () => {
  const settings = { model: "x", hooks: { FileChanged: [OURS, OTHER], Stop: [FOREIGN] } };
  expect(removeHooks(settings)).toEqual({ model: "x", hooks: { Stop: [FOREIGN] } });
  expect(removeHooks(settings, "/d/subs/a/inbox.jsonl")).toEqual({
    model: "x",
    hooks: { FileChanged: [OTHER], Stop: [FOREIGN] },
  });
  expect(removeHooks({ hooks: { FileChanged: [OURS] } })).toEqual({});
  expect(removeHooks({ model: "y" })).toEqual({ model: "y" });
});

test("agent config paths resolve under the given home for every platform", () => {
  expect(claudeSettingsPath("/h")).toBe("/h/.claude/settings.json");
  expect(codexHooksPath("/h")).toBe("/h/.codex/hooks.json");
  for (const platform of PLATFORMS) {
    expect(resolveConfigPath(platform, "/h").startsWith("/h/")).toBe(true);
  }
  expect(resolveConfigPath("codex", "/h")).toBe("/h/.codex/config.toml");
  expect(() => resolveConfigPath("nope" as never, "/h")).toThrow("unknown platform");
});
