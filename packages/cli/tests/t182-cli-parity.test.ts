import { readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { CLI_COMMANDS, cliUsageLines } from "@wa-mcp/shared";
import { main } from "../src/bin.ts";
import { parseArgs } from "../src/commands.ts";
import {
  runChats,
  runMedia,
  runPairResume,
  runProfile,
  runSend,
  runUnlink,
  todayStatsLine,
  type WhatsAppArgs,
  type WhatsAppDeps,
} from "../src/whatsapp.ts";

const SRC = join(import.meta.dirname, "../src");

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function harness(respond: (call: Call) => Response = () => Response.json({})): {
  deps: WhatsAppDeps;
  printed: string[];
  calls: Call[];
} {
  const printed: string[] = [];
  const calls: Call[] = [];
  return {
    printed,
    calls,
    deps: {
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
    },
  };
}

function args(argv: string[]): WhatsAppArgs {
  const parsed = parseArgs(["x", ...argv]);
  return {
    baseUrl: "http://h",
    token: "tok",
    positionals: parsed.positionals,
    flags: parsed.flags,
  };
}

test("T182 drift — every command bin.ts dispatches has a CLI reference entry, and vice versa", () => {
  const bin = readFileSync(join(SRC, "bin.ts"), "utf8");
  const dispatched = new Set(
    [...bin.matchAll(/command === "([a-z-]+)"/g)].map((match) => match[1]),
  );
  expect([...dispatched].sort((a, b) => (a ?? "").localeCompare(b ?? ""))).toEqual(
    CLI_COMMANDS.map((command) => command.name).sort((a, b) => a.localeCompare(b)),
  );
});

test("T182 drift — declared actions are dispatched by the command's module and named in its usage", () => {
  const modules: Record<string, string> = {
    contacts: "contacts.ts",
    subs: "subs.ts",
    connections: "connections.ts",
    settings: "settings.ts",
    profile: "whatsapp.ts",
    media: "whatsapp.ts",
    voice: "voice-dictation.ts",
  };
  for (const command of CLI_COMMANDS.filter((entry) => entry.actions !== undefined)) {
    const file = modules[command.name];
    expect(file, command.name).toBeDefined();
    const source = readFileSync(join(SRC, file as string), "utf8");
    for (const action of command.actions ?? []) {
      expect(source, `${command.name} ${action}`).toContain(`"${action}"`);
      if (action !== "list" && action !== "show" && action !== "get") {
        expect(command.usage, `${command.name} ${action}`).toContain(`${command.name} ${action}`);
      }
    }
  }
});

test("T182 drift — `wa-mcp` with no command prints exactly the shared reference", async () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  try {
    await main([]);
    expect(logSpy.mock.calls.map((call) => call.join(" "))).toEqual(cliUsageLines());
  } finally {
    logSpy.mockRestore();
  }
});

test("T182 B chats — table, --q filters by name or jid, --limit passes through", async () => {
  const { deps, printed, calls } = harness(() =>
    Response.json({
      chats: [
        { jid: "120363428874442773@g.us", name: "Team", unreadCount: 3, archived: false },
        { jid: "358401112222@s.whatsapp.net", name: "Dana", unreadCount: 0, archived: false },
        { jid: "358401113333@s.whatsapp.net", name: null, unreadCount: 1, archived: true },
      ],
    }),
  );
  expect(await runChats(deps, args(["--limit", "50"]))).toBe(0);
  expect(calls[0]?.url).toBe("http://h/api/chats?limit=50&include_last_message=false");
  expect(printed[0]).toMatch(/^NAME\s+JID\s+UNREAD$/);
  expect(printed[1]).toMatch(/^Team\s+120363428874442773@g\.us\s+3$/);
  expect(printed[3]).toMatch(/^358401113333\s+358401113333@s\.whatsapp\.net\s+1 \(archived\)$/);
  expect(printed[4]).toBe("3 chats");
  printed.length = 0;
  expect(await runChats(deps, args(["--q", "dan"]))).toBe(0);
  expect(printed.slice(1)).toEqual([expect.stringMatching(/^Dana\s+/), "1 chat"]);
  printed.length = 0;
  await runChats(deps, args(["--q", "zzz"]));
  expect(printed).toEqual(["no chats match 'zzz'"]);
  const empty = harness(() => Response.json({ chats: [] }));
  await runChats(empty.deps, args([]));
  expect(empty.printed).toEqual(["no chats yet — link WhatsApp first: wa-mcp pair"]);
});

test("T182 B send — POST /api/send with reply-to; limit refusals show the retry time", async () => {
  const { deps, printed, calls } = harness(() => Response.json({ message_id: "M1" }));
  expect(
    await runSend(deps, args(["--chat", "+358 40 111 2222", "--text", "hi", "--reply-to", "Q1"])),
  ).toBe(0);
  expect(calls[0]).toEqual({
    method: "POST",
    url: "http://h/api/send",
    body: { chat_jid: "+358 40 111 2222", text: "hi", reply_to_message_id: "Q1" },
  });
  expect(printed).toEqual(["sent M1 to +358 40 111 2222"]);
  const limited = harness(
    () =>
      new Response(
        JSON.stringify({
          error: { code: "SEND_LIMIT_REACHED", message: "daily send limit reached (500)" },
        }),
        { status: 429, headers: { "retry-after": "120", "content-type": "application/json" } },
      ),
  );
  expect(await runSend(limited.deps, args(["--chat", "x@s.whatsapp.net", "--text", "hi"]))).toBe(1);
  expect(limited.printed).toEqual([
    "send failed: HTTP 429 — daily send limit reached (500) — retry in 120s",
  ]);
  const bare = harness();
  expect(await runSend(bare.deps, args(["--text", "hi"]))).toBe(1);
  expect(bare.printed).toEqual(["send --chat <jid|phone> --text <text> [--reply-to <message-id>]"]);
  expect(bare.calls).toEqual([]);
});

test("T182 B media — download and transcribe", async () => {
  const { deps, printed, calls } = harness((call) =>
    call.url.endsWith("/api/transcribe")
      ? Response.json({ text: "see you at five", engine: "whisper" })
      : Response.json({ name: "M1.ogg", mime: "audio/ogg", size: 2048 }),
  );
  expect(await runMedia(deps, args(["download", "M1"]))).toBe(0);
  expect(await runMedia(deps, args(["transcribe", "M1"]))).toBe(0);
  expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
    "POST http://h/api/media/M1",
    "POST http://h/api/transcribe",
  ]);
  expect(calls[1]?.body).toEqual({ message_id: "M1" });
  expect(printed).toEqual(["saved M1.ogg (audio/ogg, 2 KB)", "see you at five"]);
  const bad = harness();
  expect(await runMedia(bad.deps, args(["download"]))).toBe(1);
  expect(await runMedia(bad.deps, args(["bogus", "M1"]))).toBe(1);
  expect(bad.printed).toEqual([
    "media download <message-id>",
    "media: unknown action 'bogus' — use download or transcribe",
  ]);
});

test("T182 B profile — show: name, phone, about, privacy with WhatsApp labels, blocked count", async () => {
  const { deps, printed } = harness((call) => {
    if (call.url.endsWith("/api/me")) {
      return Response.json({ name: "Vasilisa", pn: "358497773518", status: null });
    }
    if (call.url.endsWith("/api/privacy")) {
      return Response.json({ privacy: { last: "contacts", groupadd: "contact_blacklist" } });
    }
    return Response.json({ blocklist: ["1@s.whatsapp.net", "2@s.whatsapp.net"] });
  });
  expect(await runProfile(deps, args([]))).toBe(0);
  expect(printed).toEqual([
    "name: Vasilisa",
    "phone: +358497773518",
    "about: —",
    "privacy:",
    "  Last seen: My contacts",
    "  Online: —",
    "  Profile photo: —",
    "  About: —",
    "  Who can add me to groups: My contacts except…",
    "  Who can call me: —",
    "  Who can message me: —",
    "  Read receipts: —",
    "blocked: 2 (wa-mcp profile blocked)",
  ]);
});

test("T182 B profile — name, about, privacy, blocked, block and unblock", async () => {
  const { deps, printed, calls } = harness((call) =>
    call.url.endsWith("/api/blocklist")
      ? Response.json({ blocklist: ["447700900123@s.whatsapp.net"] })
      : Response.json({ ok: true }),
  );
  await runProfile(deps, args(["name", "Vasilisa", "Versus"]));
  await runProfile(deps, args(["about", "On a break"]));
  await runProfile(deps, args(["privacy", "last", "contacts"]));
  await runProfile(deps, args(["blocked"]));
  await runProfile(deps, args(["block", "+44 7700 900123"]));
  await runProfile(deps, args(["unblock", "447700900123@s.whatsapp.net"]));
  expect(calls.map((call) => [call.method, call.url.slice("http://h".length), call.body])).toEqual([
    ["POST", "/api/profile", { name: "Vasilisa Versus" }],
    ["POST", "/api/profile", { status: "On a break" }],
    ["POST", "/api/privacy", { lastSeen: "contacts" }],
    ["GET", "/api/blocklist", undefined],
    ["POST", "/api/block", { jid: "447700900123@s.whatsapp.net", block: true }],
    ["POST", "/api/block", { jid: "447700900123@s.whatsapp.net", block: false }],
  ]);
  expect(printed).toEqual([
    "name saved: Vasilisa Versus",
    "about saved: On a break",
    "privacy: Last seen → My contacts",
    "447700900123@s.whatsapp.net",
    "blocked 447700900123@s.whatsapp.net",
    "unblocked 447700900123@s.whatsapp.net",
  ]);
});

test("T182 B profile — usage errors never reach the bridge", async () => {
  const { deps, printed, calls } = harness();
  expect(await runProfile(deps, args(["name"]))).toBe(1);
  expect(await runProfile(deps, args(["privacy", "nope", "all"]))).toBe(1);
  expect(await runProfile(deps, args(["privacy", "calladd", "contacts"]))).toBe(1);
  expect(await runProfile(deps, args(["block", "not a number"]))).toBe(1);
  expect(await runProfile(deps, args(["bogus"]))).toBe(1);
  expect(calls).toEqual([]);
  expect(printed).toEqual([
    "profile name <name>",
    "profile privacy: unknown setting 'nope' — use last, online, profile, status, groupadd, calladd, messages or readreceipts",
    "profile privacy calladd: value must be all or known",
    "profile block: 'not a number' is not a phone number or WhatsApp id",
    "profile: unknown action 'bogus' — use show, name, about, privacy, blocked, block or unblock",
  ]);
  const empty = harness(() => Response.json({ blocklist: [] }));
  await runProfile(empty.deps, args(["blocked"]));
  expect(empty.printed).toEqual(["no blocked contacts"]);
});

test("T182 B unlink needs --yes; pair --resume; status stats line", async () => {
  const { deps, printed, calls } = harness((call) =>
    call.url.endsWith("/api/pair/resume")
      ? Response.json({ resumed: true, pairingAttempts: { used: 0, limit: 3 } })
      : Response.json({ ok: true, status: "logged-out" }),
  );
  expect(await runUnlink(deps, args([]))).toBe(1);
  expect(calls).toEqual([]);
  expect(await runUnlink(deps, args(["--yes"]))).toBe(0);
  expect(await runPairResume(deps, args([]))).toBe(0);
  expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
    "POST http://h/api/logout",
    "POST http://h/api/pair/resume",
  ]);
  expect(printed).toEqual([
    "unlink signs this computer out of WhatsApp — run again with --yes to confirm",
    "unlinked — link again with: wa-mcp pair",
    "pairing resumed (0/3 attempts used) — run: wa-mcp pair",
  ]);
  expect(todayStatsLine({ sentToday: 12, receivedToday: 340, reconnects: 2 })).toBe(
    "today: 12 sent · 340 received · 2 reconnects",
  );
});

test("T182 bin — chats, send, media, profile, unlink and pair --resume are routed", async () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((async () =>
    Response.json({
      chats: [],
      resumed: true,
      pairingAttempts: { used: 0, limit: 3 },
    })) as unknown as typeof fetch);
  const previousExit = process.exitCode;
  try {
    const common = ["--token", "tok", "--bridge-url", "http://h"];
    await main(["chats", ...common]);
    await main(["profile", "blocked", ...common]);
    await main(["media", "download", "M1", ...common]);
    await main(["send", "--chat", "a@s.whatsapp.net", "--text", "hi", ...common]);
    await main(["unlink", "--yes", ...common]);
    await main(["pair", "--resume", ...common]);
    expect(fetchSpy.mock.calls.map((call) => call[0] as string)).toEqual([
      "http://h/api/chats?include_last_message=false",
      "http://h/api/blocklist",
      "http://h/api/media/M1",
      "http://h/api/send",
      "http://h/api/logout",
      "http://h/api/pair/resume",
    ]);
  } finally {
    process.exitCode = previousExit;
    logSpy.mockRestore();
    fetchSpy.mockRestore();
  }
});

test("T182 bin — status adds today's stats when a token is available", async () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const fetchSpy = vi.spyOn(globalThis, "fetch").mockImplementation((async (input: string) =>
    String(input).endsWith("/health")
      ? Response.json({ connected: true, loggedIn: true, version: "0.1.0", uptime: 60 })
      : Response.json({
          sentToday: 1,
          receivedToday: 2,
          reconnects: 0,
        })) as unknown as typeof fetch);
  try {
    await main(["status", "--token", "tok", "--bridge-url", "http://h"]);
    expect(logSpy.mock.calls.map((call) => call.join(" "))).toEqual([
      "bridge connected | loggedIn=true | v0.1.0 | uptime 60s",
      "today: 1 sent · 2 received · 0 reconnects",
    ]);
  } finally {
    logSpy.mockRestore();
    fetchSpy.mockRestore();
  }
});

test("T182 B messages --around — a message in context, like the web chat view", async () => {
  const { runMessages } = await import("../src/messages.ts");
  const printed: string[] = [];
  const urls: string[] = [];
  const row = (id: string, text: string) => ({
    id,
    chatJid: "358401112222@s.whatsapp.net",
    senderJid: "358401112222@s.whatsapp.net",
    senderName: "Dana",
    timestamp: `2026-10-08T10:0${id.slice(1)}:00.000Z`,
    content: text,
    mediaType: null,
    isFromMe: false,
  });
  const exit = await runMessages(
    {
      fetchFn: (async (input: string) => {
        urls.push(input);
        return input.includes("/api/context")
          ? Response.json({
              messages: [row("M1", "before"), row("M2", "target"), row("M3", "after")],
            })
          : Response.json({ chats: [] });
      }) as unknown as typeof fetch,
      print: (line) => printed.push(line),
      sleep: async () => {},
      keepFollowing: () => false,
    },
    {
      baseUrl: "http://h",
      token: "tok",
      chat: "358401112222@s.whatsapp.net",
      around: "M2",
      limit: 1,
      follow: false,
    },
  );
  expect(exit).toBe(0);
  expect(urls.at(-1)).toBe(
    "http://h/api/context?chat_jid=358401112222%40s.whatsapp.net&message_id=M2&radius=1",
  );
  expect(printed).toHaveLength(4);
  expect(printed[2]).toMatch(/Dana\s+▶ target$/);
  expect(printed[1]).toMatch(/Dana\s+before$/);
});
