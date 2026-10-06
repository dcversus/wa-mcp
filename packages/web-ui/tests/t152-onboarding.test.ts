import { expect, test } from "vite-plus/test";
import { agentConnectHtml } from "../src/pages.ts";
import { pairedIdentityText, pairingHtml } from "../src/pages-pairing.ts";

test("T152 F4 — the connect-your-agent card lists per-target install commands", () => {
  const html = agentConnectHtml();
  expect(html).toContain("wa-mcp install --target claude-code");
  expect(html).toContain("wa-mcp install --target cursor");
  expect(html).toContain('data-copy-cmd="wa-mcp install --target claude-code"');
});

test("T152 F4 — the paired pane ends with the connect-your-agent step", () => {
  const html = pairingHtml({
    pane: "paired",
    health: { connected: true },
    qr: { qr: null, png: null },
    countdownPct: 0,
    me: "Versus (+358497773518)",
  });
  expect(html).toContain("Connect your agent");
  expect(html).toContain("wa-mcp install --target claude-code");
});

test("T152 F8 — the error pane recovers with a real button, not a dead anchor", () => {
  const html = pairingHtml({
    pane: "error",
    health: {},
    qr: { qr: null, png: null },
    countdownPct: 0,
    error: "invalid number",
  });
  expect(html).toContain('id="pairing-retry"');
  expect(html).not.toContain('<a href="#/pairing">try again</a>');
});

test("T152 F10 — the phone placeholder is a neutral example, not the owner's number", () => {
  const html = pairingHtml({
    pane: "methods",
    health: {},
    qr: { qr: "ref", png: null },
    countdownPct: 50,
  });
  expect(html).toContain('placeholder="e.g. 447700900123"');
  expect(html).not.toContain("358497773518");
});

test("T152 F14 — the paired pane names the linked account", () => {
  expect(pairedIdentityText({ name: "Versus", pn: "358497773518" })).toBe("Versus (+358497773518)");
  expect(pairedIdentityText({ name: null, pn: "358497773518" })).toBe("+358497773518");
  expect(pairedIdentityText({ name: "Versus", pn: null })).toBe("Versus");
  expect(pairedIdentityText(null)).toBeNull();
});
