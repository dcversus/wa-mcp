import { readFileSync } from "node:fs";
import { expect, test } from "vite-plus/test";

test("a real stylesheet exists and styles the shell surfaces", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  for (const selector of ["#nav", "#app", "input", "button", "#qr-image", ".message"]) {
    expect(css).toContain(selector);
  }
});

test("main.ts imports the stylesheet so vite bundles it", () => {
  const main = readFileSync(new URL("../src/main.ts", import.meta.url), "utf8");
  expect(main).toContain('import "./styles.css"');
});
