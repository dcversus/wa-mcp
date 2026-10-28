import { defineConfig } from "vite-plus";

export default defineConfig({
  fmt: {},
  lint: {
    jsPlugins: [{ name: "vite-plus", specifier: "vite-plus/oxlint-plugin" }],
    rules: { "vite-plus/prefer-vite-plus-imports": "error" },
    options: { typeAware: true, typeCheck: true },
  },
  run: {
    cache: true,
  },
  test: {
    // Windows runners intermittently stall past the 5s default (unrelated tests
    // time out together, docs-only commits included); other platforms keep 5s
    testTimeout: process.platform === "win32" ? 20_000 : 5_000,
  },
});
