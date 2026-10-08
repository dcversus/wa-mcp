import { escapeHtml } from "./escape.ts";
import {
  activityFeedHtml,
  diagnosticsHtml,
  emptyState,
  formatDuration,
  formatRelative,
  statusCardHtml,
  type ActivityEvent,
} from "./pages.ts";

export interface HumanisationView {
  enabled: boolean;
  minDelayMs: number;
  maxDelayMs: number;
  typingStatus: boolean;
  delayPerCharMs: number;
}

export interface SendLimitsView {
  enabled: boolean;
  perMinute: number;
  perHour: number;
  perDay: number;
  perChatPerDay: number | null;
}

export interface ConnectionSettingsView {
  humanisation: HumanisationView;
  sendLimits: SendLimitsView;
}

export interface ConnectionStatsView {
  status: string;
  uptime: number;
  reconnects: number;
  lastDisconnectAt: number | null;
  sentToday: number;
  receivedToday: number;
}

export interface ConnectionPageView {
  health: Record<string, unknown>;
  me: { name: string | null; pn: string | null } | null;
  stats: ConnectionStatsView | null;
  settings: ConnectionSettingsView | null;
  events: ActivityEvent[];
  saved?: string;
  error?: string;
}

type FormResult = { ok: true; value: ConnectionSettingsView } | { ok: false; message: string };

const NUMBER_FIELDS: Array<{ name: string; label: string; unit: string }> = [
  { name: "humanisation.minDelayMs", label: "Min delay", unit: "ms" },
  { name: "humanisation.maxDelayMs", label: "Max delay", unit: "ms" },
  { name: "humanisation.delayPerCharMs", label: "Per character", unit: "ms" },
  { name: "sendLimits.perMinute", label: "Per minute", unit: "messages" },
  { name: "sendLimits.perHour", label: "Per hour", unit: "messages" },
  { name: "sendLimits.perDay", label: "Per day", unit: "messages" },
];

function stat(label: string, value: string): string {
  return `<div class="stat"><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function statsHtml(stats: ConnectionStatsView | null): string {
  const body =
    stats === null
      ? emptyState("Stats appear once the bridge is running with a store")
      : `<dl class="stats">${[
          stat("Messages sent", String(stats.sentToday)),
          stat("Messages received", String(stats.receivedToday)),
          stat("Uptime", formatDuration(stats.uptime)),
          stat("Reconnects", String(stats.reconnects)),
          stat(
            "Last reconnect",
            stats.lastDisconnectAt === null ? "—" : formatRelative(stats.lastDisconnectAt),
          ),
        ].join("")}</dl>`;
  return `<div class="panel" id="connection-stats"><h2>Today</h2>${body}</div>`;
}

function connectNewHtml(linked: boolean): string {
  const intro = linked
    ? "This computer is already linked. To use a different phone, unlink it on the linking page first, then link the new one."
    : "Link WhatsApp to this computer from your phone: Settings → Linked devices → Link a device.";
  return `<div class="panel" id="connect-new"><h2>Connect a phone</h2><p class="hint">${intro}</p><div class="button-row"><a class="button" href="#/pairing">Link with a QR code</a><a class="button secondary" href="#/pairing">Link with a phone-number code</a></div><p class="hint">Business numbers can use the WhatsApp Cloud API with an API key instead: start the bridge with <code>WA_CHANNEL=cloud</code> and the Cloud API variables from the configuration guide.</p></div>`;
}

function checkbox(name: string, checked: boolean, label: string): string {
  return `<label class="check-row"><input type="checkbox" name="${name}"${checked ? " checked" : ""} /> ${escapeHtml(label)}</label>`;
}

function numberInput(name: string, label: string, value: string, placeholder?: string): string {
  return `<label>${escapeHtml(label)}<input type="number" min="0" step="1" inputmode="numeric" name="${name}" value="${escapeHtml(value)}"${placeholder === undefined ? "" : ` placeholder="${placeholder}"`} /></label>`;
}

function settingsFormHtml(view: ConnectionPageView): string {
  const settings = view.settings;
  if (settings === null) {
    return `<div class="panel">${emptyState("Settings are unavailable — the bridge has no store attached")}</div>`;
  }
  const human = settings.humanisation;
  const limits = settings.sendLimits;
  const flash =
    view.error !== undefined
      ? `<span id="connection-settings-status" class="save-flash danger" role="status" aria-live="polite">${escapeHtml(view.error)}</span>`
      : `<span id="connection-settings-status" class="save-flash ok" role="status" aria-live="polite">${escapeHtml(view.saved ?? "")}</span>`;
  return `<form id="connection-settings-form" class="panel"><h2>Sending behaviour</h2>
<fieldset><legend>Humanisation</legend>${checkbox("humanisation.enabled", human.enabled, "Reply like a person")}<p class="hint">Before each message the bridge waits as if typing it: the min delay plus time per character, capped at the max delay, with ±20% randomness.</p>${checkbox("humanisation.typingStatus", human.typingStatus, "Show “typing…” while waiting")}<div class="field-grid">${numberInput("humanisation.minDelayMs", "Min delay (ms)", String(human.minDelayMs))}${numberInput("humanisation.maxDelayMs", "Max delay (ms)", String(human.maxDelayMs))}${numberInput("humanisation.delayPerCharMs", "Per character (ms)", String(human.delayPerCharMs))}</div></fieldset>
<fieldset><legend>Send limits</legend>${checkbox("sendLimits.enabled", limits.enabled, "Limit how much this connection sends")}<p class="hint">Keeps the account clear of WhatsApp's anti-spam checks. Over a limit, sends are refused with a retry time instead of going out.</p><div class="field-grid">${numberInput("sendLimits.perMinute", "Per minute", String(limits.perMinute))}${numberInput("sendLimits.perHour", "Per hour", String(limits.perHour))}${numberInput("sendLimits.perDay", "Per day", String(limits.perDay))}${numberInput("sendLimits.perChatPerDay", "Per chat per day", limits.perChatPerDay === null ? "" : String(limits.perChatPerDay), "no cap")}</div></fieldset>
<div class="form-actions"><button type="submit">Save settings</button>${flash}</div></form>`;
}

export function connectionPageHtml(view: ConnectionPageView): string {
  const linked = view.health.loggedIn === true;
  return `<section id="connection-page"><h1>Connection</h1>${statusCardHtml(view.health, view.me)}<div class="card-grid">${statsHtml(view.stats)}${connectNewHtml(linked)}</div>${settingsFormHtml(view)}<div id="status-dashboard" class="panel"><h2>Recent activity</h2>${activityFeedHtml(view.events)}${diagnosticsHtml(view.health)}</div></section>`;
}

export function readConnectionSettingsForm(get: (name: string) => string | null): FormResult {
  const numbers: Record<string, number> = {};
  for (const field of NUMBER_FIELDS) {
    const raw = (get(field.name) ?? "").trim();
    if (!/^\d+$/.test(raw)) {
      return { ok: false, message: `${field.label} must be a whole number` };
    }
    numbers[field.name] = Number(raw);
  }
  const perChatRaw = (get("sendLimits.perChatPerDay") ?? "").trim();
  if (perChatRaw.length > 0 && !/^\d+$/.test(perChatRaw)) {
    return { ok: false, message: "Per chat per day must be a whole number, or empty for no cap" };
  }
  return {
    ok: true,
    value: {
      humanisation: {
        enabled: get("humanisation.enabled") !== null,
        typingStatus: get("humanisation.typingStatus") !== null,
        minDelayMs: numbers["humanisation.minDelayMs"] ?? 0,
        maxDelayMs: numbers["humanisation.maxDelayMs"] ?? 0,
        delayPerCharMs: numbers["humanisation.delayPerCharMs"] ?? 0,
      },
      sendLimits: {
        enabled: get("sendLimits.enabled") !== null,
        perMinute: numbers["sendLimits.perMinute"] ?? 0,
        perHour: numbers["sendLimits.perHour"] ?? 0,
        perDay: numbers["sendLimits.perDay"] ?? 0,
        perChatPerDay: perChatRaw.length === 0 ? null : Number(perChatRaw),
      },
    },
  };
}
