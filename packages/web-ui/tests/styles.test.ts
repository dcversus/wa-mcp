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

test("T101-redesign — light theme tokens are the defaults", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  expect(css).toContain("--bg: #f7f8fa");
  expect(css).toContain("--surface: #ffffff");
  expect(css).toContain("--border: #e4e7ec");
  expect(css).toContain("--text: #1a1d23");
  expect(css).toContain("--accent:");
  expect(css).not.toContain("--bg: #0f1420");
});

test("T101-redesign — modern compact base: Inter stack, 13px, soft shadow, 8px radius", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  expect(css).toContain("Inter");
  expect(css).toContain("font-size: 13px");
  expect(css).toContain("0 1px 2px rgba(16, 24, 40, 0.06)");
  expect(css).toContain("--radius: 8px");
});

test("T101-redesign — checkboxes are styled check rows, not floating inputs", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  expect(css).toContain(".check-row");
  expect(css).toContain("accent-color");
  expect(css).toContain("align-items: center");
  const pages = [
    readFileSync(new URL("../src/pages.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/pages-pairing.ts", import.meta.url), "utf8"),
  ].join("\n");
  expect(pages).toContain('class="check-row"');
});

test("T101-redesign — spacing scale tokens exist", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  for (const token of ["--s1: 4px", "--s2: 8px", "--s3: 12px", "--s4: 16px"]) {
    expect(css).toContain(token);
  }
});
