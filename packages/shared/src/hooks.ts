import { join } from "node:path";

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

export function isWaMcpHookEntry(entry: HookEntry): boolean {
  return entry.hooks.some((hook) => hook.command.includes(HOOK_MARKER));
}

export function waMcpInboxPaths(entry: HookEntry): string[] {
  return entry.hooks
    .map((hook) => hook.command)
    .filter((command) => command.includes(HOOK_MARKER))
    .map((command) => {
      const at = command.indexOf("--inbox ");
      return at >= 0 ? command.slice(at + "--inbox ".length).trim() : "";
    })
    .filter((path) => path.length > 0);
}

export function removeHooks(existing: HooksSettings, inboxPath?: string): HooksSettings {
  const result: HooksSettings = { ...existing };
  if (result.hooks === undefined) {
    return result;
  }
  const cleaned: Record<string, HookEntry[]> = {};
  for (const [event, entries] of Object.entries(result.hooks)) {
    const kept = entries.filter((entry) => {
      if (!isWaMcpHookEntry(entry)) {
        return true;
      }
      if (inboxPath === undefined) {
        return false;
      }
      return !waMcpInboxPaths(entry).includes(inboxPath);
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

export function claudeSettingsPath(home: string): string {
  return join(home, ".claude", "settings.json");
}

export function codexHooksPath(home: string): string {
  return join(home, ".codex", "hooks.json");
}
