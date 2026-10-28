import { expect, test } from "vite-plus/test";
import { renderQrTerminal } from "../src/qr-terminal.ts";

// 3x3 toy matrix (row-major): a diagonal of dark modules
const matrix = { size: 3, data: [true, false, false, false, true, false, false, false, true] };
const ESC = "\x1b";
const ANSI = new RegExp(`${String.fromCharCode(27)}\\[[0-9;]*m`, "g");
const strip = (text: string) => text.replace(ANSI, "");

test("half-block mode: 4-module light quiet zone on every side, two module rows per line", () => {
  const out = renderQrTerminal(matrix);
  const lines = out.split("\n").filter((line) => line.length > 0);
  // 3 + 2*4 = 11 module rows → ceil(11 / 2) = 6 text lines
  expect(lines).toHaveLength(6);
  // 11 module columns per line, one glyph each
  // '▀' is one UTF-16 unit, so length counts glyphs
  for (const line of lines) expect(strip(line)).toHaveLength(11);
});

test("colors are explicit (never inherit the terminal theme) and every line resets", () => {
  const out = renderQrTerminal(matrix);
  expect(out).toContain(`${ESC}[30;47m`); // dark over light
  expect(out).toContain(`${ESC}[37;47m`); // light over light (quiet zone)
  for (const line of out.split("\n").filter(Boolean)) expect(line.endsWith(`${ESC}[0m`)).toBe(true);
  expect(strip(out)).not.toContain("#");
});

test("dark modules map to black, light to white, padding to white", () => {
  // first code row (module row 4 overall) pairs with row 5: x=4 is dark on top,
  // light below → fg black / bg white
  const lines = renderQrTerminal(matrix).split("\n");
  expect(lines[2]).toContain(`${ESC}[30;47m▀`);
  // a fully light line (top margin) has no black at all
  expect(lines[0]).not.toContain("30;");
  expect(lines[0]).not.toContain("40m");
});

test("ascii mode: two spaces per module with a background color, one line per module row", () => {
  const out = renderQrTerminal(matrix, { ascii: true });
  const lines = out.split("\n").filter((line) => line.length > 0);
  expect(lines).toHaveLength(11);
  for (const line of lines) {
    expect(strip(line)).toBe(" ".repeat(22));
    expect(line.endsWith(`${ESC}[0m`)).toBe(true);
  }
  expect(out).toContain(`${ESC}[40m`);
  expect(out).toContain(`${ESC}[47m`);
  expect(Buffer.byteLength(out, "utf8")).toBe(out.length); // ASCII only: one byte per char
});

test("margin is configurable", () => {
  const lines = renderQrTerminal(matrix, { ascii: true, margin: 1 })
    .split("\n")
    .filter((line) => line.length > 0);
  expect(lines).toHaveLength(5);
});
