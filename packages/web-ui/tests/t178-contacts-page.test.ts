import { expect, test } from "vite-plus/test";
import { createApiClient } from "../src/api.ts";
import {
  contactRenameFormHtml,
  contactRowHtml,
  contactsPageHtml,
  validateNewContact,
  type ContactView,
} from "../src/contacts.ts";

const DANA: ContactView = {
  jid: "358400000001@s.whatsapp.net",
  displayName: "Dana Scully",
  phone: "+358 40 000 0001",
  name: "Dana Scully",
  pushname: "dana.s",
  username: null,
  alias: null,
  source: "whatsapp",
};
const ERIK: ContactView = {
  jid: "358400000002@s.whatsapp.net",
  displayName: "Erik",
  phone: "+358 40 000 0002",
  name: null,
  pushname: "Erik",
  username: "erik_w",
  alias: null,
  source: "whatsapp",
};

function recordingClient() {
  const calls: Array<{ path: string; init?: RequestInit }> = [];
  const client = createApiClient({
    baseUrl: "http://bridge",
    token: "tok",
    fetchFn: (async (url: string | URL, init?: RequestInit) => {
      calls.push({ path: String(url).slice("http://bridge".length), init });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch,
    onUnauthorized: () => {},
  });
  return { client, calls };
}

test("T178 B3 row — initials avatar, name, formatted phone, opens the chat", () => {
  const html = contactRowHtml(DANA);
  expect(html).toContain('<span class="avatar" aria-hidden="true">DS</span>');
  expect(html).toContain("Dana Scully");
  expect(html).toContain("+358 40 000 0001");
  expect(html).toContain('href="#/chat/358400000001%40s.whatsapp.net"');
});

test("T178 B3 row — secondary 'on WhatsApp as' only when the WhatsApp name differs", () => {
  expect(contactRowHtml(DANA)).toContain("on WhatsApp as ~dana.s");
  expect(contactRowHtml(ERIK)).not.toContain("on WhatsApp as ~Erik");
  expect(contactRowHtml({ ...ERIK, pushname: null, username: null })).not.toContain(
    "on WhatsApp as",
  );
  expect(contactRowHtml({ ...DANA, pushname: null, username: "dana_s" })).toContain(
    "on WhatsApp as @dana_s",
  );
});

test("T178 B3 row menu — rename (saved) / save (unsaved) and remove only for saved contacts", () => {
  const saved = contactRowHtml(DANA);
  expect(saved).toContain('data-rename-contact="358400000001@s.whatsapp.net"');
  expect(saved).toContain('data-remove-contact="358400000001@s.whatsapp.net"');
  expect(saved).toContain('data-contact-name="Dana Scully"');
  const unsaved = contactRowHtml(ERIK);
  expect(unsaved).toContain('data-rename-contact="358400000002@s.whatsapp.net"');
  expect(unsaved).toContain(">Save contact<");
  expect(unsaved).not.toContain("data-remove-contact");
});

test("T178 B3 inline rename — prefilled, escaped name input with save + cancel", () => {
  const html = contactRenameFormHtml("358400000001@s.whatsapp.net", 'Dana "X" <i>');
  expect(html).toContain('<form class="contact-rename"');
  expect(html).toContain('name="name"');
  expect(html).toContain('value="Dana &quot;X&quot; &lt;i&gt;"');
  expect(html).toContain('aria-label="New name for 358400000001@s.whatsapp.net"');
  expect(html).toContain('type="submit">Save<');
  expect(html).toContain("data-cancel-rename");
});

test("T178 B3 row — every interpolated value is escaped", () => {
  const html = contactRowHtml({
    ...DANA,
    jid: '1"><script>@s.whatsapp.net',
    displayName: "<img src=x onerror=alert(1)>",
    pushname: "<b>",
  });
  expect(html).not.toContain("<img");
  expect(html).not.toContain("<script>");
  expect(html).not.toContain("<b>");
});

test("T178 B3 page — search (q), count, saved toggle, honest sync copy, new-contact form", () => {
  const html = contactsPageHtml({ contacts: [DANA, ERIK], total: 2, query: "", saved: false });
  expect(html).toContain('id="contact-search"');
  expect(html).toContain('name="q"');
  expect(html).toContain('type="search"');
  expect(html).toContain('<span id="contacts-count">2 contacts</span>');
  expect(html).toContain('name="saved"');
  expect(html).toContain("Changes sync to your WhatsApp account, like WhatsApp Web.");
  expect(html).toContain('id="contact-new"');
  expect(html).toContain('name="name"');
  expect(html).toContain('name="phone"');
  expect(html).toContain('pattern="\\+[0-9 ()-]{8,20}"');
  expect(html).toContain('name="username"');
  expect(html.match(/data-contact-jid=/g)).toHaveLength(2);
});

test("T178 B3 page — count reflects totals beyond the page and the singular", () => {
  expect(contactsPageHtml({ contacts: [DANA], total: 1, query: "", saved: true })).toContain(
    "1 contact<",
  );
  const capped = contactsPageHtml({ contacts: [DANA], total: 1200, query: "", saved: false });
  expect(capped).toContain("Showing 1 of 1200 — refine the search");
  expect(contactsPageHtml({ contacts: [], total: 0, query: "", saved: true })).toContain(
    'name="saved" value="true" checked',
  );
});

test("T178 B3 page — empty states: no match offers clear; empty roster explains the sync", () => {
  const miss = contactsPageHtml({ contacts: [], total: 0, query: "zz<", saved: false });
  expect(miss).toContain("No contacts match “zz&lt;”");
  expect(miss).toContain('id="clear-contacts-search"');
  const empty = contactsPageHtml({ contacts: [], total: 0, query: "", saved: false });
  expect(empty).toContain("No contacts yet. They appear once your phone syncs.");
});

test("T178 B3 page — a write error renders as an alert banner", () => {
  const html = contactsPageHtml({
    contacts: [],
    total: 0,
    query: "",
    saved: false,
    error: "+358400000009 is not on WhatsApp",
  });
  expect(html).toContain('role="alert"');
  expect(html).toContain("+358400000009 is not on WhatsApp");
});

test("T178 B3 form validation — name required, +country-code phone, optional username", () => {
  expect(validateNewContact({ name: " Dana ", phone: "+358 40 000 0001", username: "" })).toEqual({
    ok: true,
    value: { name: "Dana", phone: "+358 40 000 0001" },
  });
  expect(
    validateNewContact({ name: "Dana", phone: "+358400000001", username: " dana_s " }),
  ).toEqual({ ok: true, value: { name: "Dana", phone: "+358400000001", username: "dana_s" } });
  expect(validateNewContact({ name: "", phone: "+358400000001", username: "" })).toEqual({
    ok: false,
    message: "Enter a name",
  });
  expect(validateNewContact({ name: "Dana", phone: "358400000001", username: "" })).toEqual({
    ok: false,
    message: "Start the number with + and the country code",
  });
  expect(validateNewContact({ name: "Dana", phone: "+35840", username: "" })).toEqual({
    ok: false,
    message: "The number needs 8–15 digits including the country code",
  });
});

test("T178 api — an explicit method wins over the json-implies-POST default (PUT /api/config)", async () => {
  const { client, calls } = recordingClient();
  await client.saveConfig({ transcription: { engine: "none" } });
  expect(calls[0]?.init?.method).toBe("PUT");
});

test("T178 B3 api — contacts(q, saved, limit) + add/rename/remove hit the contact endpoints", async () => {
  const { client, calls } = recordingClient();
  await client.contacts({ q: "dana", saved: true, limit: 500 });
  await client.contacts({});
  await client.addContact({ name: "Dana", phone: "+358400000001", username: "dana_s" });
  await client.renameContact("358400000001@s.whatsapp.net", "Agent Scully");
  await client.removeContact("358400000001@s.whatsapp.net");
  expect(calls.map((call) => [call.init?.method ?? "GET", call.path])).toEqual([
    ["GET", "/api/contacts?q=dana&saved=true&limit=500"],
    ["GET", "/api/contacts"],
    ["POST", "/api/contacts"],
    ["PATCH", "/api/contacts/358400000001%40s.whatsapp.net"],
    ["DELETE", "/api/contacts/358400000001%40s.whatsapp.net"],
  ]);
  expect(JSON.parse(calls[2]?.init?.body as string)).toEqual({
    name: "Dana",
    phone: "+358400000001",
    username: "dana_s",
  });
  expect(JSON.parse(calls[3]?.init?.body as string)).toEqual({ name: "Agent Scully" });
});
