import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    // Windows runners intermittently stall past the 5s default (unrelated tests
    // time out together, docs-only commits included); other platforms keep 5s
    testTimeout: process.platform === "win32" ? 20_000 : 5_000,
    coverage: {
      // T93-F: build output must never dilute (or pad) the gate numbers
      exclude: ["dist/**", "**/node_modules/**"],
      thresholds: {
        lines: 80,
      },
    },
  },
  pack: {
    entry: ["src/index.ts", "src/bin.ts"],
    deps: {
      resolveDepSubpath: true,
    },
    dts: {
      generator: "tsgo",
    },
    exports: true,
  },
});
