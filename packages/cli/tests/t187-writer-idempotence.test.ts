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
    args: [BIN, "--bridge-url", "http://127.0.0.1:27777", "--token", "tok-new", "--agent", "codex"],
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

for (const platform of ["codex"] as const) {
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
