import { escapeHtml } from "./escape.ts";
import { emptyState, initials } from "./pages.ts";

export interface ContactView {
  jid: string;
  displayName: string;
  phone: string | null;
  name: string | null;
  pushname: string | null;
  username: string | null;
  alias: string | null;
  source: "whatsapp" | "alias";
}

export interface ContactsPageView {
  contacts: ContactView[];
  total: number;
  query: string;
  saved: boolean;
  error?: string;
  notice?: string;
  syncing?: boolean;
}

export interface NewContactInput {
  name: string;
  phone: string;
  username?: string;
}

export const CONTACTS_PAGE_SIZE = 500;

function whatsAppName(contact: ContactView): string | null {
  if (contact.pushname !== null && contact.pushname.length > 0) {
    return contact.pushname === contact.displayName ? null : `~${contact.pushname}`;
  }
  if (contact.username !== null && contact.username.length > 0) {
    return contact.username === contact.displayName ? null : `@${contact.username}`;
  }
  return null;
}

export function contactRowHtml(contact: ContactView): string {
  const jid = escapeHtml(contact.jid);
  const saved = contact.name !== null && contact.name.length > 0;
  const onWhatsApp = whatsAppName(contact);
  const secondary = [
    contact.phone === null ? "" : `<span class="contact-phone">${escapeHtml(contact.phone)}</span>`,
    onWhatsApp === null
      ? ""
      : `<span class="contact-wa">on WhatsApp as ${escapeHtml(onWhatsApp)}</span>`,
  ].join("");
  const menu = saved
    ? `<button data-rename-contact="${jid}" data-contact-name="${escapeHtml(contact.name ?? "")}" type="button">Rename</button> <button class="danger" data-remove-contact="${jid}" data-contact-name="${escapeHtml(contact.displayName)}" type="button">Remove</button>`
    : `<button data-rename-contact="${jid}" data-contact-name="${escapeHtml(contact.pushname ?? "")}" type="button">Save contact</button>`;
  return `<li class="contact-row" data-contact-jid="${jid}"><a class="contact-open" href="#/chat/${encodeURIComponent(contact.jid)}"><span class="avatar" aria-hidden="true">${escapeHtml(initials(contact.displayName))}</span><span class="contact-text"><span class="contact-name" dir="auto">${escapeHtml(contact.displayName)}</span><span class="contact-meta">${secondary}</span></span></a><span class="contact-menu">${menu}</span></li>`;
}

export function contactRenameFormHtml(jid: string, name: string): string {
  return `<form class="contact-rename"><input name="name" required autocomplete="off" aria-label="New name for ${escapeHtml(jid)}" value="${escapeHtml(name)}" /><button class="primary" type="submit">Save</button> <button data-cancel-rename type="button">Cancel</button></form>`;
}

export function contactsPageHtml(view: ContactsPageView): string {
  const count = `<span id="contacts-count">${view.total} ${view.total === 1 ? "contact" : "contacts"}</span>`;
  const capped =
    view.total > view.contacts.length && view.contacts.length > 0
      ? `<p class="hint">Showing ${view.contacts.length} of ${view.total} — refine the search</p>`
      : "";
  const empty =
    view.contacts.length > 0
      ? ""
      : view.query.length > 0
        ? `<p class="empty">No contacts match “${escapeHtml(view.query)}” — <button id="clear-contacts-search" type="button">Clear search</button></p>`
        : view.syncing === true
          ? `<div class="spinner"></div><p>Loading your contacts from your phone… keep WhatsApp open on your phone</p>`
          : emptyState("No contacts yet. Contacts appear automatically as you chat.");
  const notice =
    view.notice === undefined
      ? ""
      : `<p class="save-flash ok" role="status">${escapeHtml(view.notice)}</p>`;
  const error =
    view.error === undefined
      ? ""
      : `<div class="error-banner" role="alert">⚠ ${escapeHtml(view.error)}</div>`;
  const search = `<form id="contact-search" role="search"><input type="search" name="q" placeholder="Search name, username or number" aria-label="Search contacts" autocomplete="off" value="${escapeHtml(view.query)}" /><label class="check-row"><input type="checkbox" name="saved" value="true"${view.saved ? " checked" : ""} /> only saved contacts</label>${count}</form>`;
  const form = `<details class="contact-new"><summary>New contact</summary><form id="contact-new"><label>Name<input name="name" required autocomplete="off" /></label><label>Phone<input name="phone" type="tel" required placeholder="+358 40 123 4567" pattern="\\+[0-9 ()-]{8,20}" /></label><label>Username (optional)<input name="username" autocomplete="off" /></label><button class="primary" type="submit">Save contact</button></form></details>`;
  return `<section id="contacts-page"><h1>Contacts</h1>${notice}${error}${search}${form}<ul id="contacts-list">${view.contacts.map(contactRowHtml).join("")}</ul>${capped}${empty}</section>`;
}

export function validateNewContact(raw: {
  name: string;
  phone: string;
  username: string;
}): { ok: true; value: NewContactInput } | { ok: false; message: string } {
  const name = raw.name.trim();
  if (name.length === 0) {
    return { ok: false, message: "Enter a name" };
  }
  const phone = raw.phone.trim();
  if (!phone.startsWith("+")) {
    return { ok: false, message: "Start the number with + and the country code" };
  }
  const digits = phone.replace(/[\s()+-]/g, "");
  if (!/^\d{8,15}$/.test(digits)) {
    return { ok: false, message: "The number needs 8–15 digits including the country code" };
  }
  const username = raw.username.trim();
  return { ok: true, value: { name, phone, ...(username.length > 0 ? { username } : {}) } };
}
