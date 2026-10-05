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
  loggedIn: boolean;
  token: string;
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
): ExchangeFailureVerdict {
  if (failure !== null && failure.status === 403) {
    return { terminal: true, retryAfterMs: null };
  }
  if (failure !== null && failure.status === 429) {
    return { terminal: false, retryAfterMs: failure.retryAfterMs ?? null };
  }
  return { terminal: false, retryAfterMs: null };
}

export function shouldExchange(state: ExchangeState): boolean {
  if (state.token.length > 0) {
    return false;
  }
  if (state.terminal) {
    return false;
  }
  return state.now >= state.retryNotBefore;
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
