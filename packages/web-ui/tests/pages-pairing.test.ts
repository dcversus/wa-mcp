import { expect, test } from "vite-plus/test";
import {
  pairingHtml,
  pairingState,
  qrCountdownPct,
  type PairingHealth,
} from "../src/pages-pairing.ts";

const HEALTH_QR: PairingHealth = {
  status: "qr",
  connected: false,
  pairingBlocked: false,
  pairingAttempts: { used: 0, limit: 3 },
};

test("pairingState: qr + no creds → methods pane", () => {
  expect(pairingState(HEALTH_QR, { qr: "wa.me/x", png: "cG5n" })).toBe("methods");
});

test("pairingState: connected → paired pane wins over everything", () => {
  expect(
    pairingState({ ...HEALTH_QR, status: "connected", connected: true }, { qr: null, png: null }),
  ).toBe("paired");
});

test("pairingState: pairingBlocked → blocked pane wins over qr", () => {
  expect(
    pairingState(
      {
        ...HEALTH_QR,
        status: "pairing-blocked",
        pairingBlocked: true,
        pairingAttempts: { used: 3, limit: 3 },
      },
      { qr: "wa.me/x", png: "cG5n" },
    ),
  ).toBe("blocked");
});

test("pairingState: error beats qr", () => {
  expect(pairingState(HEALTH_QR, { qr: null, png: null }, null, "pairing-code rejected")).toBe(
    "error",
  );
});

test("qrCountdownPct is linear and clamps", () => {
  expect(qrCountdownPct(60_000, 0, 60_000)).toBe(100);
  expect(qrCountdownPct(60_000, 30_000, 60_000)).toBe(50);
  expect(qrCountdownPct(60_000, 61_000, 60_000)).toBe(0);
});

test("pairingHtml renders all three methods with data hooks", () => {
  const html = pairingHtml({
    pane: "methods",
    health: HEALTH_QR,
    qr: { qr: "wa.me/settings/linked_devices#REF", png: "cG5n" },
    countdownPct: 80,
  });
  expect(html).toContain('id="qr-image"');
  expect(html).toContain('id="qr-countdown"');
  expect(html).toContain('id="phone-form"');
  expect(html).toContain('id="phone-input"');
  expect(html).toContain('id="pairing-code-display"');
  expect(html).toContain('id="link-input"');
  expect(html).toContain('data-copy-url="wa.me/settings/linked_devices#REF"');
  expect(html).toContain('id="resume-pairing"');
});

test("pairingHtml escapes the qr payload in attributes", () => {
  const html = pairingHtml({
    pane: "methods",
    health: HEALTH_QR,
    qr: { qr: '"><script>x</script>', png: null },
    countdownPct: 10,
  });
  expect(html).not.toContain("<script>x</script>");
});

test("pairingHtml blocked pane shows attempts, explanation and resume action — no QR", () => {
  const html = pairingHtml({
    pane: "blocked",
    health: {
      ...HEALTH_QR,
      status: "pairing-blocked",
      pairingBlocked: true,
      pairingAttempts: { used: 3, limit: 3 },
    },
    qr: { qr: "wa.me/stale", png: null },
    countdownPct: 0,
  });
  expect(html).toContain("pairing attempts exhausted");
  expect(html).toContain("3 of 3");
  expect(html).toContain("anti-abuse");
  expect(html).toContain('id="resume-pairing"');
  expect(html).not.toContain('id="qr-image"');
});

test("pairingHtml connecting + paired + error panes", () => {
  expect(
    pairingHtml({
      pane: "connecting",
      health: HEALTH_QR,
      qr: { qr: null, png: null },
      countdownPct: 0,
    }),
  ).toContain("connecting");
  const paired = pairingHtml({
    pane: "paired",
    health: { ...HEALTH_QR, connected: true },
    qr: { qr: null, png: null },
    countdownPct: 0,
    me: "Versus",
  });
  expect(paired).toContain("paired as");
  expect(paired).toContain("Versus");
  const errored = pairingHtml({
    pane: "error",
    health: HEALTH_QR,
    qr: { qr: null, png: null },
    countdownPct: 0,
    error: "<script>boom</script>",
  });
  expect(errored).toContain("&lt;script&gt;boom");
  expect(errored).not.toContain("<script>boom");
});
