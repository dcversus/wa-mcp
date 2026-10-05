import { expect, test } from "vite-plus/test";
import { name, version } from "../src/index.ts";
import pkg from "../package.json" with { type: "json" };

test("exports package identity", () => {
  expect(name).toBe("@wa-mcp/shared");
  expect(version).toBe(pkg.version);
  expect(name).toBe(pkg.name);
});
