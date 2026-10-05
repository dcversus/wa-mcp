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
  latched: boolean;
}

/** T142-W1: decide whether to attempt the ui-token exchange. A failure
 * latches only until the daemon reports loggedIn — then the owner-rule
 * retry kicks in. An existing session token means never exchange. */
export function shouldExchange(state: ExchangeState): boolean {
  if (state.token.length > 0) {
    return false;
  }
  if (state.latched && !state.loggedIn) {
    return false;
  }
  return true;
}

/** Priority: saved session token wins; the ephemeral pairing token is the
 * fallback so pairing pages work before any token is stored. */
export function effectiveToken(settings: WebSettings, pairingToken: string): string {
  return settings.token.length > 0 ? settings.token : pairingToken;
}
