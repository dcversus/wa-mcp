import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

export const HOOK_MARKER = "wa-mcp inbox drain";

export interface HookEntry {
  matcher?: string;
  hooks: Array<{ type: string; command: string; async?: boolean }>;
}

export interface HooksSettings {
  hooks?: Record<string, HookEntry[]>;
  permissions?: unknown;
  env?: unknown;
  [key: string]: unknown;
}

export function renderClaudeHooks(subId: string, inboxPath: string): Record<string, HookEntry[]> {
  const drainCommand = `wa-mcp inbox drain --inbox ${inboxPath}`;
  return {
    FileChanged: [
      {
        matcher: inboxPath,
        hooks: [{ type: "command", command: drainCommand }],
      },
    ],
    asyncRewake: [
      {
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

function isOurs(entry: HookEntry): boolean {
  return entry.hooks.some((hook) => hook.command.includes(HOOK_MARKER));
}

function ourInboxPaths(entry: HookEntry): string[] {
  return entry.hooks
    .map((hook) => hook.command)
    .filter((command) => command.includes(HOOK_MARKER))
    .map((command) => {
      const at = command.indexOf("--inbox ");
      return at >= 0 ? command.slice(at + "--inbox ".length).trim() : "";
    })
    .filter((path) => path.length > 0);
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

export function removeHooks(existing: HooksSettings, inboxPath?: string): HooksSettings {
  const result: HooksSettings = { ...existing };
  if (result.hooks === undefined) {
    return result;
  }
  const cleaned: Record<string, HookEntry[]> = {};
  for (const [event, entries] of Object.entries(result.hooks)) {
    const kept = entries.filter((entry) => {
      if (!isOurs(entry)) {
        return true;
      }
      if (inboxPath === undefined) {
        return false;
      }
      return !ourInboxPaths(entry).includes(inboxPath);
    });
    if (kept.length > 0) {
      cleaned[event] = kept;
    }
  }
  if (Object.keys(cleaned).length > 0) {
    result.hooks = cleaned;
  } else {
    delete result.hooks;
  }
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

export function claudeSettingsPath(home: string): string {
  return join(home, ".claude", "settings.json");
}

export function codexHooksPath(home: string): string {
  return join(home, ".codex", "hooks.json");
}
