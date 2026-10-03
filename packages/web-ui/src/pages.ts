import { escapeHtml } from "./escape.ts";

export function initials(name: string): string {
  const trimmed = name.trim();
  if (trimmed.length === 0) {
    return "?";
  }
  const parts = trimmed.split(/\s+/);
  const first = parts[0]?.charAt(0) ?? "";
  const second = parts[1]?.charAt(0) ?? "";
  const value = (first + second).toUpperCase();
  return value.length > 0 ? value : "?";
}

export function emptyState(text: string): string {
  return `<div class="empty-state">${escapeHtml(text)}</div>`;
}

const NAV_SECTIONS: Array<{ id: string; label: string; href: string }> = [
  { id: "status", label: "Status", href: "#/status" },
  { id: "chats", label: "Chats", href: "#/chats" },
  { id: "unread", label: "Unread", href: "#/unread" },
  { id: "contacts", label: "Contacts", href: "#/contacts" },
  { id: "groups", label: "Groups", href: "#/groups" },
  { id: "profile", label: "Profile", href: "#/profile" },
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
  const empty =
    contacts.length === 0 ? emptyState("No contacts yet — they appear after you chat") : "";
  return `<section id="contacts-page"><form id="contact-search"><input name="query" placeholder="search contacts" /></form><ul id="contacts-list">${items}</ul>${empty}</section>`;
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
  const empty =
    groups.length === 0 ? emptyState("No groups yet — create one or ask to be added") : "";
  return `<section id="groups-page"><form id="group-create"><input name="subject" placeholder="group subject" /><button type="submit">create group</button></form><ul id="groups-list">${items}</ul>${empty}</section>`;
}

export interface ChatSummaryView {
  jid: string;
  name: string | null;
  unreadCount: number;
}

export function chatListHtml(
  chats: Array<
    ChatSummaryView & {
      lastMessage?: { text: string | null; timestamp?: string | null } | null;
      archived?: boolean;
    }
  >,
  opts: { showArchived?: boolean; query?: string } = {},
): string {
  if (chats.length === 0) {
    return `<section id="chats-page"><form id="chat-search"><input name="query" placeholder="search messages" value="${escapeHtml(opts.query ?? "")}" /></form><label class="archived-toggle"><input type="checkbox" id="archived-toggle"${opts.showArchived ? " checked" : ""} /> show archived</label>${emptyState("No chats yet — they appear after your first message")}</section>`;
  }
  const items = chats
    .map((chat) => {
      const badge =
        chat.unreadCount > 0 ? `<span class="unread-badge">${chat.unreadCount}</span>` : "";
      const preview = chat.lastMessage?.text ?? "";
      const time = chat.lastMessage?.timestamp
        ? `<time class="chat-time">${escapeHtml(chat.lastMessage.timestamp.slice(11, 16))}</time>`
        : "";
      const archivedTag = chat.archived ? ' data-archived="1"' : "";
      const name = chat.name ?? chat.jid;
      return `<li${archivedTag} data-jid="${escapeHtml(chat.jid)}"><span class="avatar">${escapeHtml(initials(name))}</span><span class="chat-main"><span class="chat-top"><span class="chat-name">${escapeHtml(name)}</span>${time}</span><span class="chat-preview">${escapeHtml(preview)}</span></span>${badge}</li>`;
    })
    .join("");
  return `<section id="chats-page"><form id="chat-search"><input name="query" placeholder="search messages" value="${escapeHtml(opts.query ?? "")}" /></form><label class="archived-toggle"><input type="checkbox" id="archived-toggle"${opts.showArchived ? " checked" : ""} /> show archived</label><ul class="chat-list${opts.showArchived ? "" : " hide-archived"}">${items}</ul></section>`;
}

export interface MessageView {
  id: string;
  chatJid: string;
  senderName: string | null;
  timestamp: string;
  content: string | null;
  isFromMe: boolean;
  isUnread: boolean;
  mediaType?: "image" | "video" | "audio" | "document" | "sticker" | null;
  poll?: { question: string; options: string[] } | null;
  quoted?: { text: string | null; senderName: string | null } | null;
  reactions?: Array<{ emoji: string; count: number }> | null;
}

export function dayKey(isoTimestamp: string): string {
  return isoTimestamp.slice(0, 10);
}

export function messageListHtml(
  chatJid: string,
  messages: Array<MessageView>,
  opts: { mediaToken?: string } = {},
): string {
  const mediaToken = opts.mediaToken ?? "";
  const mediaUrl = (id: string) =>
    mediaToken.length > 0
      ? `/api/media/${encodeURIComponent(id)}?token=${encodeURIComponent(mediaToken)}`
      : `/api/media/${encodeURIComponent(id)}`;
  const items: string[] = [];
  let lastDay = "";
  const sorted = [...messages].sort((a, b) =>
    a.timestamp > b.timestamp ? 1 : a.timestamp < b.timestamp ? -1 : 0,
  );
  for (const message of sorted) {
    const day = dayKey(message.timestamp);
    if (day !== lastDay) {
      items.push(`<li class="day-separator"><time>${escapeHtml(day)}</time></li>`);
      lastDay = day;
    }
    let body: string;
    if (message.poll) {
      body = `📊 ${escapeHtml(message.poll.question)}<span class="poll-options">${message.poll.options
        .map((option) => escapeHtml(option))
        .join(" · ")}</span>`;
    } else if (message.mediaType !== undefined && message.mediaType !== null) {
      const mediaSrc = mediaUrl(message.id);
      if (message.mediaType === "image") {
        body = `<img class="media-thumb" src="${mediaSrc}" alt="image" loading="lazy" />${message.content ? `<span class="media-caption">${escapeHtml(message.content)}</span>` : ""}`;
      } else if (message.mediaType === "video") {
        body = `<video class="media-thumb" src="${mediaSrc}" controls preload="metadata"></video>${message.content ? `<span class="media-caption">${escapeHtml(message.content)}</span>` : ""}`;
      } else if (message.mediaType === "audio") {
        body = `🎵 voice note <audio controls src="${mediaSrc}"></audio><span class="transcript" data-transcript-for="${escapeHtml(message.id)}"></span>`;
      } else if (message.mediaType === "sticker") {
        body = `🌟 sticker <img class="media-thumb small" src="${mediaSrc}" alt="sticker" loading="lazy" />`;
      } else {
        body = `📄 document <a class="media-link" href="${mediaSrc}" download>${escapeHtml(message.content ?? "download")}</a>`;
      }
      body += ` <button class="media-btn" data-download-id="${escapeHtml(message.id)}">download</button>`;
    } else {
      body = escapeHtml(message.content ?? "");
    }
    const quote = message.quoted
      ? `<blockquote class="quoted"><span class="quoted-sender">${escapeHtml(message.quoted.senderName ?? "")}</span> ${escapeHtml(message.quoted.text ?? "")}</blockquote>`
      : "";
    const reactions =
      message.reactions && message.reactions.length > 0
        ? `<span class="reactions">${message.reactions
            .map((r) => `<span class="reaction">${escapeHtml(r.emoji)} ${r.count}</span>`)
            .join("")}</span>`
        : "";
    items.push(
      `<li class="message ${message.isFromMe ? "from-me" : "from-them"}" data-id="${escapeHtml(message.id)}"><span class="sender">${escapeHtml(message.senderName ?? "")}</span>${quote}<span class="text">${body}</span>${reactions}<time>${escapeHtml(message.timestamp)}</time><button class="context-btn" data-context-id="${escapeHtml(message.id)}">context</button><button class="media-btn" data-download-id="${escapeHtml(message.id)}">download</button></li>`,
    );
  }
  const list = items.join("");
  return `<div class="messages" data-chat-jid="${escapeHtml(chatJid)}"><ul>${list}</ul><form class="send-box" data-chat-jid="${escapeHtml(chatJid)}"><input name="text" /><button type="submit">Send</button></form></div>`;
}

export function contextViewHtml(
  targetId: string,
  messages: Array<
    Pick<MessageView, "id" | "chatJid" | "senderName" | "timestamp" | "content" | "isFromMe">
  >,
): string {
  const items = messages
    .map(
      (message) =>
        `<li class="message ${message.isFromMe ? "from-me" : "from-them"}${message.id === targetId ? " context-target" : ""}"><span class="sender">${escapeHtml(message.senderName ?? "")}</span><span class="text">${escapeHtml(message.content ?? "")}</span><time>${escapeHtml(message.timestamp)}</time></li>`,
    )
    .join("");
  return `<div id="context-view"><h3>context</h3><ul>${items}</ul></div>`;
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
  return `<ul class="unread-list">${items}</ul><button id="mark-all-read">mark all read</button>`;
}

export function settingsHtml(settings: { bridgeUrl: string; token: string }): string {
  return `<form id="settings-form"><label>Bridge URL<input id="bridge-url" value="${settings.bridgeUrl}" /></label><label>Token (optional — the UI uses the daemon's ephemeral token automatically)<input id="token" value="${settings.token}" /></label><button type="submit">Save</button></form>`;
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

export function profilePageHtml(input: { blocklist: string[] }): string {
  const entries = input.blocklist
    .map(
      (jid) =>
        `<li data-blocked-jid="${escapeHtml(jid)}"><code>${escapeHtml(jid)}</code> <button data-unblock-jid="${escapeHtml(jid)}">unblock</button></li>`,
    )
    .join("");
  return `<section id="profile-page"><h2>Profile</h2>
<form id="name-form"><label>display name<input name="name" placeholder="new display name" /></label><button type="submit">set name</button></form>
<h3>privacy</h3>
<form id="privacy-form"><label>read receipts<select name="privacy_value"><option value="all">all</option><option value="none">none</option></select></label><button type="submit">apply</button></form>
<h3>blocked contacts</h3>
<form id="block-form"><label>block a JID<input name="chat_jid" placeholder="358…@s.whatsapp.net" /></label><button type="submit">block</button></form>
<ul class="blocklist">${entries}</ul></section>`;
}

export function groupParticipantsHtml(
  groupJid: string,
  participants: Array<{ id: string; isAdmin?: boolean }>,
): string {
  const items = participants
    .map(
      (participant) =>
        `<li data-participant-jid="${escapeHtml(participant.id)}"><code>${escapeHtml(participant.id)}</code>${participant.isAdmin ? ' <span class="admin-flag">admin</span>' : ""} <button data-remove-participant="${escapeHtml(groupJid)}" data-participant="${escapeHtml(participant.id)}">remove</button> <button data-promote-participant="${escapeHtml(groupJid)}" data-participant="${escapeHtml(participant.id)}">promote</button></li>`,
    )
    .join("");
  return `<div id="group-participants"><h3>participants</h3><ul>${items}</ul><form id="participant-add"><input name="participant" placeholder="358…@s.whatsapp.net" /><button type="submit" data-add-participant="${escapeHtml(groupJid)}">add</button></form></div>`;
}

/** T54: a 401 on a just-navigated route renders the token form INLINE on the
 * same route (no redirect loop) with the exact recovery hint. */

export function notFoundHtml(route: string): string {
  return `<section id="not-found" class="pane"><h2>Page not found</h2><p>The route <code>${escapeHtml(route)}</code> does not exist.</p><p><a href="#/chats">Go to chats</a></p></section>`;
}

export interface FeedEntry {
  at: number;
  type: string;
  detail?: string;
}

export function eventsPageHtml(events: Array<FeedEntry>): string {
  const items = events
    .map(
      (event) =>
        `<li><time>${new Date(event.at).toISOString()}</time> <strong>${escapeHtml(event.type)}</strong> <span>${escapeHtml(event.detail ?? "")}</span></li>`,
    )
    .join("");
  return `<section id="events-page"><div class="events-header"><h2>Events</h2><button id="events-pause">pause</button><button id="events-clear">clear</button></div><ul id="events-feed">${items}</ul></section>`;
}

const PRIVACY_FIELDS: Array<{ key: string; label: string }> = [
  { key: "readReceipts", label: "Read receipts" },
  { key: "lastSeen", label: "Last seen" },
  { key: "status", label: "Status addressee" },
  { key: "groups", label: "Who can add me to groups" },
  { key: "profilePic", label: "Profile photo" },
  { key: "online", label: "Online status" },
];

const PRIVACY_VALUES = ["all", "contacts", "contact_blacklist", "known", "none", "match_last_seen"];

export function privacyMatrixHtml(current: Record<string, string>): string {
  const rows = PRIVACY_FIELDS.map((field) => {
    const value = current[field.key] ?? "unknown";
    const options = PRIVACY_VALUES.map(
      (option) =>
        `<option value="${option}"${option === value ? " selected" : ""}>${option}</option>`,
    ).join("");
    return `<div class="privacy-row"><label>${field.label}<select name="${field.key}">${options}</select></label></div>`;
  }).join("");
  return `<section id="privacy-matrix"><h3>Privacy</h3>${rows}<button id="privacy-apply" type="button">apply privacy</button></section>`;
}

/** Inline send-failure banner (T67): escaped engine message + dismiss. */
export function chatErrorHtml(message: string): string {
  return `<div class="send-error" role="alert"><span>${escapeHtml(message)}</span> <button data-dismiss-error type="button">dismiss</button></div>`;
}

/** Persistent daemon-down banner (T68): shown when any API call fails at the
 * network level; auto-dismissed by the next successful health poll. */
export function bridgeDownBanner(bridgeUrl: string): string {
  return `<div id="bridge-down" role="alert">bridge unreachable at ${escapeHtml(bridgeUrl)} — is the daemon running?</div>`;
}
