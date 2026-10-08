import { escapeHtml } from "./escape.ts";
import { emptyState, formatRelative } from "./pages.ts";
import { formatPhone } from "./state.ts";

export interface LogRow {
  id: string;
  chatJid: string;
  senderJid: string | null;
  senderName: string | null;
  timestamp: string;
  content: string | null;
  mediaType: string | null;
  isFromMe: boolean;
}

export interface LogFilter {
  chat: string;
  person: string;
  direction: "" | "in" | "out";
  since: string;
  until: string;
  q: string;
}

export const EMPTY_LOG_FILTER: LogFilter = {
  chat: "",
  person: "",
  direction: "",
  since: "",
  until: "",
  q: "",
};

export const LOGS_PAGE_SIZE = 50;

function localToIso(value: string): string | null {
  const ms = new Date(value).getTime();
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function logsQuery(filter: LogFilter, page: number, pageSize = LOGS_PAGE_SIZE): string {
  const params = new URLSearchParams();
  const entries: Array<[string, string | null]> = [
    ["chat_jid", filter.chat],
    ["from_jid", filter.person],
    ["direction", filter.direction],
    ["since", filter.since.length > 0 ? localToIso(filter.since) : null],
    ["until", filter.until.length > 0 ? localToIso(filter.until) : null],
    ["q", filter.q.trim()],
  ];
  for (const [key, value] of entries) {
    if (value !== null && value.length > 0) {
      params.set(key, value);
    }
  }
  params.set("limit", String(pageSize + 1));
  params.set("offset", String(page * pageSize));
  return params.toString();
}

export function matchesLogFilter(row: LogRow, filter: LogFilter): boolean {
  if (filter.chat.length > 0 && row.chatJid !== filter.chat) {
    return false;
  }
  if (filter.person.length > 0 && row.senderJid !== filter.person) {
    return false;
  }
  if (filter.direction === "in" && row.isFromMe) {
    return false;
  }
  if (filter.direction === "out" && !row.isFromMe) {
    return false;
  }
  const at = Date.parse(row.timestamp);
  if (filter.since.length > 0 && at < new Date(filter.since).getTime()) {
    return false;
  }
  if (filter.until.length > 0 && at > new Date(filter.until).getTime()) {
    return false;
  }
  const needle = filter.q.trim().toLowerCase();
  return needle.length === 0 || (row.content ?? "").toLowerCase().includes(needle);
}

type Loose = Record<string, unknown>;

function record(value: unknown): Loose {
  return value !== null && typeof value === "object" ? (value as Loose) : {};
}

function text(value: unknown): string | null {
  return typeof value === "string" ? value : null;
}

const MEDIA_KEYS: Array<[string, string]> = [
  ["imageMessage", "image"],
  ["videoMessage", "video"],
  ["audioMessage", "audio"],
  ["documentMessage", "document"],
  ["stickerMessage", "sticker"],
];

function rowFromWaMessage(raw: unknown): LogRow | null {
  const message = record(raw);
  const key = record(message.key);
  const id = text(key.id);
  const chatJid = text(key.remoteJid);
  if (id === null || chatJid === null) {
    return null;
  }
  const body = record(message.message);
  const media = MEDIA_KEYS.find(([field]) => body[field] !== undefined);
  const content =
    text(body.conversation) ??
    text(record(body.extendedTextMessage).text) ??
    (media !== undefined ? text(record(body[media[0]]).caption) : null);
  const seconds = Number(message.messageTimestamp);
  const fromMe = key.fromMe === true;
  return {
    id,
    chatJid,
    senderJid: fromMe ? null : (text(key.participant) ?? chatJid),
    senderName: fromMe ? null : text(message.pushName),
    timestamp: new Date(Number.isFinite(seconds) ? seconds * 1000 : Date.now()).toISOString(),
    content,
    mediaType: media?.[1] ?? null,
    isFromMe: fromMe,
  };
}

export function rowsFromUpsert(event: { type?: unknown; payload?: unknown }): LogRow[] {
  if (event.type !== "messages.upsert") {
    return [];
  }
  const messages = record(event.payload).messages;
  return Array.isArray(messages)
    ? messages.map(rowFromWaMessage).filter((row): row is LogRow => row !== null)
    : [];
}

export interface LogsPageInput {
  rows: LogRow[];
  filter: LogFilter;
  page: number;
  hasMore: boolean;
  live: boolean;
  chats: Array<{ jid: string; name: string | null }>;
  people: Array<{ jid: string; name: string | null }>;
  resolveName: (jid: string) => string | null;
  now?: number;
}

function chatLabel(jid: string, input: LogsPageInput): string {
  return (
    input.resolveName(jid) ?? input.chats.find((chat) => chat.jid === jid)?.name ?? formatPhone(jid)
  );
}

function senderLabel(row: LogRow, input: LogsPageInput): string {
  if (row.isFromMe) {
    return "You";
  }
  if (row.senderJid === null) {
    return row.senderName ?? "";
  }
  return input.resolveName(row.senderJid) ?? row.senderName ?? formatPhone(row.senderJid);
}

function arrowIcon(path: string): string {
  return `<svg class="icon" viewBox="0 0 16 16" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="${path}"/></svg>`;
}

export function logRowHtml(row: LogRow, input: LogsPageInput): string {
  const snippet = row.content ?? (row.mediaType !== null ? `[${row.mediaType}]` : "");
  const badge = row.isFromMe
    ? `<span class="dir-badge dir-out">${arrowIcon("M8 13V3M3.5 7.5 8 3l4.5 4.5")}out</span>`
    : `<span class="dir-badge dir-in">${arrowIcon("M8 3v10M3.5 8.5 8 13l4.5-4.5")}in</span>`;
  const absolute = new Date(row.timestamp).toLocaleString();
  return `<tr data-log-id="${escapeHtml(row.id)}"><td><time datetime="${escapeHtml(row.timestamp)}" title="${escapeHtml(absolute)}">${escapeHtml(formatRelative(row.timestamp, input.now))}</time></td><td>${badge}</td><td><a href="#/chat/${encodeURIComponent(row.chatJid)}">${escapeHtml(chatLabel(row.chatJid, input))}</a></td><td>${escapeHtml(senderLabel(row, input))}</td><td class="snippet">${escapeHtml(snippet.slice(0, 200))}</td></tr>`;
}

function pickerHtml(
  id: string,
  name: string,
  label: string,
  selected: string,
  options: Array<{ value: string; label: string }>,
): string {
  const rendered = options
    .map(
      (option) =>
        `<option value="${escapeHtml(option.value)}"${option.value === selected ? " selected" : ""}>${escapeHtml(option.label)}</option>`,
    )
    .join("");
  return `<label>${label} <select id="${id}" name="${name}">${rendered}</select></label>`;
}

export function logsPageHtml(input: LogsPageInput): string {
  const { filter } = input;
  const chatOptions = [
    { value: "", label: "All chats" },
    ...input.chats.map((chat) => ({ value: chat.jid, label: chatLabel(chat.jid, input) })),
  ];
  const personOptions = [
    { value: "", label: "Anyone" },
    ...input.people.map((person) => ({
      value: person.jid,
      label: input.resolveName(person.jid) ?? person.name ?? formatPhone(person.jid),
    })),
  ];
  const directionOptions = [
    { value: "", label: "Both directions" },
    { value: "in", label: "Incoming" },
    { value: "out", label: "Outgoing" },
  ];
  const form =
    `<form id="logs-filter" class="logs-filter">` +
    pickerHtml("logs-chat", "chat", "Chat", filter.chat, chatOptions) +
    pickerHtml("logs-person", "person", "Person", filter.person, personOptions) +
    pickerHtml("logs-direction", "direction", "Direction", filter.direction, directionOptions) +
    `<label>From <input type="datetime-local" id="logs-since" name="since" value="${escapeHtml(filter.since)}" /></label>` +
    `<label>To <input type="datetime-local" id="logs-until" name="until" value="${escapeHtml(filter.until)}" /></label>` +
    `<label>Text <input type="search" id="logs-q" name="q" value="${escapeHtml(filter.q)}" placeholder="Search message text" /></label>` +
    `<button type="submit" class="primary">Apply</button>` +
    `<button type="button" id="logs-reset">Reset</button>` +
    `</form>`;
  const live = `<label class="logs-live"><input type="checkbox" id="logs-live"${input.live ? " checked" : ""} /> Live tail</label>`;
  const body =
    input.rows.length > 0
      ? `<table class="logs-table"><thead><tr><th>Time</th><th>Direction</th><th>Chat</th><th>From</th><th>Message</th></tr></thead><tbody id="logs-rows">${input.rows
          .map((row) => logRowHtml(row, input))
          .join("")}</tbody></table>`
      : emptyState("No messages match these filters");
  const pager =
    `<div class="logs-pager">` +
    `<button type="button" id="logs-prev"${input.page === 0 ? " disabled" : ""}>← Newer</button>` +
    `<span>Page ${input.page + 1}</span>` +
    `<button type="button" id="logs-next"${input.hasMore ? "" : " disabled"}>Older →</button>` +
    `</div>`;
  return `<section id="logs-page" class="pane"><div class="logs-header"><h1>Logs</h1>${live}</div><p class="hint">Every message in and out of this WhatsApp account.</p>${form}${body}${pager}</section>`;
}
