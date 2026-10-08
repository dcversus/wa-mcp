import { expect, test } from "vite-plus/test";
import { DEFAULT_PORT } from "@wa-mcp/shared";
import { buildConfig } from "../src/bin.ts";

test("T186 A — no WA_PORT: the bridge listens on 27777", () => {
  expect(DEFAULT_PORT).toBe(27777);
  expect(buildConfig({}).port).toBe(27777);
  for (const junk of ["not-a-number", "0", "-5"]) {
    expect(buildConfig({ WA_PORT: junk }).port, junk).toBe(27777);
  }
});

test("T186 A — an explicit 8080 keeps working for existing installs", () => {
  expect(buildConfig({ WA_PORT: "8080" }).port).toBe(8080);
});
