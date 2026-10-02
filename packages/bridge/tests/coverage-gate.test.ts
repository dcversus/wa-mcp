import { expect, test } from "vite-plus/test";
import config from "../vite.config.ts";

test("coverage gate: bridge enforces the 80% line threshold", () => {
  expect(config).toMatchObject({
    test: { coverage: { thresholds: { lines: 80 } } },
  });
});
