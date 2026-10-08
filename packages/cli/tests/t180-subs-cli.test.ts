import { expect, test, vi } from "vite-plus/test";
import { main } from "../src/bin.ts";
import { parseArgs } from "../src/commands.ts";
import { runSubs, type SubsDeps } from "../src/subs.ts";

const GROUP = "120363428874442773@g.us";
const DM = "358401112222@s.whatsapp.net";

interface Call {
  method: string;
  url: string;
  body: unknown;
}

function harness(respond: (call: Call) => Response = () => Response.json({})): {
  deps: SubsDeps;
  printed: string[];
  calls: Call[];
} {
  const printed: string[] = [];
  const calls: Call[] = [];
  const deps: SubsDeps = {
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

function run(deps: SubsDeps, argv: string[]): Promise<number> {
  const parsed = parseArgs(["subs", ...argv]);
  return runSubs(deps, {
    baseUrl: "http://h",
    token: "tok",
    action: parsed.positionals[0] ?? "list",
    id: parsed.positionals[1],
    flags: parsed.flags,
    lists: parsed.lists,
  });
}

const EXISTING = {
  id: "abc123def456",
  name: "Team",
  chats: [GROUP],
  filter: { like: "%invoice%", mentionOnly: true },
  prompt: "Triage",
  delivery: { mode: "inbox" },
  enabled: true,
  created: "2026-10-08T00:00:00.000Z",
  inboxPath: "/d/subs/abc123def456/inbox.jsonl",
};

test("T180 D list — table with name, id, chats, filter, delivery, status", async () => {
  const { deps, printed, calls } = harness(() =>
    Response.json({
      subscriptions: [
        EXISTING,
        {
          ...EXISTING,
          id: "fff000fff000",
          name: "Everyone",
          chats: ["*"],
          filter: {},
          delivery: { mode: "spawn", agent: { command: "/usr/local/bin/claude", args: ["-p"] } },
          enabled: false,
        },
        {
          ...EXISTING,
          id: "eee000eee000",
          name: "Session",
          chats: [GROUP, DM],
          filter: { mentionOnly: true },
          delivery: { mode: "session" },
        },
      ],
    }),
  );
  expect(await run(deps, ["list"])).toBe(0);
  expect(calls).toEqual([{ method: "GET", url: "http://h/api/subs2", body: undefined }]);
  expect(printed[0]).toMatch(/^NAME\s+ID\s+CHATS\s+FILTER\s+DELIVERY\s+STATUS$/);
  expect(printed[1]).toMatch(
    /^Team\s+abc123def456\s+120363428874442773@g\.us\s+~ %invoice% · mentions only\s+inbox\s+on$/,
  );
  expect(printed[2]).toMatch(
    /^Everyone\s+fff000fff000\s+all chats\s+—\s+spawn: \/usr\/local\/bin\/claude\s+off$/,
  );
  expect(printed[3]).toMatch(
    /^Session\s+eee000eee000\s+2 chats\s+mentions only\s+session: active\s+on$/,
  );
  expect(printed[4]).toBe("3 subscriptions");
});

test("T180 D list — empty explains how to create one", async () => {
  const { deps, printed } = harness(() => Response.json({ subscriptions: [] }));
  expect(await run(deps, [])).toBe(0);
  expect(printed).toEqual([
    "no subscriptions — create one: wa-mcp subs create --name <name> --chat <jid> [--like %text%] [--mention-only] [--prompt <text>] [--delivery inbox|session|spawn]",
  ]);
});

test("T180 D create — inbox: multi --chat, like, mention-only, prompt → POST body; prints the drain help", async () => {
  const { deps, printed, calls } = harness(() => Response.json(EXISTING, { status: 201 }));
  expect(
    await run(deps, [
      "create",
      "--name",
      "Team",
      "--chat",
      GROUP,
      "--chat",
      DM,
      "--like",
      "%invoice%",
      "--mention-only",
      "--prompt",
      "Triage",
    ]),
  ).toBe(0);
  expect(calls[0]).toEqual({
    method: "POST",
    url: "http://h/api/subs2",
    body: {
      name: "Team",
      chats: [GROUP, DM],
      filter: { like: "%invoice%", mentionOnly: true },
      prompt: "Triage",
      delivery: { mode: "inbox" },
      enabled: true,
    },
  });
  expect(printed).toEqual([
    "created Team (abc123def456) — inbox delivery",
    "  inbox: /d/subs/abc123def456/inbox.jsonl",
    "  read new events: wa-mcp inbox drain --inbox /d/subs/abc123def456/inbox.jsonl",
    "  wake Claude Code on new events: wa-mcp install --hooks claude --sub abc123def456",
  ]);
});

test("T180 D create — spawn: --command, repeated --arg (incl. --arg=--flag) and --env K=V", async () => {
  const { deps, calls, printed } = harness(() =>
    Response.json(
      { ...EXISTING, delivery: { mode: "spawn", agent: { command: "claude" } } },
      { status: 201 },
    ),
  );
  expect(
    await run(deps, [
      "create",
      "--name",
      "Bot",
      "--all-chats",
      "--delivery",
      "spawn",
      "--command",
      "claude",
      "--arg",
      "-p",
      "--arg=--model",
      "--arg",
      "opus",
      "--env",
      "ANTHROPIC_MODEL=opus",
      "--env",
      "X=a=b",
    ]),
  ).toBe(0);
  expect(calls[0]?.body).toEqual({
    name: "Bot",
    chats: ["*"],
    filter: {},
    delivery: {
      mode: "spawn",
      agent: {
        command: "claude",
        args: ["-p", "--model", "opus"],
        env: { ANTHROPIC_MODEL: "opus", X: "a=b" },
      },
    },
    enabled: true,
  });
  expect(printed[1]).toBe(
    "  each matching message starts `claude` with the event JSON in $WAMCP_EVENT (prompt in $WAMCP_PROMPT)",
  );
});

test("T180 D create — session: --session picks one; --delivery session alone means the active session", async () => {
  const { deps, calls } = harness(() => Response.json(EXISTING, { status: 201 }));
  await run(deps, ["create", "--name", "S", "--chat", GROUP, "--session", "claude:b41d"]);
  await run(deps, ["create", "--name", "S", "--chat", GROUP, "--delivery", "session"]);
  expect(calls.map((call) => (call.body as { delivery: unknown }).delivery)).toEqual([
    { mode: "session", session: "claude:b41d" },
    { mode: "session" },
  ]);
});

test("T180 D create — invalid input is rejected locally with the validation message", async () => {
  const { deps, printed, calls } = harness();
  expect(await run(deps, ["create", "--chat", GROUP])).toBe(1);
  expect(await run(deps, ["create", "--name", "x"])).toBe(1);
  expect(await run(deps, ["create", "--name", "x", "--chat", GROUP, "--delivery", "spawn"])).toBe(
    1,
  );
  expect(
    await run(deps, ["create", "--name", "x", "--chat", GROUP, "--env", "NOEQ", "--command", "c"]),
  ).toBe(1);
  expect(calls).toEqual([]);
  expect(printed).toEqual([
    "subs create: name is required",
    "subs create: chats must list at least one chat — pass --chat <jid> (repeatable) or --all-chats",
    "subs create: delivery.agent.command is required for spawn",
    "subs create: --env must be NAME=value (got NOEQ)",
  ]);
});

test("T180 D edit — GETs, merges only the given flags, PATCHes", async () => {
  const { deps, calls, printed } = harness((call) =>
    call.method === "GET"
      ? Response.json(EXISTING)
      : Response.json({ ...EXISTING, name: "Renamed" }),
  );
  expect(
    await run(deps, ["edit", "abc123def456", "--name", "Renamed", "--like", "", "--disable"]),
  ).toBe(0);
  expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
    "GET http://h/api/subs2/abc123def456",
    "PATCH http://h/api/subs2/abc123def456",
  ]);
  expect(calls[1]?.body).toEqual({
    name: "Renamed",
    filter: { mentionOnly: true },
    enabled: false,
  });
  expect(printed).toEqual(["updated Renamed (abc123def456)"]);
});

test("T180 D edit — mention-only false and switching delivery to spawn", async () => {
  const { deps, calls } = harness((call) =>
    call.method === "GET" ? Response.json(EXISTING) : Response.json(EXISTING),
  );
  await run(deps, [
    "edit",
    "abc123def456",
    "--mention-only",
    "false",
    "--command",
    "codex",
    "--arg",
    "exec",
  ]);
  expect(calls[1]?.body).toEqual({
    filter: { like: "%invoice%" },
    delivery: { mode: "spawn", agent: { command: "codex", args: ["exec"] } },
  });
});

test("T180 D delete / test / sessions — call shapes and messages", async () => {
  const { deps, calls, printed } = harness((call) => {
    if (call.url.endsWith("/test")) {
      return Response.json({ ok: true, mode: "inbox", inboxPath: "/d/i.jsonl", totalLines: 3 });
    }
    if (call.url.includes("/api/sessions")) {
      return Response.json({
        sessions: [{ id: "claude:b41d", label: "Claude Code · wa-mcp · 2026-10-08 09:00 UTC" }],
      });
    }
    return Response.json({ ok: true, removed: "abc123def456" });
  });
  expect(await run(deps, ["delete", "abc123def456"])).toBe(0);
  expect(await run(deps, ["test", "abc123def456"])).toBe(0);
  expect(await run(deps, ["sessions"])).toBe(0);
  expect(calls.map((call) => `${call.method} ${call.url}`)).toEqual([
    "DELETE http://h/api/subs2/abc123def456",
    "POST http://h/api/subs2/abc123def456/test",
    "GET http://h/api/sessions",
  ]);
  expect(printed).toEqual([
    "deleted abc123def456",
    "test event delivered (inbox) → /d/i.jsonl (3 lines)",
    "claude:b41d  Claude Code · wa-mcp · 2026-10-08 09:00 UTC",
  ]);
});

test("T180 D errors — missing id, unknown action, HTTP failure", async () => {
  const { deps, printed } = harness(() =>
    Response.json({ error: { message: "unknown subscription" } }, { status: 404 }),
  );
  expect(await run(deps, ["delete"])).toBe(1);
  expect(await run(deps, ["bogus"])).toBe(1);
  expect(await run(deps, ["delete", "nope"])).toBe(1);
  expect(printed).toEqual([
    "subs delete <id>",
    "subs: unknown action 'bogus' — use list, create, edit, delete, test or sessions",
    "subs failed: HTTP 404 — unknown subscription",
  ]);
});

test("T180 D bin — `subs` is routed and documented in usage", async () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((async () =>
      Response.json({ subscriptions: [] })) as unknown as typeof fetch);
  const previousExit = process.exitCode;
  try {
    await main(["subs", "--token", "tok", "--bridge-url", "http://h"]);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("http://h/api/subs2");
    logSpy.mockClear();
    await main([]);
    const usage = logSpy.mock.calls.flat().join("\n");
    expect(usage).toContain("subs [list] | subs create --name <n> (--chat <jid>… | --all-chats)");
  } finally {
    process.exitCode = previousExit;
    logSpy.mockRestore();
    fetchSpy.mockRestore();
  }
});
