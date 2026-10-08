import { escapeHtml } from "./escape.ts";
import { ApiError } from "./api.ts";
import { formatPhone } from "./state.ts";
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
  { id: "chats", label: "Chats", href: "#/chats" },
  { id: "logs", label: "Logs", href: "#/logs" },
  { id: "contacts", label: "Contacts", href: "#/contacts" },
  { id: "connections", label: "Connections", href: "#/connections" },
  { id: "subscriptions", label: "Subscriptions", href: "#/subscriptions" },
  { id: "profile", label: "Profile", href: "#/profile" },
  { id: "status", label: "Connection", href: "#/status" },
  { id: "settings", label: "Settings", href: "#/settings" },
  { id: "pairing", label: "Link phone", href: "#/pairing" },
];

export const NAV_TITLES: Record<string, string> = {
  chats: "Chats",
  chat: "Chat",
  logs: "Logs",
  contacts: "Contacts",
  connections: "Connections",
  subscriptions: "Subscriptions",
  profile: "Profile",
  status: "Connection",
  settings: "Settings",
  pairing: "Link phone",
};

export function navHtml(active: string, version = "0.9.0"): string {
  const groups: Array<{ label: string; keys: string[] }> = [
    { label: "Messages", keys: ["chats", "logs"] },
    { label: "People", keys: ["contacts"] },
    { label: "Agent", keys: ["connections", "subscriptions"] },
    { label: "Me", keys: ["profile"] },
    { label: "System", keys: ["status", "settings", "pairing"] },
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
          const isActive = section.id === active;
          return `<a href="${section.href}"${isActive ? ' class="active" aria-current="page"' : ""} data-nav="${section.id}">${section.label}</a>`;
        })
        .join("");
      return label + links;
    })
    .join("");
  return `<nav aria-label="Main">${brand}${links}</nav>`;
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

export function statusDashboardHtml(
  input: StatusDashboardInput & {
    me?: { name: string | null; pn: string | null } | null;
  },
): string {
  const fields = Object.entries(input.health)
    .filter(([key]) => !/token/i.test(key))
    .filter(([key]) => key !== "channel" || input.health.channel !== undefined)
    .map(
      ([key, value]) =>
        `<div class="stat"><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(formatStatValue(key, value))}</dd></div>`,
    )
    .join("");
  const feed = input.events
    .map(
      (event) =>
        `<li><time>${escapeHtml(formatWhen(event.at))}</time> <strong>${escapeHtml(event.type)}</strong> <span>${escapeHtml(event.detail ?? "")}</span></li>`,
    )
    .join("");
  const linked = input.health.loggedIn === true;
  const who = input.me ?? null;
  const identity =
    who !== null && who.name !== null && who.pn !== null
      ? `${who.name} (${formatPhone(who.pn)})`
      : (who?.name ?? (who?.pn != null ? formatPhone(who.pn) : "this account"));
  const subs = input.health.subscriptions;
  const subCount =
    typeof subs === "object" && subs !== null
      ? Number((subs as { count?: unknown }).count ?? 0)
      : 0;
  const card = linked
    ? `<p class="status-card">✅ Linked as <strong>${escapeHtml(identity)}</strong>${input.health.connected === true ? " · online" : " · reconnecting"}${typeof input.health.lastDisconnectAt === "number" ? ` · last reconnect ${escapeHtml(formatRelative(input.health.lastDisconnectAt))}` : ""}${typeof input.health.uptime === "number" ? ` · running for ${escapeHtml(formatDuration(input.health.uptime))}` : ""} · ${subCount} agent subscription${subCount === 1 ? "" : "s"}</p>`
    : `<p class="status-card">⚠ WhatsApp not linked — <a href="#/pairing">Link now</a></p>`;
  return `<section id="status-dashboard"><h1>Connection</h1>${card}<details class="diagnostics"><summary>Diagnostics</summary><dl class="stats">${fields}</dl></details><h3>Recent activity</h3><ul class="events">${feed.length > 0 ? feed : `<li>${emptyState("No recent activity")}</li>`}</ul></section>`;
}

export function groupsPageHtml(
  groups: Array<{ jid: string; name: string | null; unreadCount: number }>,
): string {
  const items = groups
    .map(
      (group) =>
        `<li data-group-jid="${escapeHtml(group.jid)}"><a href="#/chat/${encodeURIComponent(group.jid)}">${escapeHtml(group.name ?? group.jid)}</a>${group.unreadCount > 0 ? ` <span class="unread-badge">${group.unreadCount}</span>` : ""} <button class="group-info-toggle" data-group-info="${escapeHtml(group.jid)}" aria-expanded="false" type="button">info</button> <button class="danger" data-leave-jid="${escapeHtml(group.jid)}" data-group-name="${escapeHtml(group.name ?? group.jid)}">Leave group</button></li>`,
    )
    .join("");
  const empty =
    groups.length === 0 ? emptyState("No groups yet — create one or ask to be added") : "";
  return `<section id="groups-page"><h1>Groups</h1><form id="group-create"><input name="subject" placeholder="New group name" aria-label="New group name" /><button class="primary" type="submit">Create group</button></form><ul id="groups-list">${items}</ul>${empty}</section>`;
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
  opts: {
    showArchived?: boolean;
    query?: string;
    syncing?: boolean;
    filter?: "all" | "unread" | "groups" | "archived";
  } = {},
): string {
  const filter = opts.filter ?? "all";
  const tabs = (["all", "unread", "groups", "archived"] as const)
    .map(
      (tab) =>
        `<button class="chat-tab${filter === tab ? " active" : ""}" data-chat-filter="${tab}" type="button">${tab === "all" ? "All" : tab === "unread" ? "Unread" : tab === "groups" ? "Groups" : "Archived"}</button>`,
    )
    .join("");
  if (chats.length === 0) {
    const note =
      opts.syncing === true
        ? `<div class="spinner"></div><p>Syncing your chats from your phone… keep WhatsApp open on your phone</p>`
        : emptyState("No chats yet. They appear here once your phone finishes syncing.");
    return `<section id="chats-page"><h1>Chats</h1><nav class="chat-tabs" aria-label="Chat filters">${tabs}</nav><form id="chat-search"><input name="query" placeholder="Search chats" aria-label="Search chats" value="${escapeHtml(opts.query ?? "")}" /></form><label class="archived-toggle check-row"><input type="checkbox" id="archived-toggle"${opts.showArchived ? " checked" : ""} /> Show archived chats</label>${note}</section>`;
  }
  const visible = chats.filter((chat) => {
    if (filter === "unread") {
      return chat.unreadCount > 0;
    }
    if (filter === "groups") {
      return chat.jid.endsWith("@g.us");
    }
    if (filter === "archived") {
      return chat.archived === true;
    }
    return true;
  });
  const shown = visible
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
      return `<li${archivedTag} data-jid="${escapeHtml(chat.jid)}"><a href="#/chat/${escapeHtml(chat.jid)}"><span class="avatar">${escapeHtml(initials(name))}</span><span class="chat-main"><span class="chat-top"><span class="chat-name" dir="auto">${escapeHtml(name)}</span>${time}</span><span class="chat-preview" dir="auto">${escapeHtml(preview)}</span></span>${badge}</a></li>`;
    })
    .join("");
  const emptyNote =
    shown.length === 0
      ? emptyState(filter === "unread" ? "Nothing unread" : "No chats match this filter")
      : "";
  return `<section id="chats-page"><h1>Chats</h1><nav class="chat-tabs" aria-label="Chat filters">${tabs}</nav><form id="chat-search"><input name="query" placeholder="Search chats" aria-label="Search chats" value="${escapeHtml(opts.query ?? "")}" /></form><label class="archived-toggle check-row"><input type="checkbox" id="archived-toggle"${opts.showArchived ? " checked" : ""} /> Show archived chats</label><ul class="chat-list${opts.showArchived || filter === "archived" ? "" : " hide-archived"}">${shown}</ul>${emptyNote}</section>`;
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
      `<li class="message ${message.isFromMe ? "from-me" : "from-them"}" data-id="${escapeHtml(message.id)}"><span class="sender">${escapeHtml(message.senderName ?? "")}</span>${quote}<span class="text" dir="auto">${body}</span>${reactions}<time>${escapeHtml(formatWhen(message.timestamp))}</time><button class="context-btn" data-context-id="${escapeHtml(message.id)}">Show nearby messages</button>${message.mediaType ? `<button class="media-btn" data-download-id="${escapeHtml(message.id)}">Save file</button>` : ""}</li>`,
    );
  }
  const list = items.join("");
  return `<div class="messages" data-chat-jid="${escapeHtml(chatJid)}"><ul>${list}</ul><form class="send-box" data-chat-jid="${escapeHtml(chatJid)}"><input name="text" placeholder="Type a message" aria-label="Type a message" /><button class="primary" type="submit">Send</button></form></div>`;
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
  return `<div id="context-view"><h3>Around this message</h3><ul>${items}</ul></div>`;
}

export function settingsHtml(settings: { bridgeUrl: string; token: string }): string {
  return `<section id="settings-page"><h1>Settings</h1><form id="settings-form"><label>Server address<input id="bridge-url" aria-label="Server address" value="${escapeHtml(settings.bridgeUrl)}" /></label><label>Access key — filled in automatically; only change this if support asks you to<input id="token" type="password" aria-label="Access key" value="${escapeHtml(settings.token)}" autocomplete="off" /></label><button id="reveal-token" type="button">show</button><button class="primary" type="submit">Save</button></form></section>`;
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

export interface MeInfo {
  pn: string | null;
  name: string | null;
  status: string | null;
}

const PRIVACY_ROWS: Array<{ key: string; label: string }> = [
  { key: "last", label: "Last seen" },
  { key: "online", label: "Online" },
  { key: "profile", label: "Profile photo" },
  { key: "status", label: "About" },
  { key: "groupadd", label: "Who can add me to groups" },
  { key: "calladd", label: "Who can call me" },
  { key: "messages", label: "Who can message me" },
  { key: "readreceipts", label: "Read receipts" },
];

const PRIVACY_LABELS: Record<string, string> = {
  all: "Everyone",
  contacts: "My contacts",
  contact_blacklist: "My contacts except…",
  none: "Nobody",
  match_last_seen: "Same as last seen",
  known: "People I know",
};

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
      `<option value="${escapeHtml(value)}"${value === live ? " selected" : ""}>${escapeHtml(PRIVACY_LABELS[value] ?? value)}</option>`,
  )
  .join("")}
</select></label></div>`;
  }).join("");
  return `<section id="profile-page"><h1>Profile</h1>
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
<form id="block-form"><label>Block a number<input name="chat_jid" placeholder="+44 7700 900123" aria-label="Block a number" /></label><button class="danger" type="submit">Block</button></form>
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
  return `<div class="error-banner" role="alert">⚠ ${escapeHtml(message)} <button class="banner-retry" type="button">Retry</button></div>`;
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
      if (err instanceof ApiError && err.status === 429 && err.retryAfterMs !== null) {
        await new Promise((resolve) =>
          setTimeout(resolve, Math.min(err.retryAfterMs as number, 5_000)),
        );
        try {
          return await loader(params);
        } catch (retryErr) {
          const retryMessage = retryErr instanceof Error ? retryErr.message : String(retryErr);
          return errorBannerHtml(`could not load this page: ${retryMessage}`);
        }
      }
      const message = err instanceof Error ? err.message : String(err);
      return errorBannerHtml(`could not load this page: ${message}`);
    }
  };
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
