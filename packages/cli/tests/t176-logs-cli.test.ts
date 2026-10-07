import { expect, test, vi } from "vite-plus/test";
import { main } from "../src/bin.ts";
import { isMessageLogsInvocation, runLogs, type LogsDeps } from "../src/logs.ts";

const GROUP = "120363428874442773@g.us";
const ALICE = "358401112222@s.whatsapp.net";

interface Harness {
  deps: LogsDeps;
  printed: string[];
  urls: string[];
}

function harness(
  searchPages: Array<Array<Record<string, unknown>>>,
  chats: Array<{ jid: string; name: string | null }> = [{ jid: GROUP, name: "Family" }],
  polls = 0,
): Harness {
  const printed: string[] = [];
  const urls: string[] = [];
  let remainingPolls = polls;
  const deps: LogsDeps = {
    fetchFn: (async (input: string | URL) => {
      const url = String(input);
      urls.push(url);
      if (url.includes("/api/chats")) {
        return Response.json({ chats: url.includes("archived=true") ? [] : chats });
      }
      if (url.includes("/api/search")) {
        return Response.json({ messages: searchPages.shift() ?? [] });
      }
      return new Response("nope", { status: 404 });
    }) as unknown as typeof fetch,
    print: (line) => printed.push(line),
    sleep: async () => {},
    keepFollowing: () => remainingPolls-- > 0,
  };
  return { deps, printed, urls };
}

function row(
  id: string,
  timestamp: string,
  fromMe: boolean,
  content: string,
): Record<string, unknown> {
  return {
    id,
    chatJid: GROUP,
    senderJid: fromMe ? null : ALICE,
    senderName: fromMe ? null : "Alice",
    timestamp,
    content,
    mediaType: null,
    isFromMe: fromMe,
  };
}

function searchUrl(urls: string[], index = 0): URL {
  const hits = urls.filter((url) => url.includes("/api/search"));
  const hit = hits[index];
  if (hit === undefined) throw new Error(`no search call #${index}`);
  return new URL(hit);
}

test("T176 A3 — every flag maps onto the /api/search query string", async () => {
  const { deps, urls } = harness([[]]);
  const exit = await runLogs(deps, {
    baseUrl: "http://127.0.0.1:8080",
    token: "tok",
    chat: GROUP,
    person: ALICE,
    from: "2026-10-01T00:00:00.000Z",
    to: "2026-10-07T00:00:00.000Z",
    direction: "in",
    q: "pizza",
    limit: 25,
    follow: false,
  });
  expect(exit).toBe(0);
  const url = searchUrl(urls);
  expect(url.pathname).toBe("/api/search");
  expect(Object.fromEntries(url.searchParams)).toEqual({
    chat_jid: GROUP,
    from_jid: ALICE,
    since: "2026-10-01T00:00:00.000Z",
    until: "2026-10-07T00:00:00.000Z",
    direction: "in",
    q: "pizza",
    limit: "25",
  });
});

test("T176 A3 — --chat accepts a chat name and resolves it to the jid", async () => {
  const { deps, urls } = harness([[]]);
  await runLogs(deps, { baseUrl: "http://h", token: "t", chat: "family", follow: false });
  expect(searchUrl(urls).searchParams.get("chat_jid")).toBe(GROUP);
});

test("T176 A3 — unknown chat name and bad direction fail before searching", async () => {
  const unknown = harness([[]]);
  expect(
    await runLogs(unknown.deps, { baseUrl: "http://h", token: "t", chat: "nobody", follow: false }),
  ).toBe(1);
  expect(unknown.printed.join("\n")).toContain("no chat named 'nobody'");
  expect(unknown.urls.some((url) => url.includes("/api/search"))).toBe(false);
  const bad = harness([[]]);
  expect(
    await runLogs(bad.deps, {
      baseUrl: "http://h",
      token: "t",
      direction: "up" as "in",
      follow: false,
    }),
  ).toBe(1);
  expect(bad.printed.join("\n")).toContain("--direction must be in or out");
});

test("T176 A3 — table output: header + one row per message, oldest first, names resolved", async () => {
  const { deps, printed } = harness([
    [
      row("M2", "2026-10-07T10:01:00.000Z", true, "on my way"),
      row("M1", "2026-10-07T10:00:00.000Z", false, "where are you?\nline two"),
    ],
  ]);
  const exit = await runLogs(deps, { baseUrl: "http://h", token: "t", follow: false });
  expect(exit).toBe(0);
  expect(printed).toHaveLength(3);
  const [header, first, second] = printed as [string, string, string];
  expect(header.split(/\s{2,}/)).toEqual(["TIME", "DIR", "CHAT", "FROM", "TEXT"]);
  expect(first.split(/\s{2,}/)).toEqual([
    "2026-10-07T10:00:00.000Z",
    "in",
    "Family",
    "Alice",
    "where are you? line two",
  ]);
  expect(second.split(/\s{2,}/)).toEqual([
    "2026-10-07T10:01:00.000Z",
    "out",
    "Family",
    "me",
    "on my way",
  ]);
});

test("T176 A3 — empty result prints a friendly line", async () => {
  const { deps, printed } = harness([[]]);
  await runLogs(deps, { baseUrl: "http://h", token: "t", follow: false });
  expect(printed).toEqual(["no messages match"]);
});

test("T176 A3 — HTTP errors surface the bridge message and exit 1", async () => {
  const printed: string[] = [];
  const exit = await runLogs(
    {
      fetchFn: (async () =>
        Response.json(
          { error: { code: "VALIDATION_ERROR", message: "direction must be in or out" } },
          { status: 400 },
        )) as unknown as typeof fetch,
      print: (line) => printed.push(line),
      sleep: async () => {},
      keepFollowing: () => false,
    },
    { baseUrl: "http://h", token: "t", follow: false },
  );
  expect(exit).toBe(1);
  expect(printed.join("\n")).toContain("logs failed: HTTP 400 — direction must be in or out");
});

test("T176 A3 — --follow polls with since=<newest> and prints only unseen rows", async () => {
  const { deps, printed, urls } = harness(
    [
      [row("M1", "2026-10-07T10:00:00.000Z", false, "first")],
      [row("M1", "2026-10-07T10:00:00.000Z", false, "first")],
      [
        row("M2", "2026-10-07T10:05:00.000Z", true, "second"),
        row("M1", "2026-10-07T10:00:00.000Z", false, "first"),
      ],
    ],
    undefined,
    2,
  );
  const exit = await runLogs(deps, { baseUrl: "http://h", token: "t", follow: true });
  expect(exit).toBe(0);
  expect(printed.filter((line) => line.startsWith("TIME"))).toHaveLength(1);
  expect(printed.filter((line) => line.includes("first"))).toHaveLength(1);
  expect(printed.filter((line) => line.includes("second"))).toHaveLength(1);
  expect(searchUrl(urls, 1).searchParams.get("since")).toBe("2026-10-07T10:00:00.000Z");
  expect(searchUrl(urls, 2).searchParams.get("since")).toBe("2026-10-07T10:00:00.000Z");
});

test("T176 A3 — bare `logs` stays the daemon tail; any message flag selects message logs", () => {
  expect(isMessageLogsInvocation({}, [])).toBe(false);
  expect(isMessageLogsInvocation({ follow: "" }, [])).toBe(false);
  expect(isMessageLogsInvocation({ daemon: "", chat: GROUP }, [])).toBe(false);
  expect(isMessageLogsInvocation({}, ["messages"])).toBe(true);
  for (const flag of ["chat", "person", "from", "to", "direction", "q", "limit"]) {
    expect(isMessageLogsInvocation({ [flag]: "x" }, [])).toBe(true);
  }
});

test("T176 A3 — bin routes `logs --direction` to message logs and documents the flags", async () => {
  const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
  const fetchSpy = vi
    .spyOn(globalThis, "fetch")
    .mockImplementation((async () => Response.json({ chats: [] })) as unknown as typeof fetch);
  const previousExit = process.exitCode;
  try {
    await main(["logs", "--direction", "sideways", "--token", "tok"]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain("--direction must be in or out");
    expect(process.exitCode).toBe(1);
    logSpy.mockClear();
    await main([]);
    expect(logSpy.mock.calls.flat().join("\n")).toContain(
      "logs [messages] [--chat <jid|name>] [--person <jid>] [--from <date>] [--to <date>] [--direction in|out] [--q <text>] [--limit <n>] [--follow]",
    );
  } finally {
    process.exitCode = previousExit;
    logSpy.mockRestore();
    fetchSpy.mockRestore();
  }
});
