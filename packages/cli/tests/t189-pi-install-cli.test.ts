import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { main } from "../src/bin.ts";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function run(argv: string[]): Promise<string> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  await main(argv);
  const out = log.mock.calls.map((call) => call.join(" ")).join("\n");
  log.mockRestore();
  return out;
}

function homes(): { home: string; dataDir: string; flags: string[] } {
  const root = mkdtempSync(join(tmpdir(), "t189-pi-cli-"));
  roots.push(root);
  const home = join(root, "home");
  const dataDir = join(home, ".wa-mcp");
  return { home, dataDir, flags: ["--home", home, "--data-dir", dataDir, "--token", "tok"] };
}

test("T189 — install --target pi --dry-run reports the pi extension and writes nothing", async () => {
  const { home, dataDir, flags } = homes();
  const out = await run(["install", "--target", "pi", "--dry-run", ...flags]);
  expect(out).toContain("dry run");
  expect(out).toContain(`pi: would write ${join(home, ".pi", "agent", "mcp.json")}`);
  expect(out).toContain("pi extension: copy ");
  expect(out).toContain(join(dataDir, "pi-extension-dist"));
  expect(existsSync(join(home, ".pi"))).toBe(false);
  expect(existsSync(dataDir)).toBe(false);
});

test("T189 — install --target pi registers the MCP server and the extension; uninstall reverses both", async () => {
  const { home, dataDir, flags } = homes();
  const settingsPath = join(home, ".pi", "agent", "settings.json");
  const distDir = join(dataDir, "pi-extension-dist");
  const out = await run(["install", "--target", "pi", ...flags]);
  expect(out).toContain(`pi extension: ${distDir} listed in ${settingsPath}`);
  expect(JSON.parse(readFileSync(settingsPath, "utf8")).packages).toEqual([distDir]);
  expect(existsSync(join(distDir, "index.mjs"))).toBe(true);
  const removed = await run(["uninstall", "--target", "pi", ...flags]);
  expect(removed).toContain(`removed pi extension: ${distDir}`);
  expect(JSON.parse(readFileSync(settingsPath, "utf8")).packages).toEqual([]);
  expect(existsSync(distDir)).toBe(false);
});

test("T189 — install for other targets leaves pi settings alone", async () => {
  const { home, flags } = homes();
  await run(["install", "--target", "cursor", ...flags]);
  expect(existsSync(join(home, ".pi", "agent", "settings.json"))).toBe(false);
});
