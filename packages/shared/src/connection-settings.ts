export const DEFAULT_CONNECTION_ID = "default";

export interface HumanisationSettings {
  enabled: boolean;
  minDelayMs: number;
  maxDelayMs: number;
  typingStatus: boolean;
  delayPerCharMs: number;
}

export interface SendLimits {
  enabled: boolean;
  perMinute: number;
  perHour: number;
  perDay: number;
  perChatPerDay: number | null;
}

export interface ConnectionSettings {
  humanisation: HumanisationSettings;
  sendLimits: SendLimits;
}

export interface ConnectionSettingsPatch {
  humanisation?: Partial<HumanisationSettings>;
  sendLimits?: Partial<SendLimits>;
}

export const DEFAULT_CONNECTION_SETTINGS: ConnectionSettings = Object.freeze({
  humanisation: Object.freeze({
    enabled: false,
    minDelayMs: 1500,
    maxDelayMs: 8000,
    typingStatus: true,
    delayPerCharMs: 60,
  }),
  sendLimits: Object.freeze({
    enabled: false,
    perMinute: 30,
    perHour: 120,
    perDay: 500,
    perChatPerDay: null,
  }),
}) as ConnectionSettings;

export const MAX_DELAY_MS = 120_000;
export const MAX_DELAY_PER_CHAR_MS = 1000;
export const LIMIT_CEILINGS = { perMinute: 1000, perHour: 20_000, perDay: 100_000 } as const;

export type ConnectionSettingsValidation =
  | { ok: true; value: ConnectionSettings }
  | { ok: false; message: string };

type Loose = Record<string, unknown>;

function isObject(value: unknown): value is Loose {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isWhole(value: unknown, min: number, max: number): value is number {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max;
}

export function mergeConnectionSettings(
  base: ConnectionSettings,
  patch: ConnectionSettingsPatch,
): ConnectionSettings {
  return {
    humanisation: { ...base.humanisation, ...patch.humanisation },
    sendLimits: { ...base.sendLimits, ...patch.sendLimits },
  };
}

function checkHumanisation(value: HumanisationSettings): string | null {
  for (const key of ["enabled", "typingStatus"] as const) {
    if (typeof value[key] !== "boolean") {
      return `humanisation.${key} must be true or false`;
    }
  }
  for (const key of ["minDelayMs", "maxDelayMs"] as const) {
    if (!isWhole(value[key], 0, MAX_DELAY_MS)) {
      return `humanisation.${key} must be a whole number from 0 to ${MAX_DELAY_MS}`;
    }
  }
  if (!isWhole(value.delayPerCharMs, 0, MAX_DELAY_PER_CHAR_MS)) {
    return `humanisation.delayPerCharMs must be a whole number from 0 to ${MAX_DELAY_PER_CHAR_MS}`;
  }
  if (value.minDelayMs > value.maxDelayMs) {
    return `humanisation.minDelayMs (${value.minDelayMs}) must not exceed maxDelayMs (${value.maxDelayMs})`;
  }
  return null;
}

function checkLimits(value: SendLimits): string | null {
  if (typeof value.enabled !== "boolean") {
    return "sendLimits.enabled must be true or false";
  }
  for (const key of ["perMinute", "perHour", "perDay"] as const) {
    if (!isWhole(value[key], 1, LIMIT_CEILINGS[key])) {
      return `sendLimits.${key} must be a whole number from 1 to ${LIMIT_CEILINGS[key]}`;
    }
  }
  if (value.perChatPerDay !== null && !isWhole(value.perChatPerDay, 1, LIMIT_CEILINGS.perDay)) {
    return `sendLimits.perChatPerDay must be a whole number from 1 to ${LIMIT_CEILINGS.perDay}, or null for no per-chat cap`;
  }
  return null;
}

export function validateConnectionSettings(
  input: unknown,
  base: ConnectionSettings = DEFAULT_CONNECTION_SETTINGS,
): ConnectionSettingsValidation {
  if (!isObject(input)) {
    return { ok: false, message: "settings must be an object" };
  }
  for (const key of ["humanisation", "sendLimits"] as const) {
    if (input[key] !== undefined && !isObject(input[key])) {
      return { ok: false, message: `${key} must be an object` };
    }
  }
  const merged = mergeConnectionSettings(base, input as ConnectionSettingsPatch);
  const problem = checkHumanisation(merged.humanisation) ?? checkLimits(merged.sendLimits);
  return problem === null ? { ok: true, value: merged } : { ok: false, message: problem };
}
