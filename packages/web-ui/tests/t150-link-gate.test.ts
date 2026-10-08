import { expect, test } from "vite-plus/test";
import { firstRunGate } from "../src/state.ts";
import { contactsPageHtml } from "../src/contacts.ts";
import { pairingHtml } from "../src/pages-pairing.ts";

test("T150 F3 — an unpaired user on #/ gets the pairing pane", () => {
  expect(firstRunGate({ loggedIn: false, contactsWarm: false, chatCount: 0, hash: "#/" })).toEqual({
    renderPairing: true,
    banner: false,
    syncing: false,
  });
});

test("T150 F3 — an unpaired user on #/contacts gets the pairing pane", () => {
  expect(
    firstRunGate({ loggedIn: false, contactsWarm: true, chatCount: 5, hash: "#/contacts" }),
  ).toEqual({ renderPairing: true, banner: false, syncing: false });
});

test("T150 F3 — unpaired on any other route: page renders with a link banner", () => {
  expect(
    firstRunGate({ loggedIn: false, contactsWarm: true, chatCount: 2, hash: "#/profile" }),
  ).toEqual({ renderPairing: false, banner: true, syncing: false });
  expect(
    firstRunGate({ loggedIn: false, contactsWarm: true, chatCount: 2, hash: "#/pairing" }),
  ).toEqual({ renderPairing: false, banner: false, syncing: false });
});

test("T150 F3 — paired but store cold: contacts show a loading state, not a dead end", () => {
  expect(
    firstRunGate({ loggedIn: true, contactsWarm: false, chatCount: 0, hash: "#/contacts" }),
  ).toEqual({ renderPairing: false, banner: false, syncing: true });
});

test("T150 F3 — paired and warm: no gate anywhere", () => {
  expect(
    firstRunGate({ loggedIn: true, contactsWarm: true, chatCount: 3, hash: "#/contacts" }),
  ).toEqual({ renderPairing: false, banner: false, syncing: false });
});

test("T150 F3 — the loading empty state tells the user contacts are coming", () => {
  const html = contactsPageHtml({ contacts: [], total: 0, query: "", saved: true, syncing: true });
  expect(html).toContain("Loading your contacts from your phone");
  expect(html).not.toContain("they appear after your first message");
});

test("T150 F3 — the pairing pane carries the one-line explainer when gated", () => {
  const html = pairingHtml({
    pane: "connecting",
    health: {},
    qr: { qr: null, png: null },
    countdownPct: 0,
    intro: "Link WhatsApp to your AI agent — pair once, then your agent reads and sends.",
  });
  expect(html).toContain("Link WhatsApp to your AI agent");
});
