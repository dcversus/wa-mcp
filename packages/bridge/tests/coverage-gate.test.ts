import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

test("coverage gate: bridge enforces the 80% line threshold", () => {
  const config = readFileSync(new URL("../vite.config.ts", import.meta.url), "utf8");
  const parsed = JSON.parse(config.slice(config.indexOf("{"), config.lastIndexOf("}") + 1)) as never;
  expect(parsed).toMatchObject({ test: { coverage: { thresholds: { lines: 80 } } } });
});
