import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
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
