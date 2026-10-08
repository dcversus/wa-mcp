import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { writeServerEntry } from "../src/writers.ts";

const BIN = "/opt/wa-mcp/packages/mcp-server/dist/bin.mjs";

function spec(port: number, token = "tok-new") {
  return {
    command: "/usr/local/bin/node",
    args: [BIN, "--bridge-url", `http://127.0.0.1:${port}`, "--token", token],
    env: { WA_TOKEN: token },
  };
}

function fakeHome(): string {
  const dir = join(tmpdir(), `t187-${Math.random().toString(36).slice(2)}`);
  mkdirSync(dir, { recursive: true });
  return dir;
}

type TomlValue = string | number | boolean | TomlValue[];

function parseTomlValue(raw: string, where: string): TomlValue {
  const value = raw.trim();
  if (value.startsWith('"')) {
    const match = /^"((?:[^"\\]|\\.)*)"$/.exec(value);
    if (match === null) throw new Error(`bad string at ${where}: ${value}`);
    return match[1] ?? "";
  }
  if (value.startsWith("[")) {
    if (!value.endsWith("]")) throw new Error(`unterminated array at ${where}`);
    const inner = value.slice(1, -1).trim();
    if (inner.length === 0) return [];
    const items = inner.match(/"(?:[^"\\]|\\.)*"|[^,\s][^,]*/g) ?? [];
    return items.map((item) => parseTomlValue(item, where));
  }
  if (value === "true" || value === "false") return value === "true";
  if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
  throw new Error(`bad value at ${where}: ${value}`);
}

function parseToml(text: string): Record<string, Record<string, TomlValue>> {
  const tables: Record<string, Record<string, TomlValue>> = { "": {} };
  let current = "";
  text.split("\n").forEach((rawLine, index) => {
    const line = rawLine.trim();
    const where = `line ${index + 1}`;
    if (line.length === 0 || line.startsWith("#")) return;
    const header = /^\[([A-Za-z0-9_.-]+)\]$/.exec(line);
    if (header !== null) {
      current = header[1] ?? "";
      if (tables[current] !== undefined)
        throw new Error(`duplicate table [${current}] at ${where}`);
      tables[current] = {};
      return;
    }
    const pair = /^([A-Za-z0-9_-]+)\s*=\s*(.+)$/.exec(line);
    if (pair === null) throw new Error(`not a key = value line at ${where}: ${line}`);
    const table = tables[current] ?? {};
    const key = pair[1] ?? "";
    if (key in table) throw new Error(`duplicate key ${key} in [${current}] at ${where}`);
    table[key] = parseTomlValue(pair[2] ?? "", where);
  });
  return tables;
}

type Yaml = string | Yaml[] | { [key: string]: Yaml };

function parseYamlScalar(raw: string): Yaml {
  const value = raw.trim();
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    return inner.length === 0
      ? []
      : (inner.match(/"(?:[^"\\]|\\.)*"|[^,\s][^,]*/g) ?? []).map(parseYamlScalar);
  }
  const quoted = /^"((?:[^"\\]|\\.)*)"$/.exec(value);
  return quoted !== null ? (quoted[1] ?? "") : value;
}

function parseYaml(text: string): { [key: string]: Yaml } {
  const lines = text
    .split("\n")
    .map((raw, index) => ({ raw, index }))
    .filter(({ raw }) => raw.trim().length > 0 && !raw.trim().startsWith("#"));
  let cursor = 0;
  function block(indent: number): Yaml {
    const first = lines[cursor];
    if (first?.raw.trim().startsWith("- ")) {
      const list: Yaml[] = [];
      while (cursor < lines.length) {
        const line = lines[cursor];
        if (line === undefined) break;
        const depth = line.raw.length - line.raw.trimStart().length;
        if (depth < indent) break;
        if (depth !== indent || !line.raw.trim().startsWith("- ")) {
          throw new Error(`bad list item at line ${line.index + 1}`);
        }
        list.push(parseYamlScalar(line.raw.trim().slice(2)));
        cursor += 1;
      }
      return list;
    }
    const map: { [key: string]: Yaml } = {};
    while (cursor < lines.length) {
      const line = lines[cursor];
      if (line === undefined) break;
      const depth = line.raw.length - line.raw.trimStart().length;
      if (depth < indent) break;
      if (depth > indent) throw new Error(`unexpected indent at line ${line.index + 1}`);
      const pair = /^([A-Za-z0-9_.-]+):(?:\s+(.*))?$/.exec(line.raw.trim());
      if (pair === null)
        throw new Error(`not a mapping line at line ${line.index + 1}: ${line.raw}`);
      const key = pair[1] ?? "";
      if (key in map) throw new Error(`duplicate key ${key} at line ${line.index + 1}`);
      cursor += 1;
      if (pair[2] !== undefined && pair[2].length > 0) {
        map[key] = parseYamlScalar(pair[2]);
      } else {
        const next = lines[cursor];
        const nextDepth = next === undefined ? -1 : next.raw.length - next.raw.trimStart().length;
        map[key] = nextDepth > indent ? block(nextDepth) : "";
      }
    }
    return map;
  }
  const parsed = block(0);
  if (cursor !== lines.length)
    throw new Error(`trailing content at line ${(lines[cursor]?.index ?? 0) + 1}`);
  return parsed as { [key: string]: Yaml };
}

const CODEX_SEED = `model = "o4-mini"

[mcp_servers.other]
command = "npx"
args = ["-y", "other-server"]

[mcp_servers.wa-mcp]
command = "/usr/local/bin/node"
args = ["${BIN}", "--bridge-url", "http://127.0.0.1:8080", "--token", "tok-old"]

[profiles.fast]
model = "gpt-5-mini"
`;

test("T187 codex — reinstall with a new port leaves exactly one args array, foreign tables intact", () => {
  const home = fakeHome();
  const path = join(home, ".codex", "config.toml");
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(path, CODEX_SEED);
  const result = writeServerEntry("codex", { home, spec: spec(27777) });
  expect(result.verified).toBe(true);
  const text = readFileSync(path, "utf8");
  const parsed = parseToml(text);
  expect(parsed["mcp_servers.wa-mcp"]).toEqual({
    command: "/usr/local/bin/node",
    args: [BIN, "--bridge-url", "http://127.0.0.1:27777", "--token", "tok-new"],
  });
  expect(parsed[""]).toEqual({ model: "o4-mini" });
  expect(parsed["mcp_servers.other"]).toEqual({ command: "npx", args: ["-y", "other-server"] });
  expect(parsed["profiles.fast"]).toEqual({ model: "gpt-5-mini" });
  expect(text).not.toContain("8080");
  expect(text.match(/^args = /gm)).toHaveLength(2);
});

test("T187 codex — a config already holding orphaned arrays is cleaned on the next install", () => {
  const home = fakeHome();
  const path = join(home, ".codex", "config.toml");
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(
    path,
    `[mcp_servers.wa-mcp]\ncommand = "/usr/local/bin/node"\nargs = ["${BIN}", "--bridge-url", "http://127.0.0.1:27777", "--token", "a"]\n["${BIN}", "--bridge-url", "http://127.0.0.1:27777", "--token", "a"]\n["${BIN}", "--bridge-url", "http://127.0.0.1:8080", "--token", "a"]\n\n[mcp_servers.other]\ncommand = "npx"\n`,
  );
  writeServerEntry("codex", { home, spec: spec(27777) });
  const parsed = parseToml(readFileSync(path, "utf8"));
  expect(Object.keys(parsed["mcp_servers.wa-mcp"] ?? {})).toEqual(["command", "args"]);
  expect(parsed["mcp_servers.other"]).toEqual({ command: "npx" });
});

const HERMES_SEED = `platform_toolsets:
  cli:
    - browser
mcp_servers:
  other:
    command: npx
    args: ["-y", "other-server"]
  wa-mcp:
    command: /usr/local/bin/node
    args: ["${BIN}", "--bridge-url", "http://127.0.0.1:8080", "--token", "tok-old"]
    env:
      WA_TOKEN: "tok-old"
  zeta:
    command: zeta
model: claude
`;

test("T187 hermes — reinstall with a new port replaces the existing entry, other keys byte-for-byte", () => {
  const home = fakeHome();
  const path = join(home, ".hermes", "config.yaml");
  mkdirSync(join(home, ".hermes"), { recursive: true });
  writeFileSync(path, HERMES_SEED);
  const result = writeServerEntry("hermes", { home, spec: spec(27777) });
  expect(result.verified).toBe(true);
  const text = readFileSync(path, "utf8");
  const parsed = parseYaml(text) as {
    mcp_servers: Record<string, { command: string; args: string[]; env?: Record<string, string> }>;
  };
  expect(parsed.mcp_servers["wa-mcp"]).toEqual({
    command: "/usr/local/bin/node",
    args: [BIN, "--bridge-url", "http://127.0.0.1:27777", "--token", "tok-new"],
    env: { WA_TOKEN: "tok-new" },
  });
  expect(Object.keys(parsed.mcp_servers)).toEqual(["other", "wa-mcp", "zeta"]);
  expect(text).not.toContain("8080");
  const outside = (body: string): string =>
    body.replace(/ {2}wa-mcp:\n(?: {4}.*\n)+/, "<wa-mcp>\n");
  expect(outside(text)).toBe(outside(HERMES_SEED));
});

test("T187 hermes — only the wa-mcp key under mcp_servers counts; a mention elsewhere is not an entry", () => {
  const home = fakeHome();
  const path = join(home, ".hermes", "config.yaml");
  mkdirSync(join(home, ".hermes"), { recursive: true });
  writeFileSync(path, 'notes: "see wa-mcp: docs"\nmcp_servers:\n  other:\n    command: npx\n');
  writeServerEntry("hermes", { home, spec: spec(27777) });
  const parsed = parseYaml(readFileSync(path, "utf8")) as {
    notes: string;
    mcp_servers: Record<string, unknown>;
  };
  expect(parsed.notes).toBe("see wa-mcp: docs");
  expect(Object.keys(parsed.mcp_servers).sort()).toEqual(["other", "wa-mcp"]);
});

for (const platform of ["codex", "hermes"] as const) {
  test(`T187 ${platform} — installing N times yields the same file as installing once`, () => {
    const once = fakeHome();
    const many = fakeHome();
    const first = writeServerEntry(platform, { home: once, spec: spec(27777) });
    for (let round = 0; round < 5; round += 1) {
      writeServerEntry(platform, { home: many, spec: spec(round % 2 === 0 ? 8080 : 27777) });
    }
    writeServerEntry(platform, { home: many, spec: spec(27777) });
    const manyPath = first.path.replace(once, many);
    expect(readFileSync(manyPath, "utf8")).toBe(readFileSync(first.path, "utf8"));
    const again = readFileSync(manyPath, "utf8");
    writeServerEntry(platform, { home: many, spec: spec(27777) });
    expect(readFileSync(manyPath, "utf8")).toBe(again);
  });
}

test("T187 uninstall codex — removes the whole wa-mcp table (args too), foreign tables stay valid", async () => {
  const { uninstallRegistrations } = await import("../src/service.ts");
  const home = fakeHome();
  const path = join(home, ".codex", "config.toml");
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(
    path,
    CODEX_SEED.replace("[profiles.fast]", `["${BIN}", "orphan"]\n\n[profiles.fast]`),
  );
  expect(uninstallRegistrations(home, ["codex"])).toHaveLength(1);
  const text = readFileSync(path, "utf8");
  const parsed = parseToml(text);
  expect(parsed["mcp_servers.wa-mcp"]).toBeUndefined();
  expect(parsed[""]).toEqual({ model: "o4-mini" });
  expect(parsed["mcp_servers.other"]).toEqual({ command: "npx", args: ["-y", "other-server"] });
  expect(parsed["profiles.fast"]).toEqual({ model: "gpt-5-mini" });
  expect(text).not.toContain(BIN);
});

test("T187 uninstall hermes — removes only the wa-mcp entry; sibling servers after it survive", async () => {
  const { uninstallRegistrations } = await import("../src/service.ts");
  const home = fakeHome();
  const path = join(home, ".hermes", "config.yaml");
  mkdirSync(join(home, ".hermes"), { recursive: true });
  writeFileSync(path, HERMES_SEED);
  expect(uninstallRegistrations(home, ["hermes"])).toHaveLength(1);
  const parsed = parseYaml(readFileSync(path, "utf8")) as {
    model: string;
    platform_toolsets: unknown;
    mcp_servers: Record<string, unknown>;
  };
  expect(Object.keys(parsed.mcp_servers)).toEqual(["other", "zeta"]);
  expect(parsed.model).toBe("claude");
  expect(parsed.platform_toolsets).toEqual({ cli: ["browser"] });
});

test("T187 codex — a quoted-key table right after wa-mcp is a header, not part of the entry", () => {
  const home = fakeHome();
  const path = join(home, ".codex", "config.toml");
  mkdirSync(join(home, ".codex"), { recursive: true });
  writeFileSync(
    path,
    `[mcp_servers.wa-mcp]\ncommand = "old"\n\n[mcp_servers."my server"]\ncommand = "keep"\n`,
  );
  writeServerEntry("codex", { home, spec: spec(27777) });
  const text = readFileSync(path, "utf8");
  expect(text).toContain('[mcp_servers."my server"]\ncommand = "keep"');
  expect(text).not.toContain('command = "old"');
});
