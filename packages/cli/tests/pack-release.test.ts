import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

test("T95 — pack-release asserts the package version against the pack output", () => {
  const script = readFileSync(new URL("../../../scripts/pack-release.sh", import.meta.url), "utf8");
  expect(script).toMatch(/version drift/);
  expect(script).toMatch(/package\.json/);
  expect(script).toContain("expected_version");
  expect(script).not.toContain("0.9.0.tgz");
});
