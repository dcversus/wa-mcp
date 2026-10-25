import { defineConfig } from "vite-plus";

export default defineConfig({
  test: {
    globalSetup: ["../../tests-global-setup.mjs"],
  },
  pack: {
    entry: ["src/index.ts", "src/bin.ts"],
    dts: {
      generator: "tsgo",
    },
  },
});
