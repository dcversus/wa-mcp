import { chmodSync, existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { main } from "../src/bin.ts";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  delete process.env.WA_MCP_SERVER_BIN;
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

const ROOT = join(import.meta.dirname, "..", "..", "..");

async function waitFor<T>(read: () => T | null, done: (value: T) => boolean): Promise<T> {
  const started = Date.now();
  for (;;) {
    const value = read();
    if (value !== null && done(value)) {
      return value;
    }
    if (Date.now() - started > 10_000) {
      throw new Error("waitFor: condition not met within 10s");
    }
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

test("T194 — the Claude Code plugin carries a versioned manifest, MCP launcher and channel command", () => {
  const manifest = JSON.parse(
    readFileSync(join(ROOT, "plugins/claude-code/.claude-plugin/plugin.json"), "utf8"),
  );
  expect(manifest.name).toBe("wa-mcp");
  expect(manifest.version).toBe("0.1.0");
  const mcp = JSON.parse(readFileSync(join(ROOT, "plugins/claude-code/.mcp.json"), "utf8"));
  expect(mcp.mcpServers["wa-mcp"].args).toContain("mcp");
  expect(mcp.mcpServers["wa-mcp"].args).toContain("--agent");
  const commandPath = join(ROOT, "plugins/claude-code/.claude-plugin/commands/wa-channel.md");
  expect(existsSync(commandPath)).toBe(true);
  const command = readFileSync(commandPath, "utf8");
  expect(command).toContain("subscribe_events");
  expect(command).toContain("channel: true");
  expect(command).toContain("untrusted input");
});

test("T194 — the root marketplace lists the channel plugin", () => {
  const marketplace = JSON.parse(
    readFileSync(join(ROOT, ".claude-plugin/marketplace.json"), "utf8"),
  );
  expect(marketplace.name).toBe("wa-mcp");
  const entry = marketplace.plugins[0];
  expect(entry.name).toBe("wa-mcp");
  expect(entry.category).toBe("channels");
  expect(entry.version).toBe("0.1.0");
  expect(existsSync(join(ROOT, entry.source))).toBe(true);
});

test(
  "T194 — `wa-mcp mcp` runs the bundled stdio server with passthrough args + env",
  { timeout: 15000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "t194-mcp-"));
    roots.push(root);
    const outPath = join(root, "out.txt");
    const stub = join(root, "stub-server.mjs");
    writeFileSync(
      stub,
      [
        'import { writeFileSync } from "node:fs";',
        'writeFileSync(process.env.WA_T194_OUT, JSON.stringify({ argv: process.argv.slice(2), token: process.env.WA_TOKEN ?? "", url: process.env.WA_BRIDGE_URL ?? "" }));',
        "process.exit(0);",
        "",
      ].join("\n"),
    );
    process.env.WA_T194_OUT = outPath;
    chmodSync(stub, 0o755);
    process.env.WA_MCP_SERVER_BIN = stub;
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await main([
      "mcp",
      "--agent",
      "claude-code",
      "--arg-marker",
      outPath,
      "--home",
      join(root, "home"),
      "--data-dir",
      join(root, "home", ".wa-mcp"),
      "--token",
      "tok123",
      "--bridge-url",
      "http://127.0.0.1:27777",
    ]);
    log.mockRestore();
    err.mockRestore();
    const out = JSON.parse(
      await waitFor(
        () => (existsSync(outPath) ? readFileSync(outPath, "utf8") : null),
        (text) => text !== null,
      ),
    ) as { argv: string[]; token: string; url: string };
    expect(out.argv).toContain("--agent");
    expect(out.argv).toContain("claude-code");
    expect(out.token).toBe("tok123");
    expect(out.url).toBe("http://127.0.0.1:27777");
  },
);

test(
  "T194 — the spawned server's stdout reaches this process (stdio inherit)",
  { timeout: 15000 },
  async () => {
    const root = mkdtempSync(join(tmpdir(), "t194-mcp2-"));
    roots.push(root);
    const markerPath = () => join(root, "up.txt");
    const stub = join(root, "echo-server.mjs");
    writeFileSync(
      stub,
      'import { writeFileSync } from "node:fs";\nprocess.stdout.write("MCP-UP");\nwriteFileSync(process.env.WA_T194_OUT, "ran " + (process.env.WA_TOKEN ?? "-"));\n',
    );
    chmodSync(stub, 0o755);
    process.env.WA_MCP_SERVER_BIN = stub;
    process.env.WA_T194_OUT = markerPath();
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    const err = vi.spyOn(console, "error").mockImplementation(() => {});
    await main([
      "mcp",
      "--home",
      join(root, "home"),
      "--data-dir",
      join(root, "home", ".wa-mcp"),
      "--token",
      "tok456",
    ]);
    log.mockRestore();
    err.mockRestore();
    const markerText = await waitFor(
      () => (existsSync(markerPath()) ? readFileSync(markerPath(), "utf8") : null),
      (text) => text !== null,
    );
    expect(markerText).toBe("ran tok456");
  },
);
