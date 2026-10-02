import { expect, test } from "vite-plus/test";
import { escapeHtml } from "../src/escape.ts";

test("escapeHtml neutralizes script tags", () => {
  expect(escapeHtml("<script>alert(1)</script>")).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
});

test("escapeHtml escapes attribute-breaking quotes", () => {
  expect(escapeHtml('"><img src=x onerror=alert(1)>')).toBe(
    "&quot;&gt;&lt;img src=x onerror=alert(1)&gt;",
  );
});

test("escapeHtml leaves safe text untouched", () => {
  expect(escapeHtml("plain text 123 — ünïcode")).toBe("plain text 123 — ünïcode");
});
