import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

/** T83-FIX: built CLIs resolve imports through package exports — deep
 * `@wa-mcp/bridge/src/...` imports work under vitest aliases but crash the
 * published artifact (ERR_PACKAGE_PATH_NOT_EXPORTED). Import from the
 * package root (public API) only. */
test("no cli source file deep-imports @wa-mcp/bridge internals", () => {
  const srcDir = join(__dirname, "..", "src");
  const offenders: string[] = [];
  for (const file of readdirSync(srcDir)) {
    if (!file.endsWith(".ts")) {
      continue;
    }
    const src = readFileSync(join(srcDir, file), "utf8");
    if (src.includes("@wa-mcp/bridge/src/")) {
      offenders.push(file);
    }
  }
  expect(offenders).toEqual([]);
});
