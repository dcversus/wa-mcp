import { escapeHtml } from "./escape.ts";
import { privacyOptionsFor } from "./state.ts";

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
  { id: "subscriptions", label: "Subscriptions", href: "#/subscriptions" },
  { id: "pairing", label: "Pairing", href: "#/pairing" },
  { id: "settings", label: "Settings", href: "#/settings" },
];

export function navHtml(active: string, version = "0.9.0"): string {
  const groups: Array<{ label: string; keys: string[] }> = [
    { label: "chats", keys: ["chats", "unread"] },
    { label: "people", keys: ["contacts", "groups", "profile"] },
    { label: "automations", keys: ["subscriptions"] },
    { label: "system", keys: ["status", "pairing", "settings"] },
  ];
  const brand = `<div class="brand"><strong>wa-mcp</strong><span class="version">v${version}</span></div>`;
  const links = groups
    .map((group) => {
      const label = `<div class="nav-group">${group.label}</div>`;
      const links = group.keys
        .map((key) => {
          const section = NAV_SECTIONS.find((candidate) => candidate.id === key);
          if (section === undefined) {
            return "";
          }
          return `<a href="${section.href}"${section.id === active ? ' class="active"' : ""} data-nav="${section.id}">${section.label}</a>`;
        })
        .join("");
      return label + links;
    })
    .join("");
  return `${brand}${links}`;
}

export interface StatusDashboardInput {
  health: Record<string, unknown>;
  notifications: Array<{ id: string; chat_jid?: string; pattern?: string }>;
  events: Array<{ type: string; at: number; detail?: string }>;
}

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

function localParts(ms: number): { day: number; weekday: number; hhmm: string; key: string } {
  const date = new Date(ms);
  const day = date.getDate();
  const weekday = date.getDay();
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return {
    day,
    weekday,
    hhmm: `${hh}:${mm}`,
    key: `${date.getFullYear()}-${date.getMonth()}-${day}`,
  };
}

export function formatWhen(iso: string | number, now: number = Date.now()): string {
  const ms = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return "—";
  }
  const current = localParts(now);
  const target = localParts(ms);
  if (target.key === current.key) {
    return target.hhmm;
  }
  const days = Math.floor((currentMidnight(now) - currentMidnight(ms)) / 86_400_000);
  if (days >= 1 && days <= 6) {
    return WEEKDAYS[target.weekday] ?? "";
  }
  return `${target.day} ${MONTHS[new Date(ms).getMonth()] ?? ""}`;
}

function currentMidnight(ms: number): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

export function formatDaySeparator(iso: string | number, now: number = Date.now()): string {
  const ms = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return "";
  }
  const current = localParts(now);
  const target = localParts(ms);
  if (target.key === current.key) {
    return "Today";
  }
  const days = Math.floor((currentMidnight(now) - currentMidnight(ms)) / 86_400_000);
  if (days === 1) {
    return "Yesterday";
  }
  return `${WEEKDAYS[target.weekday] ?? ""} ${target.day} ${MONTHS[new Date(ms).getMonth()] ?? ""}`;
}

export function formatDuration(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) {
    return "—";
  }
  const totalMinutes = Math.floor(seconds / 60);
  const days = Math.floor(totalMinutes / 1440);
  const hours = Math.floor((totalMinutes % 1440) / 60);
  const minutes = totalMinutes % 60;
  if (days >= 1) {
    return `${days} d ${hours} h`;
  }
  if (hours >= 1) {
    return `${hours} h ${minutes} m`;
  }
  return `${minutes} m`;
}

export function formatRelative(iso: string | number, now: number = Date.now()): string {
  const ms = typeof iso === "number" ? iso : Date.parse(iso);
  if (!Number.isFinite(ms)) {
    return "—";
  }
  return `${formatDuration(Math.max(0, Math.floor((now - ms) / 1000)))} ago`;
}

export function replyPreviewHtml(preview: {
  senderName: string | null;
  text: string | null;
}): string {
  const who = preview.senderName ?? "";
  const what = (preview.text ?? "").slice(0, 80);
  return `<div id="reply-preview" role="note"><span>Replying to <strong>${escapeHtml(who)}</strong>${what.length > 0 ? `: “${escapeHtml(what)}”` : ""}</span> <button id="cancel-reply" type="button" aria-label="cancel reply">✕</button></div>`;
}

export function formatStatValue(key: string, value: unknown): string {
  if (value === null || value === undefined) {
    return "—";
  }
  if (typeof value === "boolean") {
    return value ? "yes" : "no";
  }
  if (Array.isArray(value)) {
    return value.map((entry) => formatStatValue(key, entry)).join(", ");
  }
  if (key === "pairingAttempts" && typeof value === "object") {
    const v = value as { used?: unknown; limit?: unknown };
    const used = Number(v.used ?? 0);
    const limit = Number(v.limit ?? 0);
    if (!Number.isFinite(used) || !Number.isFinite(limit)) {
      return "—";
    }
    return `${used} / ${limit}`;
  }
  if (key === "subscriptions" && typeof value === "object") {
    const v = value as { count?: unknown; dropped?: unknown };
    const count = Number(v.count ?? 0);
    const dropped = Number(v.dropped ?? 0);
    if (!Number.isFinite(count) || !Number.isFinite(dropped)) {
      return "—";
    }
    return dropped > 0 ? `${count} (${dropped} dropped)` : `${count}`;
  }
  if (typeof value === "object") {
    return Object.entries(value as Record<string, unknown>)
      .map(([k, v]) => `${k}: (${formatStatValue(k, v)})`)
      .join(", ");
  }
  if (key === "uptime" && typeof value === "number") {
    return formatDuration(value);
  }
  if (key === "lastDisconnectAt" && typeof value === "number") {
    return formatRelative(value);
  }
  if (typeof value === "string" || typeof value === "number") {
    return String(value);
  }
  return JSON.stringify(value);
}

export function statusDashboardHtml(input: StatusDashboardInput): string {
  const fields = Object.entries(input.health)
    .filter(([key]) => key !== "channel" || input.health.channel !== undefined)
    .map(
      ([key, value]) =>
        `<div class="stat"><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(formatStatValue(key, value))}</dd></div>`,
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
        `<li><time>${escapeHtml(formatWhen(event.at))}</time> <strong>${escapeHtml(event.type)}</strong> <span>${escapeHtml(event.detail ?? "")}</span></li>`,
    )
    .join("");
  return `<section id="status-dashboard"><h2>Status</h2><dl class="stats">${fields}</dl><h3>pairing rules</h3><ul class="rules">${rules}</ul><h3>events</h3><ul class="events">${feed}</ul></section>`;
}

export function contactsPageHtml(
  contacts: Array<{ jid: string; name: string | null }>,
  query = "",
): string {
  const items = contacts
    .map(
      (contact) =>
        `<li data-contact-jid="${escapeHtml(contact.jid)}"><span class="contact-name">${escapeHtml(contact.name ?? contact.jid)}</span> <code>${escapeHtml(contact.jid)}</code> <button data-alias-jid="${escapeHtml(contact.jid)}">set alias</button></li>`,
    )
    .join("");
  const empty =
    contacts.length === 0
      ? query.length > 0
        ? `<p class="empty">No contacts match “${escapeHtml(query)}” — <button id="clear-contacts-search" type="button">Clear search</button></p>`
        : emptyState("No contacts yet — they appear after you chat")
      : "";
  return `<section id="contacts-page"><form id="contact-search"><input name="query" placeholder="search contacts" value="${escapeHtml(query)}" /></form><ul id="contacts-list">${items}</ul>${empty}</section>`;
}

export function groupsPageHtml(
  groups: Array<{ jid: string; name: string | null; unreadCount: number }>,
): string {
  const items = groups
    .map(
      (group) =>
        `<li data-group-jid="${escapeHtml(group.jid)}"><a href="#/chat/${encodeURIComponent(group.jid)}">${escapeHtml(group.name ?? group.jid)}</a>${group.unreadCount > 0 ? ` <span class="unread-badge">${group.unreadCount}</span>` : ""} <button class="group-info-toggle" data-group-info="${escapeHtml(group.jid)}" aria-expanded="false" type="button">info</button> <button data-leave-jid="${escapeHtml(group.jid)}">leave</button></li>`,
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
  opts: { showArchived?: boolean; query?: string; syncing?: boolean } = {},
): string {
  if (chats.length === 0) {
    const note =
      opts.syncing === true
        ? `<div class="spinner"></div><p>Syncing your chats from your phone… keep WhatsApp open on your phone</p>`
        : emptyState("No chats yet — they appear after your first message");
    return `<section id="chats-page"><form id="chat-search"><input name="query" placeholder="search messages" value="${escapeHtml(opts.query ?? "")}" /></form><label class="archived-toggle check-row"><input type="checkbox" id="archived-toggle"${opts.showArchived ? " checked" : ""} /> show archived</label>${note}</section>`;
  }
  const items = chats
    .map((chat) => {
      const badge =
        chat.unreadCount > 0 ? `<span class="unread-badge">${chat.unreadCount}</span>` : "";
      const preview = chat.lastMessage?.text ?? "";
      const time =
        chat.lastMessage?.timestamp !== undefined && chat.lastMessage.timestamp !== null
          ? `<time class="chat-time">${escapeHtml(formatWhen(chat.lastMessage.timestamp))}</time>`
          : "";
      const archivedTag = chat.archived ? ' data-archived="1"' : "";
      const name = chat.name ?? chat.jid;
      return `<li${archivedTag} data-jid="${escapeHtml(chat.jid)}"><a href="#/chat/${escapeHtml(chat.jid)}"><span class="avatar">${escapeHtml(initials(name))}</span><span class="chat-main"><span class="chat-top"><span class="chat-name">${escapeHtml(name)}</span>${time}</span><span class="chat-preview">${escapeHtml(preview)}</span></span>${badge}</a></li>`;
    })
    .join("");
  return `<section id="chats-page"><form id="chat-search"><input name="query" placeholder="search messages" value="${escapeHtml(opts.query ?? "")}" /></form><label class="archived-toggle check-row"><input type="checkbox" id="archived-toggle"${opts.showArchived ? " checked" : ""} /> show archived</label><ul class="chat-list${opts.showArchived ? "" : " hide-archived"}">${items}</ul></section>`;
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
  poll?: { question: string; options: Array<{ label: string; votes: number }> } | null;
  quoted?: { text: string | null; senderName: string | null } | null;
  reactions?: Array<{ emote: string; count: number; senders?: string[] }> | null;
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
      items.push(
        `<li class="day-separator"><time>${escapeHtml(formatDaySeparator(message.timestamp))}</time></li>`,
      );
      lastDay = day;
    }
    let body: string;
    if (message.poll) {
      body = `📊 ${escapeHtml(message.poll.question)}<span class="poll-options">${message.poll.options
        .map((option) => `${escapeHtml(option.label)} · ${option.votes} votes`)
        .join(" — ")}</span>`;
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
            .map((r) => `<span class="reaction">${escapeHtml(r.emote)} ${r.count}</span>`)
            .join("")}</span>`
        : "";
    items.push(
      `<li class="message ${message.isFromMe ? "from-me" : "from-them"}" data-id="${escapeHtml(message.id)}"><span class="sender">${escapeHtml(message.senderName ?? "")}</span>${quote}<span class="text">${body}</span>${reactions}<time>${escapeHtml(formatWhen(message.timestamp))}</time><button class="context-btn" data-context-id="${escapeHtml(message.id)}">context</button><button class="media-btn" data-download-id="${escapeHtml(message.id)}">download</button></li>`,
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
        `<li class="message ${message.isFromMe ? "from-me" : "from-them"}${message.id === targetId ? " context-target" : ""}"><span class="sender">${escapeHtml(message.senderName ?? "")}</span><span class="text">${escapeHtml(message.content ?? "")}</span><time>${escapeHtml(formatWhen(message.timestamp))}</time></li>`,
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
        `<li><a href="#/chat/${escapeHtml(entry.chatJid)}">${escapeHtml(entry.chatJid)}</a><span class="unread-badge">${entry.unreadCount}</span><button data-mark-jid="${entry.chatJid}">Mark read</button></li>`,
    )
    .join("");
  return `<ul class="unread-list">${items}</ul><button id="mark-all-read">mark all read</button>`;
}

export function settingsHtml(settings: { bridgeUrl: string; token: string }): string {
  return `<form id="settings-form"><label>Bridge URL<input id="bridge-url" value="${escapeHtml(settings.bridgeUrl)}" /></label><label>Token (optional — the UI uses the daemon's ephemeral token automatically)<input id="token" value="${escapeHtml(settings.token)}" /></label><button type="submit">Save</button></form>`;
}

export interface TranscriptionSettingsView {
  engine?: string;
  baseUrl?: string;
  model?: string;
  apiKeyMasked?: string;
}

export function transcriptionSettingsHtml(view: TranscriptionSettingsView): string {
  const engine = view.engine ?? "";
  const engines = ["mock", "openai", "mlx", "whisper-local"];
  const options = engines
    .map(
      (name) =>
        `<option value="${escapeHtml(name)}"${name === engine ? " selected" : ""}>${escapeHtml(name)}</option>`,
    )
    .join("");
  return `<form id="transcription-form"><h3>Transcription</h3>
<label>Engine<select id="transcription-engine">${options}</select></label>
<label>Base URL<input id="transcription-base-url" value="${escapeHtml(view.baseUrl ?? "")}" placeholder="https://api.openai.com/v1" /></label>
<label>Model<input id="transcription-model" value="${escapeHtml(view.model ?? "")}" placeholder="whisper-1" /></label>
<label>API key<input id="transcription-api-key" type="password" placeholder="${escapeHtml(view.apiKeyMasked ?? "not set")}" /></label>
<p class="hint">leave the key field empty to keep the saved key; engines and keys are stored in the bridge config file</p>
</form>`;
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
    .map(
      ([key, value]) =>
        `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(formatStatValue(key, value))}</dd>`,
    )
    .join("")}</dl>`;
}

export interface MeInfo {
  pn: string | null;
  name: string | null;
  status: string | null;
}

const PRIVACY_ROWS: Array<{ key: string; label: string }> = [
  { key: "last", label: "last seen" },
  { key: "online", label: "online" },
  { key: "profile", label: "profile photo" },
  { key: "status", label: "about" },
  { key: "groupadd", label: "groups" },
  { key: "calladd", label: "calls" },
  { key: "messages", label: "who can message" },
  { key: "readreceipts", label: "read receipts" },
];

export function profilePageHtml(input: {
  blocklist: string[];
  me?: { pn: string | null; name: string | null; status: string | null };
  privacy?: Record<string, string>;
}): string {
  const entries = input.blocklist
    .map(
      (jid) =>
        `<li data-blocked-jid="${escapeHtml(jid)}"><code>${escapeHtml(jid)}</code> <button data-unblock-jid="${escapeHtml(jid)}">unblock</button></li>`,
    )
    .join("");
  const me = input.me ?? { pn: null, name: null, status: null };
  const initial = (me.name ?? "?").charAt(0).toUpperCase();
  const privacyRows = PRIVACY_ROWS.map((row) => {
    const options = privacyOptionsFor(row.key);
    const live = (input.privacy ?? {})[row.key];
    const all =
      live !== undefined && live !== null && !options.includes(live) ? [live, ...options] : options;
    const unknown = live === undefined || live === null;
    return `<div class="privacy-row"><label>${escapeHtml(row.label)}<select data-privacy-key="${row.key}"${unknown ? " disabled" : ""}>
${all
  .map(
    (value) =>
      `<option value="${escapeHtml(value)}"${value === live ? " selected" : ""}>${escapeHtml(value)}</option>`,
  )
  .join("")}
</select></label></div>`;
  }).join("");
  return `<section id="profile-page"><h2>Profile</h2>
<div class="me-card"><span class="avatar">${escapeHtml(initial)}</span>
<div class="me-fields">
<label>display name<input id="me-name" value="${escapeHtml(me.name ?? "")}" /></label>
<label>phone<code id="me-phone">${escapeHtml(me.pn ?? "—")}</code></label>
<label>about / status<input id="me-status" value="${escapeHtml(me.status ?? "")}" placeholder="—" /></label>
<button id="save-name" type="button">save name</button>
<button id="save-status" type="button">save status</button>
<span id="profile-save-status" class="save-flash" aria-live="polite"></span>
</div></div>
<h3>privacy</h3>
<div class="privacy-settings">${privacyRows}</div>
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

/** T73 C2: the group subject/description come straight from WhatsApp and are
 * rendered into an HTML attribute — every value escapes before interpolation. */
export function groupMetaFormHtml(groupJid: string, subject: string, description: string): string {
  return `<form id="group-meta-edit" data-meta-jid="${escapeHtml(groupJid)}"><input name="subject" placeholder="new subject" value="${escapeHtml(subject)}" /><input name="description" placeholder="new description" value="${escapeHtml(description)}" /><button type="submit">save</button></form>`;
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

export function eventsPageHtml(events: Array<FeedEntry>, opts: { paused?: boolean } = {}): string {
  const items = events
    .map(
      (event) =>
        `<li><time>${escapeHtml(formatWhen(event.at))}</time> <strong>${escapeHtml(event.type)}</strong> <span>${escapeHtml(event.detail ?? "")}</span></li>`,
    )
    .join("");
  return `<section id="events-page"><div class="events-header"><h2>Events</h2><button id="events-pause">${opts.paused === true ? "resume" : "pause"}</button><button id="events-clear">clear</button></div><ul id="events-feed">${items}</ul></section>`;
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

/** T93-C1: a visible, escaped failure surface — a failed page load shows a
 * banner instead of crashing the render pipeline or rendering a blank page. */
export function errorBannerHtml(message: string): string {
  return `<div class="error-banner" role="alert">⚠ ${escapeHtml(message)}</div>`;
}

/** T93-C1: wrap any page loader so an ApiError (or any throw) renders the
 * banner instead of bubbling into the global render-failure screen. */
export function guardLoader(
  loader: (params: Record<string, string>) => Promise<string>,
): (params: Record<string, string>) => Promise<string> {
  return async (params) => {
    try {
      return await loader(params);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return errorBannerHtml(`could not load this page: ${message}`);
    }
  };
}

export interface SubscriptionRow {
  id: string;
  chatJid: string | null;
  allChats: boolean;
  kinds: string[];
  includeMedia: boolean;
  inboxPath: string;
}

export const AGENT_TARGETS = [
  "claude-code",
  "claude-desktop",
  "cursor",
  "codex",
  "grok",
  "pi",
  "hermes",
  "antigravity",
] as const;

export function agentConnectHtml(): string {
  const rows = AGENT_TARGETS.map(
    (target) =>
      `<li class="agent-target"><code>wa-mcp install --target ${target}</code> <button class="copy-cmd" data-copy-cmd="wa-mcp install --target ${target}" type="button">copy</button></li>`,
  ).join("");
  return `<section id="agent-connect" class="pane"><h3>Connect your agent</h3><p class="hint">run one command so your AI agent can use WhatsApp:</p><ul class="agent-targets">${rows}</ul></section>`;
}

export function hookSnippet(inboxPath: string): string {
  return `wa-mcp inbox drain --inbox ${inboxPath}`;
}

export interface ChatPick {
  jid: string;
  name: string | null;
  unreadCount: number;
}

export function subscriptionsPageHtml(subs: SubscriptionRow[], chats: ChatPick[] = []): string {
  const rows = subs
    .map(
      (sub) => `<li class="subscription-row" data-sub-id="${escapeHtml(sub.id)}">
<div><code>${escapeHtml(sub.id)}</code> — ${escapeHtml(sub.allChats ? "all chats" : (sub.chatJid ?? "?"))}${sub.includeMedia ? " · media" : ""} · ${escapeHtml(sub.kinds.join(","))}</div>
<div class="inbox-path"><code>${escapeHtml(sub.inboxPath)}</code></div>
<div class="hook-snippet"><code>${escapeHtml(hookSnippet(sub.inboxPath))}</code> <button class="copy-hook" type="button">copy</button></div>
<button class="delete-subscription" type="button" data-sub-id="${escapeHtml(sub.id)}">remove</button>
</li>`,
    )
    .join("");
  const allChatsSub = subs.find((s) => s.allChats);
  const subscribed = new Set(subs.filter((s) => !s.allChats).map((s) => s.chatJid));
  const sortedChats = [...chats].sort((a, b) => {
    const aGroup = a.jid.endsWith("@g.us") ? 0 : 1;
    const bGroup = b.jid.endsWith("@g.us") ? 0 : 1;
    return aGroup - bGroup || (a.name ?? a.jid).localeCompare(b.name ?? b.jid);
  });
  const allChatsNote =
    allChatsSub !== undefined
      ? '<p class="hint">all-chats subscription active — manage it in Advanced</p>'
      : "";
  const globalMedia =
    '<label class="check-row"><input type="checkbox" id="sub-include-media" /> include media</label>';
  const picker =
    sortedChats.length > 0
      ? `${allChatsNote}${globalMedia}<input id="sub-chat-filter" type="search" placeholder="filter chats…" aria-label="filter chats" autocomplete="off" />
<div class="picker-count" data-picker-count="${sortedChats.length}">${sortedChats.length} chats — ${subscribed.size} subscribed</div>
<ul id="sub-chat-picker">${sortedChats
          .map((chat) => {
            const checked = allChatsSub !== undefined || subscribed.has(chat.jid);
            const disabled = allChatsSub !== undefined;
            const subIds = subs
              .filter((s) => !s.allChats && s.chatJid === chat.jid)
              .map((s) => s.id);
            const subIdsAttr =
              subIds.length > 0 ? ` data-sub-ids="${escapeHtml(subIds.join(","))}"` : "";
            return `<li class="sub-chat-row" data-chat-jid="${escapeHtml(chat.jid)}"${subIdsAttr}>
<label class="check-row"><input type="checkbox" data-chat-jid="${escapeHtml(chat.jid)}"${checked ? " checked" : ""}${disabled ? " disabled" : ""} /> <span class="avatar">${escapeHtml(initials(chat.name ?? chat.jid))}</span> <span class="chat-name">${escapeHtml(chat.name ?? chat.jid)}</span> <code class="inbox-path">${escapeHtml(chat.jid)}</code></label>
</li>`;
          })
          .join("")}</ul>`
      : emptyState("No chats yet — they appear after messages arrive");
  return `<section id="subscriptions-page"><h2>Subscriptions</h2>
${picker}
<details><summary>Advanced</summary>
<form id="subscription-form">
<label>chat jid<input name="chat_jid" placeholder="1203…@g.us" /></label>
<label class="check-row"><input type="checkbox" name="all_chats" /> all chats</label>
<label class="check-row"><input type="checkbox" name="include_media" /> include media</label>
<label>kinds<input name="kinds" placeholder="message" /></label>
<button type="submit" id="create-subscription">subscribe</button>
</form>
</details>
<ul id="subscription-list">${rows}</ul>${agentConnectHtml()}</section>`;
}
