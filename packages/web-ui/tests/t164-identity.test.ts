import { expect, test } from "vite-plus/test";
import { displayName, formatPhone } from "../src/state.ts";
import { contactRowHtml } from "../src/contacts.ts";

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

test("T164 P1 — contacts rows show the human name and phone, never the raw JID as text", () => {
  const html = contactRowHtml({
    jid: "358400000001@s.whatsapp.net",
    displayName: "Dana",
    phone: "+358 40 000 0001",
    name: "Dana",
    pushname: null,
    username: null,
    alias: null,
    source: "whatsapp",
  });
  expect(html).toContain(">Dana<");
  expect(html).toContain(">+358 40 000 0001<");
  expect(html).not.toContain(">358400000001@s.whatsapp.net<");
});
