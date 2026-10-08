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

test("T184 — light theme tokens are the defaults; dark is a media override", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  const root = css.slice(0, css.indexOf("}"));
  expect(root).toContain("--bg: #f7f6f3");
  expect(root).toContain("--surface: #ffffff");
  expect(root).toContain("--border: #eaeaea");
  expect(root).toContain("--text: #2f3437");
  expect(root).toContain("--accent:");
  expect(css.indexOf("--bg: #191918")).toBeGreaterThan(
    css.indexOf("@media (prefers-color-scheme: dark)"),
  );
});

test("T184 — compact editorial base: native sans stack, 13.5px body, hairline shadow, crisp radii", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  expect(css).toContain("font-family: var(--font-sans)");
  expect(css).toContain("--fs-md: 13.5px");
  expect(css).toContain("--shadow-1: 0 1px 2px rgba(0, 0, 0, 0.03)");
  expect(css).toContain("--r-lg: 10px");
});

test("T101-redesign — checkboxes are styled check rows, not floating inputs", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  expect(css).toContain(".check-row");
  expect(css).toContain("accent-color");
  expect(css).toContain("align-items: center");
  const pages = [
    readFileSync(new URL("../src/pages.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/pages-pairing.ts", import.meta.url), "utf8"),
    readFileSync(new URL("../src/subscriptions.ts", import.meta.url), "utf8"),
  ].join("\n");
  expect(pages).toContain('class="check-row"');
});

test("T101-redesign — spacing scale tokens exist", () => {
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  for (const token of ["--s1: 4px", "--s2: 8px", "--s3: 12px", "--s4: 16px"]) {
    expect(css).toContain(token);
  }
});
