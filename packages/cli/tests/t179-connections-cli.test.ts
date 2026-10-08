import { expect, test, vi } from "vite-plus/test";
import { main } from "../src/bin.ts";
import { runConnections, type ConnectionsDeps } from "../src/connections.ts";

interface Call {
  method: string;
  url: string;
}

function harness(respond: (call: Call) => Response): {
  deps: ConnectionsDeps;
  printed: string[];
  calls: Call[];
} {
  const printed: string[] = [];
  const calls: Call[] = [];
  const deps: ConnectionsDeps = {
    fetchFn: (async (input: string | URL, init?: RequestInit) => {
      const call: Call = { method: init?.method ?? "GET", url: String(input) };
      calls.push(call);
      expect(new Headers(init?.headers).get("authorization")).toBe("Bearer tok");
      return respond(call);
    }) as unknown as typeof fetch,
    print: (line) => printed.push(line),
  };
  return { deps, printed, calls };
}

const BASE = { baseUrl: "http://h", token: "tok" };

const FLEET = {
  generatedAt: "2026-10-08T10:00:00.000Z",
  connections: [
    {
      kind: "hooks",
      agent: "claude",
      label: "Claude Code",
      enabled: true,
      subId: "abc",
      subscription: { id: "abc", name: "Family alerts", chatJid: null },
    },
    {
      kind: "hooks",
      agent: "codex",
      label: "Codex",
      enabled: false,
      subId: "zzz",
      subscription: null,
    },
    {
      kind: "mcp",
      agent: "cursor",
      label: "Cursor",
      enabled: true,
      subId: null,
      subscription: null,
    },
  ],
};

test("T179 D list — table with agent, kind, status, subscription", async () => {
  const { deps, printed, calls } = harness(() => Response.json(FLEET));
  expect(await runConnections(deps, { ...BASE, action: "list" })).toBe(0);
  expect(calls).toEqual([{ method: "GET", url: "http://h/api/connections" }]);
  expect(printed[0]).toMatch(/^AGENT\s+KIND\s+STATUS\s+SUBSCRIPTION$/);
  expect(printed[1]).toMatch(/^Claude Code\s+hooks\s+enabled\s+Family alerts \(abc\)$/);
  expect(printed[2]).toMatch(/^Codex\s+hooks\s+disabled\s+zzz \(missing\)$/);
  expect(printed[3]).toMatch(/^Cursor\s+mcp\s+enabled\s+—$/);
  expect(printed[4]).toBe(
    "3 connections — disconnect with: wa-mcp connections disconnect <kind> <agent>",
  );
});

test("T179 D list — empty fleet points at subscriptions", async () => {
  const { deps, printed } = harness(() => Response.json({ connections: [], generatedAt: "" }));
  expect(await runConnections(deps, { ...BASE, action: "list" })).toBe(0);
  expect(printed).toEqual([
    "no agents connected — run `wa-mcp install --target <agent>` or `wa-mcp install --hooks claude --sub <id>`",
  ]);
});

test("T179 D disconnect — DELETE /api/connections/:kind/:agent, optional --sub", async () => {
  const { deps, printed, calls } = harness(() => Response.json({ ok: true, removed: 1 }));
  expect(
    await runConnections(deps, { ...BASE, action: "disconnect", kind: "mcp", agent: "cursor" }),
  ).toBe(0);
  expect(
    await runConnections(deps, {
      ...BASE,
      action: "disconnect",
      kind: "hooks",
      agent: "claude",
      sub: "abc",
    }),
  ).toBe(0);
  expect(calls).toEqual([
    { method: "DELETE", url: "http://h/api/connections/mcp/cursor" },
    { method: "DELETE", url: "http://h/api/connections/hooks/claude?sub=abc" },
  ]);
  expect(printed).toEqual([
    "disconnected cursor (mcp) — removed 1 entry",
    "disconnected claude (hooks) — removed 1 entry",
  ]);
});

test("T179 D disconnect — 404 and missing args fail with a message", async () => {
  const { deps, printed } = harness(() =>
    Response.json(
      { ok: false, error: { code: "NOT_FOUND", message: "cursor has no wa-mcp mcp connection" } },
      { status: 404 },
    ),
  );
  expect(
    await runConnections(deps, { ...BASE, action: "disconnect", kind: "mcp", agent: "cursor" }),
  ).toBe(1);
  expect(await runConnections(deps, { ...BASE, action: "disconnect", kind: "mcp" })).toBe(1);
  expect(await runConnections(deps, { ...BASE, action: "bogus" })).toBe(1);
  expect(printed).toEqual([
    "connections failed: HTTP 404 — cursor has no wa-mcp mcp connection",
    "connections disconnect <hooks|mcp> <agent> [--sub <id>]",
    "connections: unknown action 'bogus' — use list or disconnect",
  ]);
});

test("T179 D bin — `connections` is routed and documented in usage", async () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((async () =>
      Response.json({ ok: true, removed: 1 })) as unknown as typeof fetch);
  const previousExit = process.exitCode;
  try {
    await main([
      "connections",
      "disconnect",
      "hooks",
      "codex",
      "--sub",
      "zzz",
      "--token",
      "tok",
      "--bridge-url",
      "http://h",
    ]);
    expect(fetchSpy.mock.calls[0]?.[0]).toBe("http://h/api/connections/hooks/codex?sub=zzz");
    logSpy.mockClear();
    await main([]);
    const usage = logSpy.mock.calls.flat().join("\n");
    expect(usage).toContain(
      "connections | connections disconnect <hooks|mcp> <agent> [--sub <id>]",
    );
  } finally {
    process.exitCode = previousExit;
    logSpy.mockRestore();
    fetchSpy.mockRestore();
  }
});
