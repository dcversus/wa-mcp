import { expect, test } from "vite-plus/test";
import {
  pairingHtml,
  pairingState,
  qrLifetimePct,
  type PairingView,
} from "../src/pages-pairing.ts";

const baseView: PairingView = {
  pane: "connecting",
  health: { status: "unpaired", pairingAttempts: { used: 1, limit: 3 } },
  qr: { qr: null, png: null },
  countdownPct: 0,
};

test("unscanned, expired codes show the reload pane — never a silent new registration", () => {
  const qr = { qr: null, png: null, expired: true };
  expect(pairingState({ status: "unpaired" }, qr)).toBe("expired");
  const html = pairingHtml({ ...baseView, pane: "expired", qr });
  expect(html).toContain('id="pairing-reload"');
  expect(html).toContain("Show a new QR code");
  expect(html).toContain("1/3");
});

test("blocked still wins over expired (the budget pane explains the cooldown)", () => {
  expect(pairingState({ pairingBlocked: true }, { qr: null, png: null, expired: true })).toBe(
    "blocked",
  );
});

test("a paired daemon is paired even if an old registration expired", () => {
  expect(pairingState({ connected: true }, { qr: null, png: null, expired: true })).toBe("paired");
});

test("the countdown follows the bridge's schedule: 60 s for the first code, 20 s after", () => {
  const now = Date.parse("2026-10-29T10:00:30Z");
  expect(
    qrLifetimePct({ qr: "a", png: null, index: 1, expiresAt: "2026-10-29T10:01:00Z" }, now),
  ).toBe(50);
  expect(
    qrLifetimePct({ qr: "b", png: null, index: 2, expiresAt: "2026-10-29T10:00:40Z" }, now),
  ).toBe(50);
  expect(
    qrLifetimePct({ qr: "c", png: null, index: 3, expiresAt: "2026-10-29T10:00:20Z" }, now),
  ).toBe(0);
  expect(qrLifetimePct({ qr: "d", png: null }, now)).toBeNull();
});
