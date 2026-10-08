import { expect, test } from "vite-plus/test";
import { profilePageHtml } from "../src/pages.ts";
import { contactsPageHtml } from "../src/contacts.ts";

test("T158 W9 — the contacts search box echoes the query", () => {
  const html = contactsPageHtml({ contacts: [], total: 0, query: "anette", saved: false });
  expect(html).toContain('value="anette"');
});

test("T158 W9 — a no-match contact search says so and offers a way back", () => {
  const html = contactsPageHtml({ contacts: [], total: 0, query: "zzzz", saved: false });
  expect(html).toContain("No contacts match");
  expect(html).toContain('id="clear-contacts-search"');
  expect(html).not.toContain("No contacts yet");
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
