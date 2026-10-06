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

export function needsToken(settings: WebSettings): boolean {
  return settings.token.length === 0;
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

/** Read keys come from GET /api/privacy (Baileys' own naming); write keys are
 * the bridge's PRIVACY_KEYS (profile.ts). One mapping, drift-guarded by test. */
export const PRIVACY_READ_TO_WRITE: Record<string, string> = {
  last: "lastSeen",
  profile: "profilePic",
  status: "status",
  groupadd: "groups",
  calladd: "calls",
  readreceipts: "readReceipts",
  online: "online",
  messages: "messages",
};

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
    const renderPairing = input.hash === "" || input.hash === "#/" || input.hash === "#/chats";
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

export interface PickerToggle {
  checked: boolean;
  includeMedia: boolean;
  chatJid: string;
  subIds: string[];
}

export type PickerAction =
  | { kind: "create"; chatJid: string; kinds: string[]; includeMedia: boolean }
  | { kind: "delete"; ids: string[] }
  | { kind: "none" };

export function pickerToggleAction(toggle: PickerToggle): PickerAction {
  if (toggle.checked) {
    return {
      kind: "create",
      chatJid: toggle.chatJid,
      kinds: ["message"],
      includeMedia: toggle.includeMedia,
    };
  }
  if (toggle.subIds.length === 0) {
    return { kind: "none" };
  }
  return { kind: "delete", ids: toggle.subIds };
}

const PRIVACY_VALUES: Record<string, string[]> = {
  last: ["all", "contacts", "contact_blacklist", "none"],
  profile: ["all", "contacts", "contact_blacklist", "none"],
  status: ["all", "contacts", "contact_blacklist", "none"],
  groupadd: ["all", "contacts", "contact_blacklist", "none"],
  calladd: ["all", "known"],
  readreceipts: ["all", "none"],
  online: ["all", "match_last_seen"],
  messages: ["all", "contacts"],
};

export function buildPrivacyPatch(readKey: string, value: string): Record<string, string> {
  const writeKey = PRIVACY_READ_TO_WRITE[readKey];
  if (writeKey === undefined) {
    throw new Error(`unknown privacy key: ${readKey}`);
  }
  return { [writeKey]: value };
}

export function privacyOptionsFor(readKey: string): string[] {
  return PRIVACY_VALUES[readKey] ?? ["all"];
}
