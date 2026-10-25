import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    globalSetup: ["../../tests-global-setup.mjs"],
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
