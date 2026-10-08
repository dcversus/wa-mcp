import { copyFileSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import {
  PLATFORMS,
  claudeSettingsPath,
  codexHooksPath,
  isWaMcpHookEntry,
  removeHooks,
  resolveConfigPath,
  waMcpInboxPaths,
  type HookEntry,
  type HooksSettings,
  type Platform,
} from "@wa-mcp/shared";

export type ConnectionKind = "hooks" | "mcp";

export interface Connection {
  kind: ConnectionKind;
  agent: string;
  label: string;
  configPath: string;
  detail: string;
  enabled: boolean;
  subId: string | null;
  inboxPath: string | null;
}

export interface DisconnectResult {
  status: "removed" | "not-connected" | "unknown";
  removed: number;
}

const SERVER_KEY = "wa-mcp";
const REDACTED = "[redacted]";
const SECRET_NAME = /(token|key|secret|password|passwd|auth|credential)/i;

const HOOK_AGENTS = {
  claude: { label: "Claude Code", path: claudeSettingsPath },
  codex: { label: "Codex", path: codexHooksPath },
} as const;

type HookAgent = keyof typeof HOOK_AGENTS;

const PLATFORM_LABELS: Record<Platform, string> = {
  "claude-code": "Claude Code",
  "claude-desktop": "Claude Desktop",
  cursor: "Cursor",
  codex: "Codex",
  pi: "Pi",
  hermes: "Hermes",
  grok: "Grok",
  antigravity: "Antigravity",
};

interface ServerEntry {
  command: string;
  args: string[];
  envKeys: string[];
  enabled: boolean;
}

function readText(path: string): string | null {
  try {
    return existsSync(path) ? readFileSync(path, "utf8") : null;
  } catch {
    return null;
  }
}

function readJsonObject(path: string): Record<string, unknown> | null {
  const text = readText(path);
  if (text === null) {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(text);
    return parsed !== null && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

function writeWithBackup(path: string, text: string): void {
  copyFileSync(path, `${path}.bak-${new Date().toISOString().replace(/[:.]/g, "-")}`);
  writeFileSync(path, text, { mode: 0o600 });
}

function isHookEntry(value: unknown): value is HookEntry {
  const hooks = (value as { hooks?: unknown } | null)?.hooks;
  return (
    Array.isArray(hooks) &&
    hooks.every((hook) => typeof (hook as { command?: unknown } | null)?.command === "string")
  );
}

function hookEvents(settings: HooksSettings): Array<[string, HookEntry[]]> {
  const hooks = settings.hooks;
  if (hooks === null || typeof hooks !== "object") {
    return [];
  }
  return Object.entries(hooks).map(([event, entries]) => [
    event,
    Array.isArray(entries) ? entries.filter(isHookEntry) : [],
  ]);
}

export function subIdFromInbox(inboxPath: string): string | null {
  return inboxPath.match(/[\\/]subs[\\/]([^\\/]+)[\\/]inbox\.jsonl$/)?.[1] ?? null;
}

function hookConnections(home: string, agent: HookAgent): Connection[] {
  const { label, path } = HOOK_AGENTS[agent];
  const configPath = path(home);
  const settings = readJsonObject(configPath);
  if (settings === null) {
    return [];
  }
  const enabled = settings.disableAllHooks !== true;
  return hookEvents(settings).flatMap(([event, entries]) =>
    entries.filter(isWaMcpHookEntry).flatMap((entry) =>
      waMcpInboxPaths(entry).map((inboxPath) => ({
        kind: "hooks" as const,
        agent,
        label,
        configPath,
        detail: `${event} hook drains ${inboxPath}`,
        enabled,
        subId: subIdFromInbox(inboxPath),
        inboxPath,
      })),
    ),
  );
}

export function redactArgs(args: string[]): string[] {
  return args.map((arg, index) => {
    const previous = args[index - 1];
    if (previous !== undefined && /^--?[\w-]+$/.test(previous) && SECRET_NAME.test(previous)) {
      return REDACTED;
    }
    const assignment = arg.match(/^([^=\s]+)=/);
    if (assignment?.[1] !== undefined && SECRET_NAME.test(assignment[1])) {
      return `${assignment[1]}=${REDACTED}`;
    }
    return arg;
  });
}

function describe(entry: ServerEntry): string {
  const line = [entry.command, ...redactArgs(entry.args)].join(" ");
  return entry.envKeys.length === 0
    ? line
    : `${line} · env ${entry.envKeys.map((key) => `${key}=${REDACTED}`).join(" ")}`;
}

function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function parseArray(text: string | undefined): string[] {
  if (text === undefined) {
    return [];
  }
  try {
    return stringArray(JSON.parse(text));
  } catch {
    return [];
  }
}

function unquote(value: string): string {
  return value.trim().replace(/^(["'])(.*)\1$/, "$2");
}

function jsonServer(path: string): ServerEntry | null {
  const servers = readJsonObject(path)?.mcpServers as Record<string, unknown> | undefined;
  if (servers === undefined || servers === null) {
    return null;
  }
  let entry = servers[SERVER_KEY] as Record<string, unknown> | undefined;
  if (entry === undefined || entry === null || typeof entry !== "object") {
    for (const candidate of Object.values(servers)) {
      if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
        continue;
      }
      const candidateRecord = candidate as Record<string, unknown>;
      const args = Array.isArray(candidateRecord.args) ? candidateRecord.args : [];
      const carriesBridge = args.some(
        (arg) =>
          typeof arg === "string" && (arg.includes("wa-mcp") || arg.includes("--bridge-url")),
      );
      const command = typeof candidateRecord.command === "string" ? candidateRecord.command : "";
      const isOurCommand = command.includes("wa-mcp");
      if (carriesBridge || isOurCommand) {
        entry = candidateRecord;
        break;
      }
    }
  }
  if (entry === undefined || entry === null || typeof entry !== "object") {
    return null;
  }
  const env = entry.env;
  return {
    command: typeof entry.command === "string" ? entry.command : "",
    args: stringArray(entry.args),
    envKeys: env !== null && typeof env === "object" ? Object.keys(env) : [],
    enabled: entry.disabled !== true && entry.enabled !== false,
  };
}

const TOML_KEY = String.raw`(?:[A-Za-z0-9_-]+|"[^"]*")`;
const TOML_HEADER = new RegExp(
  String.raw`^\s*\[\[?\s*(${TOML_KEY}(?:\s*\.\s*${TOML_KEY})*)\s*\]\]?\s*$`,
);

function tomlHeader(line: string): string | null {
  return (
    line
      .match(TOML_HEADER)?.[1]
      ?.replace(/"/g, "")
      .replace(/\s*\.\s*/g, ".") ?? null
  );
}

function tomlBlock(lines: string[]): { start: number; end: number } | null {
  const table = `mcp_servers.${SERVER_KEY}`;
  const start = lines.findIndex((line) => tomlHeader(line) === table);
  if (start < 0) {
    return null;
  }
  let end = start + 1;
  while (end < lines.length) {
    const header = tomlHeader(lines[end] ?? "");
    if (header !== null && !header.startsWith(`${table}.`)) {
      break;
    }
    end += 1;
  }
  return { start, end };
}

function tomlServer(path: string): ServerEntry | null {
  const text = readText(path);
  const lines = text?.split("\n") ?? [];
  const block = tomlBlock(lines);
  if (block === null) {
    return null;
  }
  const body = lines.slice(block.start, block.end);
  const value = (key: string): string | undefined =>
    body.map((line) => line.match(new RegExp(`^\\s*${key}\\s*=\\s*(.+)$`))?.[1]).find(Boolean);
  let section = "";
  const envKeys: string[] = [];
  for (const line of body) {
    section = tomlHeader(line) ?? section;
    const key = line.match(/^\s*([\w-]+)\s*=/)?.[1];
    if (section.endsWith(".env") && key !== undefined) {
      envKeys.push(key);
    }
  }
  const inlineEnv = value("env")?.match(/\{(.*)\}/)?.[1] ?? "";
  for (const match of inlineEnv.matchAll(/([\w-]+)\s*=/g)) {
    envKeys.push(match[1] as string);
  }
  return {
    command: unquote(value("command") ?? ""),
    args: parseArray(value("args")),
    envKeys,
    enabled: value("enabled")?.trim() !== "false",
  };
}

function indentOf(line: string): number {
  return line.length - line.trimStart().length;
}

function yamlBlock(lines: string[]): { start: number; end: number } | null {
  const parent = lines.findIndex((line) => line.trim() === "mcp_servers:");
  if (parent < 0) {
    return null;
  }
  const parentIndent = indentOf(lines[parent] ?? "");
  let start = -1;
  for (let index = parent + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? "";
    if (line.trim().length > 0 && indentOf(line) <= parentIndent) {
      break;
    }
    if (unquote(line.trim().replace(/:$/, "")) === SERVER_KEY && line.trim().endsWith(":")) {
      start = index;
      break;
    }
  }
  if (start < 0) {
    return null;
  }
  const keyIndent = indentOf(lines[start] ?? "");
  let end = start + 1;
  while (end < lines.length) {
    const line = lines[end] ?? "";
    if (line.trim().length > 0 && indentOf(line) <= keyIndent) {
      break;
    }
    end += 1;
  }
  while (end > start + 1 && (lines[end - 1] ?? "").trim().length === 0) {
    end -= 1;
  }
  return { start, end };
}

function yamlServer(path: string): ServerEntry | null {
  const lines = readText(path)?.split("\n") ?? [];
  const block = yamlBlock(lines);
  if (block === null) {
    return null;
  }
  const body = lines.slice(block.start + 1, block.end);
  const value = (key: string): string | undefined =>
    body.map((line) => line.match(new RegExp(`^\\s*${key}:\\s*(.+)$`))?.[1]).find(Boolean);
  const envAt = body.findIndex((line) => line.trim() === "env:");
  const envKeys: string[] = [];
  if (envAt >= 0) {
    const envIndent = indentOf(body[envAt] ?? "");
    for (const line of body.slice(envAt + 1)) {
      if (line.trim().length > 0 && indentOf(line) <= envIndent) {
        break;
      }
      const key = line.match(/^\s*([\w-]+):/)?.[1];
      if (key !== undefined) {
        envKeys.push(key);
      }
    }
  }
  return {
    command: unquote(value("command") ?? ""),
    args: parseArray(value("args")),
    envKeys,
    enabled: value("enabled")?.trim() !== "false" && value("disabled")?.trim() !== "true",
  };
}

function readServer(platform: Platform, path: string): ServerEntry | null {
  if (platform === "codex") {
    return tomlServer(path);
  }
  if (platform === "hermes") {
    return yamlServer(path);
  }
  return jsonServer(path);
}

function mcpConnections(home: string): Connection[] {
  return PLATFORMS.flatMap((platform) => {
    const configPath = resolveConfigPath(platform, home);
    const entry = readServer(platform, configPath);
    if (entry === null) {
      return [];
    }
    return [
      {
        kind: "mcp" as const,
        agent: platform,
        label: PLATFORM_LABELS[platform],
        configPath,
        detail: describe(entry),
        enabled: entry.enabled,
        subId: null,
        inboxPath: null,
      },
    ];
  });
}

export function listConnections(home: string): Connection[] {
  return [
    ...hookConnections(home, "claude"),
    ...hookConnections(home, "codex"),
    ...mcpConnections(home),
  ];
}

function disconnectHooks(home: string, agent: HookAgent, subId?: string): DisconnectResult {
  const targets = hookConnections(home, agent).filter(
    (connection) => subId === undefined || connection.subId === subId,
  );
  const path = HOOK_AGENTS[agent].path(home);
  const settings = readJsonObject(path);
  if (targets.length === 0 || settings === null) {
    return { status: "not-connected", removed: 0 };
  }
  const updated =
    subId === undefined
      ? removeHooks(settings)
      : targets.reduce(
          (current, target) => removeHooks(current, target.inboxPath ?? undefined),
          settings as HooksSettings,
        );
  writeWithBackup(path, `${JSON.stringify(updated, null, 2)}\n`);
  return { status: "removed", removed: targets.length };
}

function withoutBlock(text: string, block: { start: number; end: number }): string {
  const lines = text.split("\n");
  lines.splice(block.start, block.end - block.start);
  return lines.join("\n").replace(/\n{2,}$/, "\n");
}

function disconnectMcp(home: string, platform: Platform): DisconnectResult {
  const path = resolveConfigPath(platform, home);
  if (readServer(platform, path) === null) {
    return { status: "not-connected", removed: 0 };
  }
  if (platform === "codex" || platform === "hermes") {
    const text = readText(path) ?? "";
    const block = (platform === "codex" ? tomlBlock : yamlBlock)(text.split("\n"));
    writeWithBackup(path, withoutBlock(text, block as { start: number; end: number }));
  } else {
    const parsed = readJsonObject(path) as Record<string, unknown>;
    const servers = parsed.mcpServers as Record<string, unknown>;
    let removed = false;
    if (Object.prototype.hasOwnProperty.call(servers, SERVER_KEY)) {
      delete servers[SERVER_KEY];
      removed = true;
    }
    if (!removed) {
      for (const [key, candidate] of Object.entries(servers)) {
        if (candidate === null || typeof candidate !== "object" || Array.isArray(candidate)) {
          continue;
        }
        const record = candidate as Record<string, unknown>;
        const args = Array.isArray(record.args) ? record.args : [];
        const carriesBridge = args.some(
          (arg) =>
            typeof arg === "string" && (arg.includes("wa-mcp") || arg.includes("--bridge-url")),
        );
        const command = typeof record.command === "string" ? record.command : "";
        if (carriesBridge || command.includes("wa-mcp")) {
          delete servers[key];
          removed = true;
          break;
        }
      }
    }
    writeWithBackup(path, `${JSON.stringify(parsed, null, 2)}\n`);
  }
  return { status: "removed", removed: 1 };
}

export function disconnectAgent(
  home: string,
  kind: string,
  agent: string,
  subId?: string,
): DisconnectResult {
  if (kind === "hooks" && Object.hasOwn(HOOK_AGENTS, agent)) {
    return disconnectHooks(home, agent as HookAgent, subId);
  }
  if (kind === "mcp" && (PLATFORMS as readonly string[]).includes(agent)) {
    return disconnectMcp(home, agent as Platform);
  }
  return { status: "unknown", removed: 0 };
}
