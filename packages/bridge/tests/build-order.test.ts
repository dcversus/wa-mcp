import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

test("bridge build restores web assets after pack and orders web-ui first", () => {
  const pkg = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8")) as {
    scripts: Record<string, string>;
    devDependencies: Record<string, string>;
  };
  // vp pack wipes dist/ (vite emptyOutDir), so the web-ui copy must run
  // AFTER pack or every bridge build 404s the UI (bit us 3x on 2026-10-02).
  expect(pkg.scripts.build?.endsWith("node ../web-ui/scripts/copy-dist.mjs")).toBe(true);
  // pnpm run -r orders builds topologically over devDependencies too;
  // without this edge bridge may build before web-ui and copy from nothing.
  expect(pkg.devDependencies["@wa-mcp/web-ui"]).toBe("workspace:*");
});
