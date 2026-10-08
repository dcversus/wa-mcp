import { escapeHtml } from "./escape.ts";
import { ApiError } from "./api.ts";
import { formatPhone } from "./state.ts";
import { PRIVACY_LABELS, PRIVACY_SETTINGS, privacyOptionsFor } from "../../shared/src/privacy.ts";

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
  { id: "logs", label: "Logs", href: "#/logs" },
  { id: "contacts", label: "Contacts", href: "#/contacts" },
  { id: "connections", label: "Connections", href: "#/connections" },
  { id: "subscriptions", label: "Subscriptions", href: "#/subscriptions" },
  { id: "profile", label: "Profile", href: "#/profile" },
  { id: "connection", label: "Connection", href: "#/connection" },
  { id: "settings", label: "Settings", href: "#/settings" },
  { id: "help", label: "Help", href: "#/help" },
];

export const NAV_TITLES: Record<string, string> = {
  chat: "Chat",
  logs: "Logs",
  contacts: "Contacts",
  connections: "Connections",
  subscriptions: "Subscriptions",
  profile: "Profile",
  connection: "Connection",
  settings: "Settings",
  pairing: "Link phone",
  help: "Help",
};

export function navHtml(active: string, version = "0.9.0"): string {
  const groups: Array<{ label: string; keys: string[] }> = [
    { label: "Messages", keys: ["logs"] },
    { label: "People", keys: ["contacts"] },
    { label: "Agent", keys: ["connections", "subscriptions"] },
    { label: "Me", keys: ["profile"] },
    { label: "System", keys: ["connection", "settings"] },
    { label: "", keys: ["help"] },
  ];
  const brand = `<div class="brand"><strong>wa-mcp</strong><span class="version">v${version}</span></div>`;
  const links = groups
    .map((group) => {
      const label = group.label.length > 0 ? `<div class="nav-group">${group.label}</div>` : "";
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

export interface ActivityEvent {
  type: string;
  at: number;
  detail?: string;
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

export function diagnosticsHtml(health: Record<string, unknown>): string {
  const fields = Object.entries(health)
    .filter(([key]) => !/token/i.test(key))
    .filter(([key]) => key !== "channel" || health.channel !== undefined)
    .map(
      ([key, value]) =>
        `<div class="stat"><dt>${escapeHtml(key)}</dt><dd>${escapeHtml(formatStatValue(key, value))}</dd></div>`,
    )
    .join("");
  return `<details class="diagnostics"><summary>Diagnostics</summary><dl class="stats">${fields}</dl></details>`;
}

export function activityFeedHtml(events: ActivityEvent[]): string {
  const feed = events
    .map(
      (event) =>
        `<li><time>${escapeHtml(formatWhen(event.at))}</time> <strong>${escapeHtml(event.type)}</strong> <span>${escapeHtml(event.detail ?? "")}</span></li>`,
    )
    .join("");
  return `<ul class="events">${feed.length > 0 ? feed : `<li>${emptyState("No recent activity")}</li>`}</ul>`;
}

export function statusCardHtml(
  health: Record<string, unknown>,
  me: { name: string | null; pn: string | null } | null | undefined,
): string {
  const linked = health.loggedIn === true;
  const who = me ?? null;
  const identity =
    who !== null && who.name !== null && who.pn !== null
      ? `${who.name} (${formatPhone(who.pn)})`
      : (who?.name ?? (who?.pn != null ? formatPhone(who.pn) : "this account"));
  const subs = health.subscriptions;
  const subCount =
    typeof subs === "object" && subs !== null
      ? Number((subs as { count?: unknown }).count ?? 0)
      : 0;
  return linked
    ? `<p class="status-card">✅ Linked as <strong>${escapeHtml(identity)}</strong>${health.connected === true ? " · online" : " · reconnecting"}${typeof health.lastDisconnectAt === "number" ? ` · last reconnect ${escapeHtml(formatRelative(health.lastDisconnectAt))}` : ""}${typeof health.uptime === "number" ? ` · running for ${escapeHtml(formatDuration(health.uptime))}` : ""} · ${subCount} agent subscription${subCount === 1 ? "" : "s"}</p>`
    : `<p class="status-card">⚠ WhatsApp not linked — <a href="#/pairing">Link now</a></p>`;
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

export function profilePageHtml(input: {
  blocklist: string[];
  me?: { pn: string | null; name: string | null; status: string | null };
  privacy?: Record<string, string>;
}): string {
  const entries = input.blocklist
    .map((jid) => {
      const label = escapeHtml(formatPhone(jid));
      const safe = escapeHtml(jid);
      return `<li data-blocked-jid="${safe}"><span class="blocked-who"><strong>${label}</strong><code>${safe}</code></span><button type="button" data-unblock-jid="${safe}" aria-label="Unblock ${label}">Unblock</button></li>`;
    })
    .join("");
  const me = input.me ?? { pn: null, name: null, status: null };
  const title = me.name !== null && me.name.length > 0 ? me.name : "Your profile";
  const phone =
    me.pn === null
      ? '<code id="me-phone">—</code>'
      : `${escapeHtml(formatPhone(me.pn))} · <code id="me-phone">${escapeHtml(me.pn)}</code>`;
  const privacyRows = PRIVACY_SETTINGS.map((row) => {
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
  const blocked =
    entries.length > 0
      ? `<ul class="blocklist">${entries}</ul>`
      : emptyState("No blocked contacts");
  return `<section id="profile-page"><h1>Profile</h1><div class="profile-grid">
<div class="panel me-card"><span class="avatar avatar-lg" aria-hidden="true">${escapeHtml(initials(title))}</span>
<div class="me-fields"><h3 class="me-title">${escapeHtml(title)}</h3><p class="me-phone">${phone}</p>
<label>Display name<span class="field-row"><input id="me-name" value="${escapeHtml(me.name ?? "")}" aria-label="Display name" /><button id="save-name" type="button">Save name</button></span></label>
<label>About<span class="field-row"><input id="me-status" value="${escapeHtml(me.status ?? "")}" placeholder="Hey there! I am using WhatsApp." aria-label="About" /><button id="save-status" type="button">Save about</button></span></label>
<span id="profile-save-status" class="save-flash" role="status" aria-live="polite"></span>
</div></div>
<div class="panel"><h3>Privacy</h3><p class="hint">Who can see your details on WhatsApp. Changes save as soon as you pick an option.</p><div class="privacy-settings">${privacyRows}</div></div>
<div class="panel"><h3>Blocked contacts</h3><p class="hint">Blocked numbers can't call you or send you messages.</p><form id="block-form"><label>Block a number<input name="chat_jid" placeholder="+44 7700 900123" aria-label="Block a number" /></label><button class="danger" type="submit">Block</button></form>${blocked}</div>
</div></section>`;
}

/** T73 C2: the group subject/description come straight from WhatsApp and are
 * rendered into an HTML attribute — every value escapes before interpolation. */
/** T54: a 401 on a just-navigated route renders the token form INLINE on the
 * same route (no redirect loop) with the exact recovery hint. */

export function notFoundHtml(route: string): string {
  return `<section id="not-found" class="pane"><h2>Page not found</h2><p>The route <code>${escapeHtml(route)}</code> does not exist.</p><p><a href="#/contacts">Go to contacts</a></p></section>`;
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
