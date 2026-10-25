import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

test("version-drift guard passes at HEAD and detects injected drift", () => {
  const script = join(import.meta.dirname, "../../../scripts/version-drift.mjs");
  const out = execFileSync("node", [script], { encoding: "utf8" });
  expect(out).toContain("version-drift OK");
  expect(out).toContain("no stale mentions");
  expect(out).toContain("0.1.0");
});
