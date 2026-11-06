import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_BRIDGE_URL, waMcpServerKey } from "@wa-mcp/shared";
import { PLATFORMS, resolveConfigPath, type Platform } from "./platforms.ts";
export type { Platform };

export interface ServerSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

/** The daemon's MCP endpoint, for hosts that connect to a URL themselves. */
export interface HttpSpec {
  url: string;
  token: string;
}

export interface WriteOptions {
  home: string;
  spec: ServerSpec;
  /** absent: the stdio form (`install --stdio`, and hosts that have no other) */
  http?: HttpSpec;
}

/** Hosts whose config takes a URL. Claude Desktop only accepts `command`
 * entries, and Grok's documented file is not the one we write yet: both stay
 * on stdio (ADR 0013). */
export const HTTP_PLATFORMS: ReadonlySet<Platform> = new Set<Platform>([
  "claude-code",
  "codex",
  "antigravity",
  "pi",
]);

export interface WriteResult {
  platform: Platform;
  path: string;
  verified: boolean;
}

function ensureParent(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
}

/** A config we can't parse may still hold the user's other settings: it is
 * reported as a failed write, never replaced. */
function holdsUnparsableJson(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }
  try {
    JSON.parse(readFileSync(path, "utf8"));
    return false;
  } catch {
    return true;
  }
}

function readJson(path: string): Record<string, unknown> {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object" ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}

function verifyJsonEntry(path: string, container: string, name: string, spec: ServerSpec): boolean {
  const parsed = readJson(path);
  const servers = parsed[container] as Record<string, Record<string, unknown>> | undefined;
  const entry = servers?.[name];
  return entry !== undefined && entry.command === spec.command;
}

function writeJsonServer(
  path: string,
  container: string,
  spec: ServerSpec,
  extraEntry?: Record<string, unknown>,
): WriteResult {
  if (holdsUnparsableJson(path)) {
    return { platform: "claude-code" as Platform, path, verified: false };
  }
  ensureParent(path);
  const parsed = readJson(path);
  const servers = (parsed[container] as Record<string, unknown> | undefined) ?? {};
  const key = waMcpServerKey(servers);
  servers[key] = { ...extraEntry, command: spec.command, args: spec.args, env: spec.env ?? {} };
  parsed[container] = servers;
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  return {
    platform: "claude-code" as Platform,
    path,
    verified: verifyJsonEntry(path, container, key, spec),
  };
}

function httpHeaders(http: HttpSpec, platform: Platform): Record<string, string> {
  return { Authorization: `Bearer ${http.token}`, "X-WA-Agent": platform };
}

function writeJsonUrlEntry(
  path: string,
  platform: Platform,
  entry: Record<string, unknown>,
): WriteResult {
  if (holdsUnparsableJson(path)) {
    return { platform, path, verified: false };
  }
  ensureParent(path);
  const parsed = readJson(path);
  const servers = (parsed.mcpServers as Record<string, unknown> | undefined) ?? {};
  const key = waMcpServerKey(servers);
  servers[key] = entry;
  parsed.mcpServers = servers;
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  const written = (readJson(path).mcpServers as Record<string, Record<string, unknown>>)[key];
  return {
    platform,
    path,
    verified: JSON.stringify(written) === JSON.stringify(entry),
  };
}

function toRows(text: string): string[] {
  return text.length === 0 ? [] : text.replace(/\n$/, "").split("\n");
}

function fromRows(rows: string[]): string {
  return `${rows.join("\n")}\n`;
}

function dropTrailingBlanks(rows: string[], from: number, to: number): number {
  let end = to;
  while (end > from && (rows[end - 1] ?? "").trim() === "") {
    end -= 1;
  }
  return end;
}

const TOML_KEY = String.raw`(?:[A-Za-z0-9_-]+|"[^"]*")`;
const TOML_TABLE_HEADER = new RegExp(
  String.raw`^\s*\[\[?\s*${TOML_KEY}(?:\s*\.\s*${TOML_KEY})*\s*\]\]?\s*$`,
);

function tomlTableRange(rows: string[], table: string): { start: number; end: number } | null {
  const header = `[${table}]`;
  const start = rows.findIndex((row) => row.trim() === header);
  if (start < 0) {
    return null;
  }
  let end = start + 1;
  while (end < rows.length && !TOML_TABLE_HEADER.test(rows[end] ?? "")) {
    end += 1;
  }
  return { start, end: dropTrailingBlanks(rows, start + 1, end) };
}

function upsertTomlTable(text: string, table: string, lines: string[]): string {
  const rows = toRows(text);
  const entry = [`[${table}]`, ...lines];
  const range = tomlTableRange(rows, table);
  if (range === null) {
    const gap = rows.length > 0 && (rows[rows.length - 1] ?? "").trim() !== "" ? [""] : [];
    return fromRows([...rows, ...gap, ...entry]);
  }
  return fromRows([...rows.slice(0, range.start), ...entry, ...rows.slice(range.end)]);
}

export function removeTomlTable(text: string, table: string): string {
  const rows = toRows(text);
  const range = tomlTableRange(rows, table);
  if (range === null) {
    return text;
  }
  let end = range.end;
  while (end < rows.length && (rows[end] ?? "").trim() === "") {
    end += 1;
  }
  const before = dropTrailingBlanks(rows, 0, range.start);
  const after = rows.slice(end);
  const joined = [
    ...rows.slice(0, before),
    ...(before > 0 && after.length > 0 ? [""] : []),
    ...after,
  ];
  return joined.length === 0 ? "" : fromRows(joined);
}

function codexLines(spec: ServerSpec): string[] {
  return [
    `command = "${spec.command}"`,
    "args = [" + spec.args.map((arg) => `"${arg}"`).join(", ") + "]",
  ];
}

function codexHttpLines(http: HttpSpec): string[] {
  const headers = Object.entries(httpHeaders(http, "codex"))
    .map(([name, value]) => `"${name}" = "${value}"`)
    .join(", ");
  return [`url = "${http.url}"`, `http_headers = { ${headers} }`];
}

function writeCodex(path: string, lines: string[]): WriteResult {
  ensureParent(path);
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const updated = upsertTomlTable(existing, "mcp_servers.wa-mcp", lines);
  writeFileSync(path, updated, { mode: 0o600 });
  const verified =
    updated.match(/^\[mcp_servers\.wa-mcp\]$/gm)?.length === 1 &&
    updated.includes(["[mcp_servers.wa-mcp]", ...lines].join("\n"));
  return { platform: "codex", path, verified };
}

function bridgeUrlOf(spec: ServerSpec): string {
  const index = spec.args.indexOf("--bridge-url");
  return (index >= 0 ? spec.args[index + 1] : undefined) ?? DEFAULT_BRIDGE_URL;
}

function withAgent(spec: ServerSpec, platform: Platform): ServerSpec {
  return spec.args.includes("--agent")
    ? spec
    : { ...spec, args: [...spec.args, "--agent", platform] };
}

function writeUrlEntry(
  platform: Platform,
  path: string,
  http: HttpSpec,
  home: string,
): WriteResult {
  const headers = httpHeaders(http, platform);
  switch (platform) {
    case "claude-code":
      return writeJsonUrlEntry(path, platform, { type: "http", url: http.url, headers });
    case "antigravity":
      return writeJsonUrlEntry(path, platform, { serverUrl: http.url, headers });
    case "pi":
      rmSync(join(home, ".pi", "mcp", "wa-mcp.json"), { force: true });
      return writeJsonUrlEntry(path, platform, {
        transport: "streamable-http",
        lifecycle: "eager",
        url: http.url,
        headers,
      });
    default:
      return writeCodex(path, codexHttpLines(http));
  }
}

export function writeServerEntry(platform: Platform, options: WriteOptions): WriteResult {
  const path = resolveConfigPath(platform, options.home);
  if (options.http !== undefined && HTTP_PLATFORMS.has(platform)) {
    return writeUrlEntry(platform, path, options.http, options.home);
  }
  const spec = withAgent(options.spec, platform);
  switch (platform) {
    case "claude-code": {
      const result = writeJsonServer(path, "mcpServers", spec, { type: "stdio" });
      return { ...result, platform };
    }
    case "claude-desktop":
      return { ...writeJsonServer(path, "mcpServers", spec), platform };
    case "grok":
      return { ...writeJsonServer(path, "mcpServers", spec), platform };
    case "antigravity":
      return {
        ...writeJsonServer(path, "mcpServers", spec, {
          serverUrl: `${bridgeUrlOf(spec)}/mcp`,
        }),
        platform,
      };
    case "pi": {
      const result = writeJsonServer(path, "mcpServers", spec, {
        transport: "stdio",
        lifecycle: "eager",
      });
      rmSync(join(options.home, ".pi", "mcp", "wa-mcp.json"), { force: true });
      return { ...result, platform };
    }
    case "codex":
      return writeCodex(path, codexLines(spec));
    default: {
      throw new Error(`unknown platform: ${String(platform)}`);
    }
  }
}

export function listRegisteredPlatforms(home: string): Platform[] {
  const registered: Platform[] = [];
  for (const platform of PLATFORMS) {
    const path = resolveConfigPath(platform, home);
    if (!existsSync(path)) {
      continue;
    }
    const text = readFileSync(path, "utf8");
    if (text.includes("wa-mcp")) {
      registered.push(platform);
    }
  }
  return registered;
}

export { join };
