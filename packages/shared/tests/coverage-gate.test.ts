import { expect, test } from "vite-plus/test";
import config from "../vite.config.ts";

test("coverage gate: shared enforces the 90% line threshold", () => {
  expect(config).toMatchObject({
    test: { coverage: { thresholds: { lines: 90 } } },
  });
});
