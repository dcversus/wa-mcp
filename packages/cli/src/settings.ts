import type { ConnectionSettings, ConnectionSettingsPatch } from "@wa-mcp/shared";

export interface SettingsDeps {
  fetchFn: typeof fetch;
  print: (line: string) => void;
}

export interface SettingsArgs {
  baseUrl: string;
  token: string;
  action: string;
  flags: Record<string, string>;
}

interface SettingsRecord {
  connection: string;
  settings: ConnectionSettings;
  updatedAt: string | null;
}

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

const SWITCHES = {
  humanise: ["humanisation", "enabled"],
  typing: ["humanisation", "typingStatus"],
  limits: ["sendLimits", "enabled"],
} as const;

const NUMBERS = {
  "min-delay": ["humanisation", "minDelayMs"],
  "max-delay": ["humanisation", "maxDelayMs"],
  "per-char": ["humanisation", "delayPerCharMs"],
  "per-minute": ["sendLimits", "perMinute"],
  "per-hour": ["sendLimits", "perHour"],
  "per-day": ["sendLimits", "perDay"],
} as const;

const SET_HINT =
  "settings set: pass at least one of --humanise on|off, --min-delay <ms>, --max-delay <ms>, --per-char <ms>, --typing on|off, --limits on|off, --per-minute <n>, --per-hour <n>, --per-day <n>, --per-chat-day <n|off>";

function onOff(value: boolean): string {
  return value ? "on" : "off";
}

export function settingsLines(record: SettingsRecord): string[] {
  const { humanisation: human, sendLimits: limits } = record.settings;
  const when =
    record.updatedAt === null ? "defaults — never changed" : `updated ${record.updatedAt}`;
  return [
    `connection: ${record.connection} (${when})`,
    `humanisation: ${onOff(human.enabled)}`,
    `  delay: ${human.minDelayMs}–${human.maxDelayMs} ms, +${human.delayPerCharMs} ms per character, ±20% jitter`,
    `  typing status: ${onOff(human.typingStatus)}`,
    `send limits: ${onOff(limits.enabled)}`,
    `  per minute ${limits.perMinute} · per hour ${limits.perHour} · per day ${limits.perDay} · per chat per day${limits.perChatPerDay === null ? ": no cap" : ` ${limits.perChatPerDay}`}`,
  ];
}

function wholeNumber(flag: string, raw: string): Result<number> {
  return /^\d+$/.test(raw)
    ? { ok: true, value: Number(raw) }
    : { ok: false, message: `settings set: --${flag} must be a whole number (got ${raw})` };
}

export function patchFromFlags(flags: Record<string, string>): Result<ConnectionSettingsPatch> {
  const humanisation: Record<string, unknown> = {};
  const sendLimits: Record<string, unknown> = {};
  const sections = { humanisation, sendLimits };
  for (const [flag, [section, key]] of Object.entries(SWITCHES)) {
    const raw = flags[flag];
    if (raw === undefined) {
      continue;
    }
    if (raw !== "on" && raw !== "off") {
      return { ok: false, message: `settings set: --${flag} must be on or off (got ${raw})` };
    }
    sections[section][key] = raw === "on";
  }
  for (const [flag, [section, key]] of Object.entries(NUMBERS)) {
    const raw = flags[flag];
    if (raw === undefined) {
      continue;
    }
    const parsed = wholeNumber(flag, raw);
    if (!parsed.ok) {
      return parsed;
    }
    sections[section][key] = parsed.value;
  }
  const perChat = flags["per-chat-day"];
  if (perChat !== undefined) {
    if (perChat === "off") {
      sendLimits.perChatPerDay = null;
    } else {
      const parsed = wholeNumber("per-chat-day", perChat);
      if (!parsed.ok) {
        return parsed;
      }
      sendLimits.perChatPerDay = parsed.value;
    }
  }
  const patch: ConnectionSettingsPatch = {
    ...(Object.keys(humanisation).length > 0 ? { humanisation } : {}),
    ...(Object.keys(sendLimits).length > 0 ? { sendLimits } : {}),
  };
  return Object.keys(patch).length === 0
    ? { ok: false, message: SET_HINT }
    : { ok: true, value: patch };
}

async function request(
  deps: SettingsDeps,
  args: SettingsArgs,
  method: string,
  body?: unknown,
): Promise<Result<SettingsRecord>> {
  const res = await deps.fetchFn(`${args.baseUrl}/api/connection-settings`, {
    method,
    headers: { authorization: `Bearer ${args.token}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const parsed = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) {
    const detail = parsed.error?.message;
    return {
      ok: false,
      message: `settings failed: HTTP ${res.status}${detail !== undefined ? ` — ${detail}` : ""}`,
    };
  }
  return { ok: true, value: parsed as SettingsRecord };
}

export async function runSettings(deps: SettingsDeps, args: SettingsArgs): Promise<number> {
  if (args.action !== "get" && args.action !== "set") {
    deps.print(`settings: unknown action '${args.action}' — use get or set`);
    return 1;
  }
  let result: Result<SettingsRecord>;
  if (args.action === "get") {
    result = await request(deps, args, "GET");
  } else {
    const patch = patchFromFlags(args.flags);
    if (!patch.ok) {
      deps.print(patch.message);
      return 1;
    }
    result = await request(deps, args, "PUT", patch.value);
  }
  if (!result.ok) {
    deps.print(result.message);
    return 1;
  }
  if (args.action === "set") {
    deps.print("saved");
  }
  for (const line of settingsLines(result.value)) {
    deps.print(line);
  }
  return 0;
}
