import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";

const desktop = readFileSync(
  join(import.meta.dirname, "../../../docs/getting-started/desktop.md"),
  "utf8",
);
const pagesPairing = readFileSync(
  join(import.meta.dirname, "../../web-ui/src/pages-pairing.ts"),
  "utf8",
);
const pages = readFileSync(join(import.meta.dirname, "../../web-ui/src/pages.ts"), "utf8");
const main = readFileSync(join(import.meta.dirname, "../../web-ui/src/main.ts"), "utf8");

test("the desktop path never requires a terminal to pair", () => {
  expect(pagesPairing).toContain('id="phone-form"');
  expect(desktop).toContain("phone-number form");
  expect(desktop).toContain("Link with phone number instead");
  expect(desktop).not.toMatch(/must run|run this command|required command/i);
});

test("the UI pages the doc names all exist", () => {
  for (const name of ["contacts", "subscriptions", "settings", "pairing"]) {
    const present =
      pages.includes(`id: "${name}"`) ||
      pages.includes(`id="${name}"`) ||
      pages.includes(`${name}Html`) ||
      pagesPairing.includes(name);
    expect(present, `expected UI surface for #/${name}`).toBe(true);
  }
});

test("settings covers transcription as the doc claims", () => {
  expect(pages).toContain("transcriptionSettingsHtml");
  expect(desktop).toContain("transcription engine");
});

test("bootstrap-with-zero-action claim matches the code comment", () => {
  expect(main).toContain("without any user action");
});
