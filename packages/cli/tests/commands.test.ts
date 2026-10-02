import { expect, test } from "vite-plus/test";
import { buildStatusSummary, parseArgs } from "../src/commands.ts";

test("parseArgs extracts command, flags and positionals", () => {
  const parsed = parseArgs([
    "install",
    "--target",
    "cursor",
    "--home",
    "/h",
    "--bridge-url",
    "http://b",
  ]);
  expect(parsed.command).toBe("install");
  expect(parsed.flags.target).toBe("cursor");
  expect(parsed.flags.home).toBe("/h");
  expect(parsed.flags["bridge-url"]).toBe("http://b");
  expect(parsed.positionals).toEqual([]);
});

test("parseArgs defaults to help without a command", () => {
  expect(parseArgs([]).command).toBe("help");
});

test("buildStatusSummary shapes the health payload", () => {
  const summary = buildStatusSummary({
    status: "connected",
    connected: true,
    loggedIn: true,
    version: "0.9.0",
    uptime: 42,
  });
  expect(summary).toMatchObject({ connected: true, loggedIn: true, version: "0.9.0" });
  expect(summary.uptimeSeconds).toBe(42);
});
