import { expect, test } from "vite-plus/test";
import { name, version } from "../src/index.ts";

test("exports package identity matching package.json version", async () => {
  const pkg = (await import("../package.json", { with: { type: "json" } })).default as {
    name: string;
    version: string;
  };
  expect(name).toBe("@wa-mcp/web-ui");
  expect(version).toBe(pkg.version);
});
