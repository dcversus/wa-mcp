import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import {
  isWaMcpHookEntry as isOurs,
  removeHooks,
  waMcpInboxPaths as ourInboxPaths,
  type HookEntry,
  type HooksSettings,
} from "@wa-mcp/shared";

export {
  HOOK_MARKER,
  claudeSettingsPath,
  codexHooksPath,
  removeHooks,
  type HookEntry,
  type HooksSettings,
} from "@wa-mcp/shared";

export function renderClaudeHooks(subId: string, inboxPath: string): Record<string, HookEntry[]> {
  const drainCommand = `wa-mcp inbox drain --inbox ${inboxPath}`;
  return {
    FileChanged: [
      {
        matcher: inboxPath,
        hooks: [{ type: "command", command: drainCommand, async: true }],
      },
    ],
  };
}

export function renderCodexHooks(subId: string, inboxPath: string): Record<string, HookEntry[]> {
  const drainCommand = `wa-mcp inbox drain --inbox ${inboxPath}`;
  return {
    FileChanged: [
      {
        matcher: inboxPath,
        hooks: [{ type: "command", command: drainCommand }],
      },
    ],
  };
}

export function mergeHooks(
  existing: HooksSettings,
  ours: Record<string, HookEntry[]>,
): HooksSettings {
  const result: HooksSettings = { ...existing };
  const merged: Record<string, HookEntry[]> = { ...result.hooks };
  for (const [event, entries] of Object.entries(ours)) {
    const incoming = new Set(entries.flatMap((entry) => ourInboxPaths(entry)));
    const kept = (merged[event] ?? []).filter(
      (entry) => !isOurs(entry) || !ourInboxPaths(entry).some((path) => incoming.has(path)),
    );
    merged[event] = [
      ...kept,
      ...entries.map((entry) => JSON.parse(JSON.stringify(entry)) as HookEntry),
    ];
  }
  result.hooks = merged;
  return result;
}

export interface InstallHooksResult {
  ok: boolean;
  message: string;
  backupPath?: string;
}

export function installHooksFile(
  settingsPath: string,
  ours: Record<string, HookEntry[]>,
  opts: { now?: () => string; remove?: boolean; removeInboxPath?: string } = {},
): InstallHooksResult {
  const now = opts.now ?? (() => new Date().toISOString().replace(/[:.]/g, "-"));
  let existing: HooksSettings = {};
  if (existsSync(settingsPath)) {
    try {
      existing = JSON.parse(readFileSync(settingsPath, "utf8")) as HooksSettings;
    } catch {
      return { ok: false, message: `refusing: ${settingsPath} is not valid JSON` };
    }
  }
  const updated =
    opts.remove === true ? removeHooks(existing, opts.removeInboxPath) : mergeHooks(existing, ours);
  const backupPath = `${settingsPath}.bak-${now()}`;
  if (existsSync(settingsPath)) {
    renameSync(settingsPath, backupPath);
  } else {
    mkdirSync(dirname(settingsPath), { recursive: true });
  }
  writeFileSync(settingsPath, `${JSON.stringify(updated, null, 2)}\n`, { mode: 0o600 });
  return {
    ok: true,
    message: opts.remove === true ? "wa-mcp hook entries removed" : "wa-mcp hook entries installed",
    backupPath: existsSync(backupPath) ? backupPath : undefined,
  };
}
