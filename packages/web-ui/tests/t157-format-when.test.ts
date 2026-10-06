process.env.TZ = "Europe/Paris";

import { expect, test } from "vite-plus/test";
import {
  formatDaySeparator,
  formatDuration,
  formatRelative,
  formatStatValue,
  formatWhen,
} from "../src/pages.ts";

const TODAY = "2026-10-06T18:03:00Z";
const YESTERDAY = "2026-10-05T12:00:00Z";
const LAST_WEEK = "2026-10-01T09:00:00Z";
const OLD = "2026-09-28T12:00:00Z";

test("T157 W6 — a today message renders as local HH:MM", () => {
  expect(formatWhen(TODAY, Date.parse(TODAY) + 60_000)).toBe("20:03");
});

test("T157 W6 — this week renders as the weekday", () => {
  expect(formatWhen(YESTERDAY, Date.parse(TODAY))).toBe("Mon");
  expect(formatWhen(LAST_WEEK, Date.parse(TODAY))).toBe("Thu");
});

test("T157 W6 — older renders as day + month", () => {
  expect(formatWhen(OLD, Date.parse(TODAY))).toBe("28 Sep");
});

test("T157 W6 — day separators read Today / Yesterday / weekday day month", () => {
  expect(formatDaySeparator(TODAY, Date.parse(TODAY))).toBe("Today");
  expect(formatDaySeparator(YESTERDAY, Date.parse(TODAY))).toBe("Yesterday");
  expect(formatDaySeparator(OLD, Date.parse(TODAY))).toBe("Mon 28 Sep");
});

test("T157 W6 — durations read human", () => {
  expect(formatDuration(86_400)).toBe("1 d 0 h");
  expect(formatDuration(7_560)).toBe("2 h 6 m");
  expect(formatDuration(600)).toBe("10 m");
});

test("T157 W6 — relative times read '2 h ago'", () => {
  const now = Date.parse(TODAY);
  expect(formatRelative(new Date(now - 7_200_000).toISOString(), now)).toBe("2 h 0 m ago");
});

test("T157 W6 — status stats render durations, not raw numbers", () => {
  expect(formatStatValue("uptime", 86_400)).toBe("1 d 0 h");
  const now = Date.now();
  expect(formatStatValue("lastDisconnectAt", now - 3_600_000)).toBe("1 h 0 m ago");
});
