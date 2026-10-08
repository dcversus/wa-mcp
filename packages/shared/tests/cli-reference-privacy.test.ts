import { expect, test } from "vite-plus/test";
import { CLI_COMMANDS, CLI_GLOBAL_FLAGS, cliUsageLines } from "../src/cli-reference.ts";
import {
  PRIVACY_LABELS,
  PRIVACY_READ_TO_WRITE,
  PRIVACY_SETTINGS,
  buildPrivacyPatch,
  privacyOptionsFor,
} from "../src/privacy.ts";

test("T182 — command names are unique and every web link is a hash route", () => {
  const names = CLI_COMMANDS.map((command) => command.name);
  expect(new Set(names).size).toBe(names.length);
  for (const command of CLI_COMMANDS) {
    expect(command.usage.startsWith(command.name), command.name).toBe(true);
    if (command.web !== undefined) {
      expect(command.web, command.name).toMatch(/^#\/[a-z]+$/);
    }
  }
});

test("T182 — usage lines: header with every command, global flags, one line per command", () => {
  const lines = cliUsageLines();
  expect(lines[0]).toBe(
    `wa-mcp — usage: wa-mcp <${CLI_COMMANDS.map((c) => c.name).join("|")}> [command flags]`,
  );
  expect(lines[1]).toBe(`  global flags: ${CLI_GLOBAL_FLAGS}`);
  expect(lines.slice(2)).toEqual(CLI_COMMANDS.map((c) => `  ${c.usage} — ${c.summary}`));
});

test("T182 — privacy: every setting maps to a write key, options and labels", () => {
  for (const setting of PRIVACY_SETTINGS) {
    expect(PRIVACY_READ_TO_WRITE[setting.key], setting.key).toBeDefined();
    for (const value of privacyOptionsFor(setting.key)) {
      expect(PRIVACY_LABELS[value], `${setting.key}=${value}`).toBeDefined();
    }
  }
  expect(buildPrivacyPatch("last", "contacts")).toEqual({ lastSeen: "contacts" });
  expect(() => buildPrivacyPatch("nope", "all")).toThrow("unknown privacy key: nope");
  expect(privacyOptionsFor("nope")).toEqual(["all"]);
});
