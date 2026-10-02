import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

const cliRoot = join(import.meta.dirname ?? ".", "..");
const pkg = JSON.parse(readFileSync(join(cliRoot, "package.json"), "utf8")) as {
  dependencies?: Record<string, string>;
  bundledDependencies?: string[];
};

test("cli declares the runtime packages as bundled dependencies", () => {
  for (const dep of ["@wa-mcp/bridge", "@wa-mcp/mcp-server", "@wa-mcp/shared"]) {
    expect(pkg.dependencies?.[dep], dep).toBe("workspace:*");
    expect(pkg.bundledDependencies, dep).toContain(dep);
  }
});

test("the workspace packages resolve from the cli package", () => {
  const req = createRequire(join(cliRoot, "package.json"));
  const bridgePkg = req.resolve("@wa-mcp/bridge/package.json") as string;
  const mcpPkg = req.resolve("@wa-mcp/mcp-server/package.json") as string;
  expect(bridgePkg.replace(/\\/g, "/")).toContain("bridge/package.json");
  expect(mcpPkg.replace(/\\/g, "/")).toContain("mcp-server/package.json");
});
