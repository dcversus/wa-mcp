import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
import { DEFAULT_BRIDGE_URL } from "@wa-mcp/shared";
import { PLATFORMS, resolveConfigPath, type Platform } from "./platforms.ts";
export type { Platform };

export interface ServerSpec {
  command: string;
  args: string[];
  env?: Record<string, string>;
}

export interface WriteOptions {
  home: string;
  spec: ServerSpec;
}

export interface WriteResult {
  platform: Platform;
  path: string;
  verified: boolean;
}

function ensureParent(path: string): void {
  mkdirSync(dirname(path), { recursive: true });
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
  name: string,
  spec: ServerSpec,
  extraEntry?: Record<string, unknown>,
): WriteResult {
  ensureParent(path);
  const parsed = readJson(path);
  const servers = (parsed[container] as Record<string, unknown> | undefined) ?? {};
  servers[name] = { ...extraEntry, command: spec.command, args: spec.args, env: spec.env ?? {} };
  parsed[container] = servers;
  writeFileSync(path, `${JSON.stringify(parsed, null, 2)}\n`, { mode: 0o600 });
  return {
    platform: "claude-code" as Platform,
    path,
    verified: verifyJsonEntry(path, container, name, spec),
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

function writeCodex(path: string, spec: ServerSpec): WriteResult {
  ensureParent(path);
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = codexLines(spec);
  const updated = upsertTomlTable(existing, "mcp_servers.wa-mcp", lines);
  writeFileSync(path, updated, { mode: 0o600 });
  const verified =
    updated.match(/^\[mcp_servers\.wa-mcp\]$/gm)?.length === 1 &&
    updated.includes(["[mcp_servers.wa-mcp]", ...lines].join("\n"));
  return { platform: "codex", path, verified };
}

function indentOf(row: string): number {
  return row.length - row.trimStart().length;
}

function yamlChildRange(
  rows: string[],
  key: string,
): { serverIndex: number; childrenEnd: number; depth: number; start: number; end: number } | null {
  const serverIndex = rows.findIndex((row) => /^mcp_servers:\s*$/.test(row));
  if (serverIndex < 0) {
    return null;
  }
  let childrenEnd = serverIndex + 1;
  while (
    childrenEnd < rows.length &&
    ((rows[childrenEnd] ?? "").trim() === "" || indentOf(rows[childrenEnd] ?? "") > 0)
  ) {
    childrenEnd += 1;
  }
  const firstChild = rows.slice(serverIndex + 1, childrenEnd).find((row) => row.trim().length > 0);
  const depth = firstChild === undefined ? 2 : indentOf(firstChild);
  const start = rows.findIndex(
    (row, index) =>
      index > serverIndex &&
      index < childrenEnd &&
      indentOf(row) === depth &&
      row.trim() === `${key}:`,
  );
  if (start < 0) {
    return { serverIndex, childrenEnd, depth, start: -1, end: -1 };
  }
  let end = start + 1;
  while (
    end < childrenEnd &&
    ((rows[end] ?? "").trim() === "" || indentOf(rows[end] ?? "") > depth)
  ) {
    end += 1;
  }
  return { serverIndex, childrenEnd, depth, start, end: dropTrailingBlanks(rows, start + 1, end) };
}

function upsertYamlMapping(text: string, entry: string[]): string {
  const rows = toRows(text);
  const range = yamlChildRange(rows, "wa-mcp");
  if (range === null) {
    return fromRows([...rows, "mcp_servers:", ...entry.map((row) => `  ${row}`)]);
  }
  const indented = entry.map((row) => `${" ".repeat(range.depth)}${row}`);
  if (range.start < 0) {
    return fromRows([
      ...rows.slice(0, range.serverIndex + 1),
      ...indented,
      ...rows.slice(range.serverIndex + 1),
    ]);
  }
  return fromRows([...rows.slice(0, range.start), ...indented, ...rows.slice(range.end)]);
}

export function removeYamlServer(text: string, key: string): string {
  const rows = toRows(text);
  const range = yamlChildRange(rows, key);
  if (range === null || range.start < 0) {
    return text;
  }
  return fromRows([...rows.slice(0, range.start), ...rows.slice(range.end)]);
}

function hermesEntry(spec: ServerSpec): string[] {
  return [
    "wa-mcp:",
    `  command: ${spec.command}`,
    `  args: [${spec.args.map((arg) => `"${arg}"`).join(", ")}]`,
    "  env:",
    `    WA_TOKEN: "${spec.env?.WA_TOKEN ?? ""}"`,
  ];
}

function writeHermes(path: string, spec: ServerSpec): WriteResult {
  ensureParent(path);
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const entry = hermesEntry(spec);
  const updated = upsertYamlMapping(existing, entry);
  writeFileSync(path, updated, { mode: 0o600 });
  const keyRow = toRows(updated).find((row) => row.trim() === "wa-mcp:") ?? "";
  const pad = " ".repeat(indentOf(keyRow));
  const verified =
    /^mcp_servers:\s*$/m.test(updated) &&
    updated.match(/^\s+wa-mcp:\s*$/gm)?.length === 1 &&
    updated.includes(entry.map((row) => `${pad}${row}`).join("\n"));
  return { platform: "hermes", path, verified };
}

function bridgeUrlOf(spec: ServerSpec): string {
  const index = spec.args.indexOf("--bridge-url");
  return (index >= 0 ? spec.args[index + 1] : undefined) ?? DEFAULT_BRIDGE_URL;
}

export function writeServerEntry(platform: Platform, options: WriteOptions): WriteResult {
  const path = resolveConfigPath(platform, options.home);
  const spec = options.spec;
  switch (platform) {
    case "claude-code": {
      const result = writeJsonServer(path, "mcpServers", "wa-mcp", spec, { type: "stdio" });
      return { ...result, platform };
    }
    case "claude-desktop":
      return { ...writeJsonServer(path, "mcpServers", "wa-mcp", spec), platform };
    case "cursor":
      return { ...writeJsonServer(path, "mcpServers", "wa-mcp", spec), platform };
    case "grok":
      return { ...writeJsonServer(path, "mcpServers", "wa-mcp", spec), platform };
    case "antigravity":
      return {
        ...writeJsonServer(path, "mcpServers", "wa-mcp", spec, {
          serverUrl: `${bridgeUrlOf(spec)}/mcp`,
        }),
        platform,
      };
    case "pi": {
      const result = writeJsonServer(path, "mcpServers", "wa-mcp", spec, { transport: "stdio" });
      rmSync(join(options.home, ".pi", "mcp", "wa-mcp.json"), { force: true });
      return { ...result, platform };
    }
    case "codex":
      return writeCodex(path, spec);
    case "hermes":
      return writeHermes(path, spec);
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
