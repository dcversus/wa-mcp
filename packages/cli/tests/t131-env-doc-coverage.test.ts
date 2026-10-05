import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

const ROOT = join(import.meta.dirname, "..", "..", "..");

test("every env var read in source is documented in configuration.md", () => {
  const output = execFileSync(
    "node",
    ["--experimental-strip-types", join(ROOT, "scripts", "env-doc-coverage.ts")],
    { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  expect(output).toContain("env-doc-coverage OK");
});
