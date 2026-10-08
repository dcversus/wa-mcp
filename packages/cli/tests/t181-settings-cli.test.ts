import { expect, test, vi } from "vite-plus/test";
import { DEFAULT_CONNECTION_SETTINGS } from "@wa-mcp/shared";
import { main } from "../src/bin.ts";
import { parseArgs } from "../src/commands.ts";
import { runSettings, type SettingsDeps } from "../src/settings.ts";

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function harness(respond: (call: Call) => Response): {
  deps: SettingsDeps;
  printed: string[];
  calls: Call[];
} {
  const printed: string[] = [];
  const calls: Call[] = [];
  const deps: SettingsDeps = {
    fetchFn: (async (input: string | URL, init?: RequestInit) => {
      const call: Call = {
        method: init?.method ?? "GET",
        url: String(input),
        body: typeof init?.body === "string" ? JSON.parse(init.body) : undefined,
      };
      calls.push(call);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok");
      return respond(call);
    }) as unknown as typeof fetch,
    print: (line) => printed.push(line),
  };
  return { deps, printed, calls };
}

function run(deps: SettingsDeps, argv: string[]): Promise<number> {
  const parsed = parseArgs(["settings", ...argv]);
  return runSettings(deps, {
    baseUrl: "http://h",
    token: "tok",
    action: parsed.positionals[0] ?? "get",
    flags: parsed.flags,
  });
}

const RECORD = {
  connection: "default",
  settings: DEFAULT_CONNECTION_SETTINGS,
  defaults: DEFAULT_CONNECTION_SETTINGS,
  updatedAt: null,
};

test("T181 E get — prints humanisation and limits in plain words", async () => {
  const { deps, printed, calls } = harness(() => Response.json(RECORD));
  expect(await run(deps, [])).toBe(0);
  expect(calls).toEqual([
    { method: "GET", url: "http://h/api/connection-settings", body: undefined },
  ]);
  expect(printed).toEqual([
    "connection: default (defaults — never changed)",
    "humanisation: off",
    "  delay: 1500–8000 ms, +60 ms per character, ±20% jitter",
    "  typing status: on",
    "send limits: off",
    "  per minute 30 · per hour 120 · per day 500 · per chat per day: no cap",
  ]);
});

test("T181 E set — every flag maps onto the PUT body; prints the saved settings", async () => {
  const saved = {
    ...RECORD,
    updatedAt: "2026-10-08T10:00:00.000Z",
    settings: {
      humanisation: {
        enabled: true,
        minDelayMs: 500,
        maxDelayMs: 4000,
        typingStatus: false,
        delayPerCharMs: 40,
      },
      sendLimits: { enabled: true, perMinute: 10, perHour: 60, perDay: 300, perChatPerDay: 25 },
    },
  };
  const { deps, printed, calls } = harness(() => Response.json(saved));
  expect(
    await run(deps, [
      "set",
      "--humanise",
      "on",
      "--min-delay",
      "500",
      "--max-delay",
      "4000",
      "--per-char",
      "40",
      "--typing",
      "off",
      "--limits",
      "on",
      "--per-minute",
      "10",
      "--per-hour",
      "60",
      "--per-day",
      "300",
      "--per-chat-day",
      "25",
    ]),
  ).toBe(0);
  expect(calls).toEqual([
    {
      method: "PUT",
      url: "http://h/api/connection-settings",
      body: saved.settings,
    },
  ]);
  expect(printed).toEqual([
    "saved",
    "connection: default (updated 2026-10-08T10:00:00.000Z)",
    "humanisation: on",
    "  delay: 500–4000 ms, +40 ms per character, ±20% jitter",
    "  typing status: off",
    "send limits: on",
    "  per minute 10 · per hour 60 · per day 300 · per chat per day 25",
  ]);
});

test("T181 E set — partial flags send only those fields; --per-chat-day off clears the cap", async () => {
  const { deps, calls } = harness(() => Response.json(RECORD));
  await run(deps, ["set", "--humanise", "off"]);
  await run(deps, ["set", "--per-chat-day", "off", "--typing", "on"]);
  expect(calls.map((call) => call.body)).toEqual([
    { humanisation: { enabled: false } },
    { humanisation: { typingStatus: true }, sendLimits: { perChatPerDay: null } },
  ]);
});

test("T181 E set — bad flags are rejected locally; server validation errors are shown", async () => {
  const { deps, printed, calls } = harness(() =>
    Response.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "humanisation.minDelayMs (9000) must not exceed maxDelayMs (8000)",
        },
      },
      { status: 400 },
    ),
  );
  expect(await run(deps, ["set"])).toBe(1);
  expect(await run(deps, ["set", "--humanise", "maybe"])).toBe(1);
  expect(await run(deps, ["set", "--per-day", "lots"])).toBe(1);
  expect(await run(deps, ["set", "--min-delay", "-5"])).toBe(1);
  expect(calls).toEqual([]);
  expect(await run(deps, ["set", "--min-delay", "9000"])).toBe(1);
  expect(await run(deps, ["bogus"])).toBe(1);
  expect(printed).toEqual([
    "settings set: pass at least one of --humanise on|off, --min-delay <ms>, --max-delay <ms>, --per-char <ms>, --typing on|off, --limits on|off, --per-minute <n>, --per-hour <n>, --per-day <n>, --per-chat-day <n|off>",
    "settings set: --humanise must be on or off (got maybe)",
    "settings set: --per-day must be a whole number (got lots)",
    "settings set: --min-delay must be a whole number (got -5)",
    "settings failed: HTTP 400 — humanisation.minDelayMs (9000) must not exceed maxDelayMs (8000)",
    "settings: unknown action 'bogus' — use get or set",
  ]);
});

test("T181 E bin — `settings` is routed and documented in usage", async () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((async () => Response.json(RECORD)) as unknown as typeof fetch);
  const previousExit = process.exitCode;
  try {
    await main(["settings", "--token", "tok", "--bridge-url", "http://h"]);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("http://h/api/connection-settings");
    logSpy.mockClear();
    await main([]);
    const usage = logSpy.mock.calls.flat().join("\n");
    expect(usage).toContain("settings [get] | settings set [--humanise on|off]");
  } finally {
    process.exitCode = previousExit;
    logSpy.mockRestore();
    fetchSpy.mockRestore();
  }
});
