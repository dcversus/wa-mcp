export interface WebSettings {
  bridgeUrl: string;
  token: string;
}

export interface SettingsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

const SETTINGS_KEY = "wa-mcp-settings";

export const DEFAULT_SETTINGS: WebSettings = { bridgeUrl: "http://127.0.0.1:8080", token: "" };

export function loadSettings(storage: SettingsStorage): WebSettings {
  const raw = storage.getItem(SETTINGS_KEY);
  if (raw === null) {
    return { ...DEFAULT_SETTINGS };
  }
  try {
    const parsed = JSON.parse(raw) as Partial<WebSettings>;
    return {
      bridgeUrl:
        typeof parsed.bridgeUrl === "string" ? parsed.bridgeUrl : DEFAULT_SETTINGS.bridgeUrl,
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
