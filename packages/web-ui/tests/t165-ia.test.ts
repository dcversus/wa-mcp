import { expect, test } from "vite-plus/test";
import { renderFrame, type AppDom } from "../src/app.ts";
import { navHtml } from "../src/pages.ts";
import { pairingHtml } from "../src/pages-pairing.ts";

function fakeDom(hash: string) {
  const calls: Array<{ nav?: string; app?: string; title?: string; hash?: string }> = [];
  const dom: AppDom = {
    getHash: () => hash,
    setHash: (h) => calls.push({ hash: h }),
    setNav: (html) => calls.push({ nav: html }),
    setApp: (html) => calls.push({ app: html }),
    setTitle: (t) => calls.push({ title: t }),
  };
  return { dom, calls };
}

test("T165 P2 — unknown routes highlight nothing in the nav", async () => {
  const { dom, calls } = fakeDom("#/nope");
  await renderFrame({ dom, settings: { bridgeUrl: "", token: "" }, loaders: {} });
  const nav = calls.find((call) => call.nav !== undefined)?.nav ?? "";
  expect(nav).not.toContain('class="active"');
});

test("T165 P2 — the nav is Messages / People / Agent / Me / System", () => {
  const html = navHtml("chats");
  expect(html).toContain("Messages");
  expect(html).toContain("People");
  expect(html).toContain("Agent");
  expect(html).toContain("Me");
  expect(html).toContain("System");
  expect(html).toContain("Connections");
  expect(html).toContain("Subscriptions");
  expect(html).not.toContain("Link phone");
  expect(html).toContain("Connection");
  expect(html).toContain('aria-label="Main"');
  expect(html).toContain('aria-current="page"');
  expect(html).not.toContain(">Unread<");
});

test("T165 P2 — the linked pairing pane offers Unlink this computer", () => {
  const html = pairingHtml({
    pane: "paired",
    health: { connected: true },
    qr: { qr: null, png: null },
    countdownPct: 0,
    me: "Versus (+358497773518)",
  });
  expect(html).toContain('id="unlink-device"');
  expect(html).toContain("Unlink this computer");
});

test("T165 P2 — every page sets a document title", async () => {
  const { dom, calls } = fakeDom("#/profile");
  await renderFrame({
    dom,
    settings: { bridgeUrl: "", token: "" },
    loaders: { profile: async () => "<section></section>" },
  });
  expect(calls.some((call) => call.title === "Profile · wa-mcp")).toBe(true);
});
