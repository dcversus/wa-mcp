import { escapeHtml } from "./escape.ts";

const NAV_SECTIONS: Array<{ id: string; label: string; href: string }> = [
  { id: "status", label: "Status", href: "#/status" },
  { id: "chats", label: "Chats", href: "#/chats" },
  { id: "unread", label: "Unread", href: "#/unread" },
  { id: "contacts", label: "Contacts", href: "#/contacts" },
  { id: "groups", label: "Groups", href: "#/groups" },
  { id: "pairing", label: "Pairing", href: "#/pairing" },
  { id: "settings", label: "Settings", href: "#/settings" },
];

export function navHtml(active: string): string {
  return NAV_SECTIONS.map(
    (section) =>
      `<a href="${section.href}"${section.id === active ? ' class="active"' : ""} data-nav="${section.id}">${section.label}</a>`,
  ).join("");
}

export interface StatusDashboardInput {
  health: Record<string, unknown>;
  notifications: Array<{ id: string; chat_jid?: string; pattern?: string }>;
  events: Array<{ type: string; at: number; detail?: string }>;
}

export function statusDashboardHtml(input: StatusDashboardInput): string {
  const fields = Object.entries(input.health)
    .filter(([key]) => key !== "channel" || input.health.channel !== undefined)
    .map(
      ([key, value]) =>
        `<div class="stat"><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(String(value))}</dd></div>`,
    )
    .join("");
  const rules = input.notifications
    .map(
      (rule) =>
        `<li data-rule-id="${escapeHtml(rule.id)}"><span>${escapeHtml(rule.chat_jid ?? "*")}</span> <code>${escapeHtml(rule.pattern ?? "")}</code> <button data-delete-rule="${escapeHtml(rule.id)}">delete</button></li>`,
    )
    .join("");
  const feed = input.events
    .map(
      (event) =>
        `<li><time>${new Date(event.at).toISOString()}</time> <strong>${escapeHtml(event.type)}</strong> <span>${escapeHtml(event.detail ?? "")}</span></li>`,
    )
    .join("");
  return `<section id="status-dashboard"><h2>Status</h2><dl class="stats">${fields}</dl><h3>pairing rules</h3><ul class="rules">${rules}</ul><h3>events</h3><ul class="events">${feed}</ul></section>`;
}

export function contactsPageHtml(contacts: Array<{ jid: string; name: string | null }>): string {
  const items = contacts
    .map(
      (contact) =>
        `<li data-contact-jid="${escapeHtml(contact.jid)}"><span class="contact-name">${escapeHtml(contact.name ?? contact.jid)}</span> <code>${escapeHtml(contact.jid)}</code> <button data-alias-jid="${escapeHtml(contact.jid)}">set alias</button></li>`,
    )
    .join("");
  return `<section id="contacts-page"><form id="contact-search"><input name="query" placeholder="search contacts" /></form><ul id="contacts-list">${items}</ul></section>`;
}

export function groupsPageHtml(
  groups: Array<{ jid: string; name: string | null; unreadCount: number }>,
): string {
  const items = groups
    .map(
      (group) =>
        `<li data-group-jid="${escapeHtml(group.jid)}"><a href="#/chat/${encodeURIComponent(group.jid)}">${escapeHtml(group.name ?? group.jid)}</a>${group.unreadCount > 0 ? ` <span class="unread-badge">${group.unreadCount}</span>` : ""} <button data-leave-jid="${escapeHtml(group.jid)}">leave</button></li>`,
    )
    .join("");
  return `<section id="groups-page"><form id="group-create"><input name="subject" placeholder="group subject" /><button type="submit">create group</button></form><ul id="groups-list">${items}</ul></section>`;
}

export interface ChatSummaryView {
  jid: string;
  name: string | null;
  unreadCount: number;
}

export function chatListHtml(
  chats: Array<ChatSummaryView & { lastMessage?: { text: string | null } | null }>,
): string {
  const items = chats
    .map((chat) => {
      const badge =
        chat.unreadCount > 0 ? `<span class="unread-badge">${chat.unreadCount}</span>` : "";
      const preview = chat.lastMessage?.text ?? "";
      return `<li data-jid="${chat.jid}"><span class="chat-name">${chat.name ?? chat.jid}</span>${badge}<span class="chat-preview">${preview}</span></li>`;
    })
    .join("");
  return `<ul class="chat-list">${items}</ul>`;
}

export interface MessageView {
  id: string;
  chatJid: string;
  senderName: string | null;
  timestamp: string;
  content: string | null;
  isFromMe: boolean;
  isUnread: boolean;
}

export function messageListHtml(chatJid: string, messages: Array<MessageView>): string {
  const items = messages
    .map(
      (message) =>
        `<li class="message ${message.isFromMe ? "from-me" : "from-them"}" data-id="${message.id}"><span class="sender">${message.senderName ?? ""}</span><span class="text">${message.content ?? ""}</span><time>${message.timestamp}</time></li>`,
    )
    .join("");
  return `<div class="messages" data-chat-jid="${chatJid}"><ul>${items}</ul><form class="send-box" data-chat-jid="${chatJid}"><input name="text" /><button type="submit">Send</button></form></div>`;
}

export interface UnreadEntryView {
  chatJid: string;
  unreadCount: number;
}

export function unreadHtml(entries: Array<UnreadEntryView>): string {
  const items = entries
    .map(
      (entry) =>
        `<li><span>${entry.chatJid}</span><span class="unread-badge">${entry.unreadCount}</span><button data-mark-jid="${entry.chatJid}">Mark read</button></li>`,
    )
    .join("");
  return `<ul class="unread-list">${items}</ul>`;
}

export function settingsHtml(settings: { bridgeUrl: string; token: string }): string {
  return `<form id="settings-form"><label>Bridge URL<input id="bridge-url" value="${settings.bridgeUrl}" /></label><label>Token<input id="token" value="${settings.token}" /></label><button type="submit">Save</button></form>`;
}

export function pairingHtml(settings: { bridgeUrl: string; token: string }): string {
  return `<div id="pairing">${settingsHtml(settings)}<p id="qr-status">save the bridge token above to load the QR</p></div>`;
}

export function qrHtml(pngDataUrl: string | null): string {
  const src = pngDataUrl === null ? "" : ` src="${pngDataUrl}"`;
  return `<div id="pairing"><img id="qr-image"${src} /><p id="qr-status">waiting for scan…</p></div>`;
}

export function healthHtml(health: Record<string, unknown>): string {
  return `<dl class="health">${Object.entries(health)
    .map(([key, value]) => `<dt>${key}</dt><dd>${String(value)}</dd>`)
    .join("")}</dl>`;
}
