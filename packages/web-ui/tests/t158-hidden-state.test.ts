import { expect, test } from "vite-plus/test";
import { contactsPageHtml, eventsPageHtml, profilePageHtml } from "../src/pages.ts";

test("T158 W9 — the contacts search box echoes the query", () => {
  const html = contactsPageHtml([{ jid: "1@s.whatsapp.net", name: "A" }], "anette");
  expect(html).toContain('value="anette"');
});

test("T158 W9 — a no-match contact search says so and offers a way back", () => {
  const html = contactsPageHtml([], "zzzz");
  expect(html).toContain("No contacts match");
  expect(html).toContain('id="clear-contacts-search"');
  expect(html).not.toContain("No contacts yet");
});

test("T158 W9 — the events pause button renders its real state", () => {
  expect(eventsPageHtml([], { paused: false })).toContain(">pause</button>");
  expect(eventsPageHtml([], { paused: true })).toContain(">resume</button>");
});

test("T158 W7 — privacy selects render disabled while the value is unknown", () => {
  const loading = profilePageHtml({
    blocklist: [],
    me: { pn: null, name: null, status: null },
    privacy: {},
  });
  expect((loading.match(/<select data-privacy-key="[^"]*" disabled/g) ?? []).length).toBe(8);
  const loaded = profilePageHtml({
    blocklist: [],
    me: { pn: null, name: null, status: null },
    privacy: { last: "contacts", online: "all" },
  });
  expect(loaded).toContain('<select data-privacy-key="last">');
  expect(loaded).toContain('<select data-privacy-key="online">');
  expect((loaded.match(/ disabled/g) ?? []).length).toBe(6);
});
