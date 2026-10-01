import { expect, test } from "vite-plus/test";
import { name, version } from "../src/index.ts";

test("exports package identity", () => {
  expect(name).toBe("@wa-mcp/cli");
  expect(version).toBe("0.0.0");
});
