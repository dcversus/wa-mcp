import { expect, test } from "vite-plus/test";
import { displayName, formatPhone } from "../src/state.ts";
import { unreadHtml, contactsPageHtml } from "../src/pages.ts";

test("T164 P1 — formatPhone renders the WhatsApp-style grouping", () => {
  expect(formatPhone("358497773518")).toBe("+358 49 777 3518");
  expect(formatPhone("358400000001@s.whatsapp.net")).toBe("+358 40 000 0001");
  expect(formatPhone("120363428874442773@g.us")).toBe("120363428874442773@g.us");
});

test("T164 P1 — displayName prefers contact name, then alias, then phone, then Unknown", () => {
  const contacts = { "358400000001@s.whatsapp.net": "Dana", "999@lid": null };
  const aliases = { "358400000002@s.whatsapp.net": "The Landlord" };
  expect(displayName("358400000001@s.whatsapp.net", contacts, aliases)).toBe("Dana");
  expect(displayName("358400000002@s.whatsapp.net", contacts, aliases)).toBe("The Landlord");
  expect(displayName("358497773518@s.whatsapp.net", contacts, aliases)).toBe("+358 49 777 3518");
  expect(displayName("120363428874442773@g.us", contacts, aliases)).toBe("Unknown");
});

test("T164 P1 — unread rows show human names with the JID behind details", () => {
  const html = unreadHtml([{ chatJid: "358400000001@s.whatsapp.net", unreadCount: 3 }], (jid) =>
    displayName(jid, { "358400000001@s.whatsapp.net": "Dana" }),
  );
  expect(html).toContain("Dana");
  expect(html).toContain("<details");
  expect(html).toContain("358400000001@s.whatsapp.net");
});

test("T164 P1 — contacts rows keep the JID behind a details disclosure", () => {
  const html = contactsPageHtml([{ jid: "358400000001@s.whatsapp.net", name: "Dana" }]);
  expect(html).toContain("Dana");
  expect(html).toContain("<details");
  expect(html).toContain("358400000001@s.whatsapp.net");
});
