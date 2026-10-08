import { expect, test } from "vite-plus/test";
import {
  DEFAULT_CONNECTION_ID,
  DEFAULT_CONNECTION_SETTINGS,
  mergeConnectionSettings,
  validateConnectionSettings,
  type ConnectionSettings,
} from "../src/connection-settings.ts";

function errorOf(input: unknown, base?: ConnectionSettings): string {
  const result = validateConnectionSettings(input, base);
  if (result.ok) throw new Error("expected a validation error");
  return result.message;
}

test("T181 A1 — defaults: humanisation off, limits off with anti-ban values 30/min, 120/h, 500/day", () => {
  expect(DEFAULT_CONNECTION_ID).toBe("default");
  expect(DEFAULT_CONNECTION_SETTINGS).toEqual({
    humanisation: {
      enabled: false,
      minDelayMs: 1500,
      maxDelayMs: 8000,
      typingStatus: true,
      delayPerCharMs: 60,
    },
    sendLimits: {
      enabled: false,
      perMinute: 30,
      perHour: 120,
      perDay: 500,
      perChatPerDay: null,
    },
  });
});

test("T181 A1 — a partial patch merges onto the base; the base is not mutated", () => {
  const result = validateConnectionSettings({
    humanisation: { enabled: true, maxDelayMs: 4000 },
    sendLimits: { perChatPerDay: 40 },
  });
  expect(result).toEqual({
    ok: true,
    value: {
      humanisation: {
        ...DEFAULT_CONNECTION_SETTINGS.humanisation,
        enabled: true,
        maxDelayMs: 4000,
      },
      sendLimits: { ...DEFAULT_CONNECTION_SETTINGS.sendLimits, perChatPerDay: 40 },
    },
  });
  expect(DEFAULT_CONNECTION_SETTINGS.humanisation.enabled).toBe(false);
  const base = mergeConnectionSettings(DEFAULT_CONNECTION_SETTINGS, {
    sendLimits: { enabled: true },
  });
  expect(validateConnectionSettings({ sendLimits: { perChatPerDay: null } }, base)).toEqual({
    ok: true,
    value: base,
  });
});

test("T181 A1 — validation messages", () => {
  expect(errorOf(null)).toBe("settings must be an object");
  expect(errorOf({ humanisation: 1 })).toBe("humanisation must be an object");
  expect(errorOf({ sendLimits: [] })).toBe("sendLimits must be an object");
  expect(errorOf({ humanisation: { enabled: "yes" } })).toBe(
    "humanisation.enabled must be true or false",
  );
  expect(errorOf({ humanisation: { typingStatus: 1 } })).toBe(
    "humanisation.typingStatus must be true or false",
  );
  expect(errorOf({ humanisation: { minDelayMs: -1 } })).toBe(
    "humanisation.minDelayMs must be a whole number from 0 to 120000",
  );
  expect(errorOf({ humanisation: { maxDelayMs: 120001 } })).toBe(
    "humanisation.maxDelayMs must be a whole number from 0 to 120000",
  );
  expect(errorOf({ humanisation: { delayPerCharMs: 1.5 } })).toBe(
    "humanisation.delayPerCharMs must be a whole number from 0 to 1000",
  );
  expect(errorOf({ humanisation: { minDelayMs: 9000 } })).toBe(
    "humanisation.minDelayMs (9000) must not exceed maxDelayMs (8000)",
  );
  expect(errorOf({ sendLimits: { enabled: 0 } })).toBe("sendLimits.enabled must be true or false");
  expect(errorOf({ sendLimits: { perMinute: 0 } })).toBe(
    "sendLimits.perMinute must be a whole number from 1 to 1000",
  );
  expect(errorOf({ sendLimits: { perMinute: 1001 } })).toBe(
    "sendLimits.perMinute must be a whole number from 1 to 1000",
  );
  expect(errorOf({ sendLimits: { perHour: 20001 } })).toBe(
    "sendLimits.perHour must be a whole number from 1 to 20000",
  );
  expect(errorOf({ sendLimits: { perDay: "500" } })).toBe(
    "sendLimits.perDay must be a whole number from 1 to 100000",
  );
  expect(errorOf({ sendLimits: { perChatPerDay: 0 } })).toBe(
    "sendLimits.perChatPerDay must be a whole number from 1 to 100000, or null for no per-chat cap",
  );
});
