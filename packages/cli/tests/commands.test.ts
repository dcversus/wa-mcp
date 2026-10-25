import { expect, test } from "vite-plus/test";
import { buildStatusSummary, parseArgs } from "../src/commands.ts";

test("parseArgs extracts command, flags and positionals", () => {
  const parsed = parseArgs([
    "install",
    "--target",
    "grok",
    "--home",
    "/h",
    "--bridge-url",
    "http://b",
  ]);
  expect(parsed.command).toBe("install");
  expect(parsed.flags.target).toBe("grok");
  expect(parsed.flags.home).toBe("/h");
  expect(parsed.flags["bridge-url"]).toBe("http://b");
  expect(parsed.positionals).toEqual([]);
});

test("parseArgs collects every repeated flag value", () => {
  const parsed = parseArgs(["install", "--target", "a", "--target", "b", "--target", "c"]);
  expect(parsed.lists.target).toEqual(["a", "b", "c"]);
  expect(parsed.flags.target).toBe("c");
  expect(parsed.command).toBe("install");
});

test("parseArgs still records single and boolean flags", () => {
  const parsed = parseArgs(["install", "--home", "/h", "--purge"]);
  expect(parsed.flags.home).toBe("/h");
  expect(parsed.lists.home).toEqual(["/h"]);
  expect(parsed.lists.purge).toEqual([""]);
});

test("parseArgs defaults to help without a command", () => {
  expect(parseArgs([]).command).toBe("help");
});

test("buildStatusSummary shapes the health payload", () => {
  const summary = buildStatusSummary({
    status: "connected",
    connected: true,
    loggedIn: true,
    version: "0.1.0",
    uptime: 42,
  });
  expect(summary).toMatchObject({ connected: true, loggedIn: true, version: "0.1.0" });
  expect(summary.uptimeSeconds).toBe(42);
});

test("T180 D parseArgs accepts --name=value so values may start with --", () => {
  const parsed = parseArgs(["subs", "create", "--arg=--model", "--arg=opus", "--like=%a=b%"]);
  expect(parsed.lists.arg).toEqual(["--model", "opus"]);
  expect(parsed.flags.like).toBe("%a=b%");
  expect(parsed.positionals).toEqual(["create"]);
});
