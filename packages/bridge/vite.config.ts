import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    coverage: {
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
