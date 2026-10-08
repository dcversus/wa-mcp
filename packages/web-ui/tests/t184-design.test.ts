import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { connectionsPageHtml } from "../src/connections.ts";
import { contactsPageHtml } from "../src/contacts.ts";
import { EMPTY_LOG_FILTER, logRowHtml, logsPageHtml, type LogsPageInput } from "../src/logs.ts";
import { errorBannerHtml, messageListHtml, statusCardHtml } from "../src/pages.ts";
import { subscriptionsPageHtml } from "../src/subscriptions.ts";

const SRC = join(import.meta.dirname, "..", "src");
const css = readFileSync(join(SRC, "styles.css"), "utf8");

function block(selector: string): string {
  const start = css.startsWith(`${selector} {`) ? 0 : css.indexOf(`\n${selector} {`);
  expect(start, selector).toBeGreaterThan(-1);
  return css.slice(start, css.indexOf("}", start));
}

test("T184 emoji ban — no pictographic emoji anywhere in web-ui source or styles", () => {
  for (const file of readdirSync(SRC)) {
    const text = readFileSync(join(SRC, file), "utf8");
    const hits = [...text.matchAll(/\p{Extended_Pictographic}/gu)].map((match) => match[0]);
    expect(hits, file).toEqual([]);
  }
});

test("T184 type — native premium stacks: sans body, serif display, mono meta; banned faces gone", () => {
  expect(css).toMatch(/--font-sans:[^;]*-apple-system/);
  expect(css).toMatch(/--font-serif:[^;]*ui-serif/);
  expect(css).toMatch(/--font-mono:[^;]*ui-monospace/);
  for (const banned of ["Inter", "Roboto", "Arial", "Open Sans", "Helvetica"]) {
    expect(css, banned).not.toContain(banned);
  }
  expect(block("h1")).toContain("font-family: var(--font-serif)");
  expect(block("h1")).toMatch(/letter-spacing: -0\.0[234]em/);
  expect(css).toMatch(/--fs-xl: clamp\(/);
  expect(css).toContain("font-variant-numeric: tabular-nums");
});

test("T184 palette — warm monochrome canvas, off-black text, muted grey, pastel semantic chips", () => {
  const root = block(":root");
  expect(root).toContain("--bg: #f7f6f3");
  expect(root).toContain("--surface: #ffffff");
  expect(root).toContain("--border: #eaeaea");
  expect(root).toContain("--text: #2f3437");
  expect(root).toContain("--text-dim: #787774");
  for (const pair of [
    "#edf3ec",
    "#346538",
    "#fdebec",
    "#9f2f2d",
    "#fbf3db",
    "#956400",
    "#e1f3fe",
    "#1f6c9f",
  ]) {
    expect(root, pair).toContain(pair);
  }
  expect(css).not.toMatch(/gradient\(/);
});

test("T184 tokens — spacing scale, radii capped at 12px, near-invisible shadows", () => {
  const root = block(":root");
  for (const token of [
    "--s1: 4px",
    "--s2: 8px",
    "--s3: 12px",
    "--s4: 16px",
    "--s5: 24px",
    "--s6: 32px",
    "--s7: 48px",
  ]) {
    expect(root, token).toContain(token);
  }
  for (const [, px] of root.matchAll(/--r[a-z-]*: (\d+)px/g)) {
    expect(Number(px)).toBeLessThanOrEqual(12);
  }
  for (const [, alpha] of css.matchAll(/rgba\(0, 0, 0, (0\.\d+)\)/g)) {
    expect(Number(alpha)).toBeLessThan(0.08);
  }
});

test("T184 dark theme — every colour token is redefined under prefers-color-scheme: dark", () => {
  const start = css.indexOf("@media (prefers-color-scheme: dark)");
  expect(start).toBeGreaterThan(-1);
  const dark = css.slice(start, css.indexOf("\n}\n", start));
  const colourTokens = [...block(":root").matchAll(/(--[a-z0-9-]+): #/g)].map((match) => match[1]);
  expect(colourTokens.length).toBeGreaterThan(10);
  for (const token of colourTokens) {
    expect(dark, token).toContain(`${token}:`);
  }
  expect(css).toContain("color-scheme: light dark");
});

test("T184 motion — custom curves only, 150–250ms interactions, reduced motion respected", () => {
  expect(css).toMatch(/--ease: cubic-bezier\(/);
  expect(css).not.toMatch(/\blinear\b/);
  expect(css).not.toMatch(/ease-in-out/);
  for (const [, ms] of css.matchAll(/--dur[a-z-]*: (\d+)ms/g)) {
    expect(Number(ms)).toBeGreaterThanOrEqual(150);
    expect(Number(ms)).toBeLessThanOrEqual(250);
  }
  const reduced = css.slice(css.indexOf("@media (prefers-reduced-motion: reduce)"));
  expect(reduced).toContain("transition-duration: 0.01ms");
  expect(reduced).toContain("animation-duration: 0.01ms");
});

test("T184 structure — tokens → base → layout → components → pages → motion", () => {
  const order = [
    ":root {",
    "\nbody {",
    "\n#nav {",
    "\nbutton {",
    "\n#logs-page",
    "@media (prefers-reduced-motion: reduce)",
  ].map((marker) => css.indexOf(marker));
  expect(order.every((index) => index >= 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
});

test("T184 components — one card style, black primary button, visible focus ring, chips", () => {
  expect(css).toContain(".panel,\n.pane,");
  expect(block("button.primary,\n.send-box button")).toContain("background: var(--primary)");
  expect(css).toContain(":focus-visible");
  expect(css).toContain("--focus-ring:");
  expect(block(".badge,\n.chip,\n.dir-badge")).toContain("border-radius: 999px");
  expect(block(".badge,\n.chip,\n.dir-badge")).toContain("text-transform: uppercase");
});

test("T184 markup — status card uses a status dot, not emoji", () => {
  const linked = statusCardHtml(
    { loggedIn: true, connected: true },
    { name: "Ana", pn: "351910000001" },
  );
  expect(linked).toContain(
    '<span class="status-dot ok" aria-hidden="true"></span>Linked as <strong>',
  );
  const unlinked = statusCardHtml({}, null);
  expect(unlinked).toContain(
    '<span class="status-dot warn" aria-hidden="true"></span>WhatsApp not linked — <a href="#/pairing">Link now</a>',
  );
});

const INPUT: LogsPageInput = {
  filter: EMPTY_LOG_FILTER,
  rows: [],
  chats: [],
  people: [],
  resolveName: () => null,
  live: false,
  page: 0,
  hasMore: false,
};

test("T184 markup — log direction is an SVG arrow chip; the select uses words", () => {
  const row = {
    id: "M1",
    chatJid: "1@g.us",
    senderJid: null,
    senderName: null,
    timestamp: "2026-10-08T10:00:00Z",
    content: "hi",
    mediaType: null,
  };
  const inbound = logRowHtml({ ...row, isFromMe: false }, INPUT);
  expect(inbound).toMatch(
    /<span class="dir-badge dir-in"><svg class="icon"[^>]*aria-hidden="true"[^>]*>.*<\/svg>in<\/span>/,
  );
  const outbound = logRowHtml({ ...row, isFromMe: true }, INPUT);
  expect(outbound).toMatch(
    /<span class="dir-badge dir-out"><svg class="icon"[^>]*>.*<\/svg>out<\/span>/,
  );
  const page = logsPageHtml(INPUT);
  expect(page).toContain('<option value="in">Incoming</option>');
  expect(page).toContain('<option value="out">Outgoing</option>');
});

test("T184 markup — media bubbles carry a typographic kind label instead of emoji", () => {
  const base = {
    chatJid: "c",
    senderName: null,
    timestamp: "2026-10-08T10:00:00Z",
    content: "notes.pdf",
    isFromMe: false,
    isUnread: false,
  };
  const html = messageListHtml("c", [
    { ...base, id: "a", mediaType: "audio" },
    { ...base, id: "s", mediaType: "sticker" },
    { ...base, id: "d", mediaType: "document" },
    { ...base, id: "p", poll: { question: "Lunch?", options: [{ label: "Yes", votes: 1 }] } },
  ]);
  for (const kind of ["Voice note", "Sticker", "Document", "Poll"]) {
    expect(html).toContain(`<span class="media-kind">${kind}</span>`);
  }
});

test("T184 markup — alert banners lose the warning emoji; the banner styles its own marker", () => {
  expect(errorBannerHtml("boom")).toContain('<div class="error-banner" role="alert">boom ');
  expect(
    contactsPageHtml({ contacts: [], total: 0, query: "", saved: true, error: "x" }),
  ).toContain('<div class="error-banner" role="alert">x</div>');
  expect(connectionsPageHtml({ connections: [], error: "x" })).toContain(
    '<div class="error-banner" role="alert">x</div>',
  );
  expect(
    subscriptionsPageHtml({
      subscriptions: [],
      chats: [],
      sessions: [],
      editing: null,
      error: "x",
    }),
  ).toContain('<div class="error-banner" role="alert">x</div>');
  expect(block(".error-banner,\n.send-error")).toContain("border-left");
});

test("T184 density — data rows stay tight: logs cells and contact rows use the small steps", () => {
  expect(block(".logs-table th,\n.logs-table td")).toContain("padding: var(--s2) var(--s3)");
  expect(block(".contact-row")).toContain("padding: var(--s2) var(--s3)");
  expect(block(".logs-table th")).toContain("letter-spacing");
});
