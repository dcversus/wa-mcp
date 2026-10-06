import { existsSync, mkdirSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { dirname, join } from "node:path";
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

function upsertTomlTable(text: string, table: string, lines: string[]): string {
  const header = `[${table}]`;
  const tablePattern = new RegExp(`\\[${table.replace(/\./g, "\\.")}\\][^\\[]*`, "g");
  if (tablePattern.test(text)) {
    return text.replace(tablePattern, `${header}\n${lines.join("\n")}\n\n`);
  }
  const trimmed = text.endsWith("\n") || text.length === 0 ? text : `${text}\n`;
  return `${trimmed}${header}\n${lines.join("\n")}\n`;
}

function writeCodex(path: string, spec: ServerSpec): WriteResult {
  ensureParent(path);
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const lines = [
    `command = "${spec.command}"`,
    "args = [" + spec.args.map((arg) => `"${arg}"`).join(", ") + "]",
  ];
  const updated = upsertTomlTable(existing, "mcp_servers.wa-mcp", lines);
  writeFileSync(path, updated, { mode: 0o600 });
  const verified =
    updated.match(/\[mcp_servers\.wa-mcp\]/g)?.length === 1 &&
    updated.includes(`command = "${spec.command}"`);
  return { platform: "codex", path, verified };
}

function upsertYamlMapping(text: string, block: string): string {
  if (text.includes("mcp_servers:")) {
    const lines = text.split("\n");
    const serverIndex = lines.findIndex((line) => line.trim() === "mcp_servers:");
    if (serverIndex >= 0) {
      const already = lines.some((line) => line.includes("wa-mcp:"));
      if (!already) {
        lines.splice(serverIndex + 1, 0, block);
      }
      return lines.join("\n");
    }
  }
  const trimmed = text.endsWith("\n") || text.length === 0 ? text : `${text}\n`;
  return `${trimmed}mcp_servers:\n${block}`;
}

function writeHermes(path: string, spec: ServerSpec): WriteResult {
  ensureParent(path);
  const existing = existsSync(path) ? readFileSync(path, "utf8") : "";
  const indent = "  ";
  const block = `${indent}wa-mcp:\n${indent}${indent}command: ${spec.command}\n${indent}${indent}args: [${spec.args.map((arg) => `"${arg}"`).join(", ")}]\n${indent}${indent}env:\n${indent}${indent}  WA_TOKEN: "${spec.env?.WA_TOKEN ?? ""}"`;
  const updated = upsertYamlMapping(existing, block);
  writeFileSync(path, updated, { mode: 0o600 });
  const verified = updated.includes("mcp_servers:") && updated.includes("wa-mcp:");
  return { platform: "hermes", path, verified };
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
          serverUrl: "http://127.0.0.1:8080/mcp",
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
