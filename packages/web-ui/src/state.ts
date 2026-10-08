export {
  PRIVACY_READ_TO_WRITE,
  buildPrivacyPatch,
  privacyOptionsFor,
} from "../../shared/src/privacy.ts";
import { normalizeJid } from "../../shared/src/jid.ts";

export function blockTargetJid(raw: string): string | null {
  return normalizeJid(raw);
}
export interface WebSettings {
  bridgeUrl: string;
  token: string;
}

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SETTINGS_KEY = "wa-mcp-settings";

/** When served BY the bridge (the normal case) the UI must call its own
 * origin; the 8080 default only applies to bare-node contexts (tests). */
export function defaultBridgeUrl(): string {
  if (typeof location !== "undefined" && location.origin.startsWith("http")) {
    return location.origin;
  }
  return "http://127.0.0.1:8080";
}

export const DEFAULT_SETTINGS: WebSettings = { bridgeUrl: defaultBridgeUrl(), token: "" };

export function loadSettings(storage: SettingsStorage): WebSettings {
  const raw = storage.getItem(SETTINGS_KEY);
  if (raw === null) {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<WebSettings>;
    return {
      bridgeUrl:
        typeof parsed.bridgeUrl === "string" && parsed.bridgeUrl.length > 0
          ? parsed.bridgeUrl
          : DEFAULT_SETTINGS.bridgeUrl,
      token: typeof parsed.token === "string" ? parsed.token : "",
    };
  } catch {
    return { ...DEFAULT_SETTINGS };
  }
}

export function saveSettings(storage: SettingsStorage, settings: WebSettings): void {
  storage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

const PAIRING_TOKEN_KEY = "wa-mcp-pairing-token";

/** Ephemeral pairing token (from the public /health), persisted separately
 * from the real session token so pairing pages work tokenless. */
export function savePairingToken(storage: SettingsStorage, token: string): void {
  storage.setItem(PAIRING_TOKEN_KEY, token);
}

export function loadPairingToken(storage: SettingsStorage): string {
  return storage.getItem(PAIRING_TOKEN_KEY) ?? "";
}

export interface ExchangeState {
  /** the daemon reports loggedIn — a latched failure retries once it flips */
  loggedIn: boolean;
  token: string;
  latched: boolean;
  terminal: boolean;
  retryNotBefore: number;
  now: number;
}

export interface ExchangeFailureVerdict {
  terminal: boolean;
  retryAfterMs: number | null;
}

/** Classify a failed ui-token exchange: 403 (non-loopback origin or
 * bootstrap disabled) never changes within a page load — latch. 429 honors
 * the server's retry-after. Anything else (network, 5xx) retries on the next
 * sync once loggedIn. */
export function classifyExchangeFailure(
  failure: { status: number; retryAfterMs?: number | null } | null,
  context: { firstAttempt?: boolean } = {},
): ExchangeFailureVerdict {
  // 403: non-loopback origin or bootstrap disabled — nothing changes in this
  // page load. 401: the inline token form is the path, and retrying would
  // loop at ~2 req/s against the exchange cap — except on the very first
  // attempt, where a 401 can be a pre-bootstrap startup race.
  if (failure !== null && failure.status === 403) {
    return { terminal: true, retryAfterMs: null };
  }
  if (failure !== null && failure.status === 401) {
    if (context.firstAttempt === true) {
      return { terminal: false, retryAfterMs: null };
    }
    return { terminal: true, retryAfterMs: null };
  }
  if (failure !== null && failure.status === 429) {
    return { terminal: false, retryAfterMs: failure.retryAfterMs ?? null };
  }
  return { terminal: false, retryAfterMs: null };
}

export interface ExchangeFailureInput {
  failure: { status: number; retryAfterMs?: number | null } | null;
  attempt: number;
  now: number;
}

export interface ExchangeFailureResult {
  terminal: boolean;
  retryNotBefore: number;
  latched: true;
}

export function applyExchangeFailure(input: ExchangeFailureInput): ExchangeFailureResult {
  const verdict = classifyExchangeFailure(input.failure, { firstAttempt: input.attempt <= 1 });
  return {
    terminal: verdict.terminal,
    retryNotBefore: verdict.retryAfterMs !== null ? input.now + verdict.retryAfterMs : 0,
    latched: true,
  };
}

export function shouldExchange(state: ExchangeState): boolean {
  if (state.token.length > 0) {
    return false;
  }
  if (state.terminal) {
    return false;
  }
  // a latched failure only retries once the daemon reports loggedIn —
  // while unpaired the retry would just loop against a closed pairing window
  if (state.latched && !state.loggedIn) {
    return false;
  }
  return state.now >= state.retryNotBefore;
}

export interface StaleTokenCheck {
  token: string;
  terminal: boolean;
  exchangeMinted: boolean;
  clearedForEpoch: number;
  currentEpoch: number;
}

/** T147: a 401 may wipe the stored token once per epoch. Only a token the
 * exchange itself wrote is wipeable — a manually entered one never is. The
 * wipe budget is armed by a successful exchange (epoch bump) and consumed by
 * one clear; a terminal failure keeps the token (the inline form takes over). */
export function shouldClearStaleToken(check: StaleTokenCheck): boolean {
  if (check.terminal || check.token.length === 0) {
    return false;
  }
  if (!check.exchangeMinted) {
    return false;
  }
  return check.clearedForEpoch < check.currentEpoch;
}

/** Priority: saved session token wins; the ephemeral pairing token is the
 * fallback so pairing pages work before any token is stored. */
export function effectiveToken(settings: WebSettings, pairingToken: string): string {
  return settings.token.length > 0 ? settings.token : pairingToken;
}

export function formatPhone(jid: string): string {
  const local = jid.split("@")[0] ?? "";
  const digits = local.split(":")[0] ?? "";
  if (!/^\d{8,15}$/.test(digits)) {
    return jid;
  }
  if (digits.length === 12) {
    return `+${digits.slice(0, 3)} ${digits.slice(3, 5)} ${digits.slice(5, 8)} ${digits.slice(8)}`;
  }
  const groups = digits.match(/.{1,4}/g) ?? [digits];
  return `+${groups.join(" ")}`;
}

export function displayName(
  jid: string,
  contacts: Record<string, string | null> = {},
  aliases: Record<string, string> = {},
): string {
  if (contacts[jid] !== undefined && contacts[jid] !== null && contacts[jid] !== "") {
    return contacts[jid] as string;
  }
  if (aliases[jid] !== undefined && aliases[jid] !== "") {
    return aliases[jid];
  }
  const personal = jid.endsWith("@s.whatsapp.net") || jid.endsWith("@lid");
  if (personal) {
    return formatPhone(jid);
  }
  return "Unknown";
}

export interface LinkGateInput {
  loggedIn: boolean;
  contactsWarm: boolean;
  chatCount: number;
  hash: string;
}

export interface LinkGateDecision {
  renderPairing: boolean;
  banner: boolean;
  syncing: boolean;
}

export function firstRunGate(input: LinkGateInput): LinkGateDecision {
  if (!input.loggedIn) {
    const renderPairing = input.hash === "" || input.hash === "#/" || input.hash === "#/contacts";
    return {
      renderPairing,
      banner: !renderPairing && input.hash !== "#/pairing",
      syncing: false,
    };
  }
  return {
    renderPairing: false,
    banner: false,
    syncing: input.chatCount === 0 && !input.contactsWarm,
  };
}
