import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { expect, test } from "vite-plus/test";
import { CLI_GLOBAL_FLAGS, DEFAULT_BRIDGE_URL, DEFAULT_PORT } from "../src/index.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

function walk(dir: string, keep: (path: string) => boolean): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return ["node_modules", "dist", ".vitepress", "raw", "adr"].includes(name)
        ? []
        : walk(path, keep);
    }
    return keep(path) ? [path] : [];
  });
}

test("T186 A — the default port is 27777, single-sourced in shared", () => {
  expect(DEFAULT_PORT).toBe(27777);
  expect(DEFAULT_BRIDGE_URL).toBe("http://127.0.0.1:27777");
  expect(CLI_GLOBAL_FLAGS).toContain("--port <n> (default 27777)");
});

test("T186 A — no package source hardcodes 8080; packages without shared carry the same literal", () => {
  for (const pkg of ["bridge", "cli", "mcp-server", "web-ui", "shared"]) {
    for (const file of walk(join(ROOT, "packages", pkg, "src"), (path) =>
      /\.(ts|css)$/.test(path),
    )) {
      expect(readFileSync(file, "utf8"), relative(ROOT, file)).not.toContain("8080");
    }
  }
  expect(read("packages/mcp-server/src/bin.ts")).toContain(`"${DEFAULT_BRIDGE_URL}"`);
  expect(read("packages/web-ui/src/state.ts")).toContain(`"${DEFAULT_BRIDGE_URL}"`);
});

test("T186 C — browser scripts default to 27777 and honour WA_PORT", () => {
  for (const script of ["webui-e2e.mjs", "webui-smoke.mjs", "webui-dogfood.mjs"]) {
    const text = read(`scripts/${script}`);
    expect(text, script).not.toContain("8080");
    expect(text, script).toContain("`http://127.0.0.1:${process.env.WA_PORT ?? 27777}`");
  }
});

test("T186 B — docs use 27777; 8080 survives only in migration context", () => {
  const docs = [
    ...walk(join(ROOT, "docs"), (path) => path.endsWith(".md")),
    join(ROOT, "README.md"),
  ];
  for (const file of docs) {
    for (const paragraph of readFileSync(file, "utf8").split(/\n\s*\n/)) {
      if (paragraph.includes("8080")) {
        expect(paragraph, relative(ROOT, file)).toMatch(/27777/);
      }
    }
  }
  expect(read("docs/configuration.md")).toMatch(/Upgrading[\s\S]{0,400}8080[\s\S]{0,200}27777/);
  expect(read("docs/configuration.md")).toMatch(/\| `WA_PORT`\s+\| `27777`/);
  expect(read("CHANGELOG.md").slice(0, 2000)).toMatch(/27777/);
});
