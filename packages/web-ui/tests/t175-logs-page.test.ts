import { expect, test } from "vite-plus/test";
import {
  EMPTY_LOG_FILTER,
  logsPageHtml,
  logsQuery,
  matchesLogFilter,
  rowsFromUpsert,
  type LogFilter,
  type LogRow,
} from "../src/logs.ts";
import { renderFrame, ROUTES, type AppDom } from "../src/app.ts";
import { navHtml } from "../src/pages.ts";
import { createApiClient } from "../src/api.ts";
import { openStatusStream } from "../src/events-feed.ts";

const GROUP = "120363428874442773@g.us";
const ALICE = "358401112222@s.whatsapp.net";
const NOW = Date.parse("2026-10-07T12:00:00.000Z");

const ROWS: LogRow[] = [
  {
    id: "M2",
    chatJid: GROUP,
    senderJid: null,
    senderName: null,
    timestamp: "2026-10-07T11:00:00.000Z",
    content: "on my way",
    mediaType: null,
    isFromMe: true,
  },
  {
    id: "M1",
    chatJid: GROUP,
    senderJid: ALICE,
    senderName: "alice-push",
    timestamp: "2026-10-07T10:00:00.000Z",
    content: "<b>where</b> are you?",
    mediaType: null,
    isFromMe: false,
  },
];

const resolveName = (jid: string): string | null =>
  jid === GROUP ? "Family" : jid === ALICE ? "Alice" : null;

function filter(patch: Partial<LogFilter>): LogFilter {
  return { ...EMPTY_LOG_FILTER, ...patch };
}

test("T175 A2 — logsQuery maps every filter + page onto /api/search params", () => {
  const query = new URLSearchParams(
    logsQuery(
      filter({
        chat: GROUP,
        person: ALICE,
        direction: "in",
        since: "2026-10-07T10:00",
        until: "2026-10-07T18:30",
        q: "pizza",
      }),
      2,
      50,
    ),
  );
  expect(Object.fromEntries(query)).toEqual({
    chat_jid: GROUP,
    from_jid: ALICE,
    direction: "in",
    since: new Date("2026-10-07T10:00").toISOString(),
    until: new Date("2026-10-07T18:30").toISOString(),
    q: "pizza",
    limit: "51",
    offset: "100",
  });
  expect(logsQuery(EMPTY_LOG_FILTER, 0, 50)).toBe("limit=51&offset=0");
});

test("T175 A2 — matchesLogFilter applies the same predicates client-side", () => {
  const [out, inbound] = ROWS as [LogRow, LogRow];
  expect(matchesLogFilter(inbound, EMPTY_LOG_FILTER)).toBe(true);
  expect(matchesLogFilter(inbound, filter({ direction: "in" }))).toBe(true);
  expect(matchesLogFilter(out, filter({ direction: "in" }))).toBe(false);
  expect(matchesLogFilter(inbound, filter({ chat: "other@g.us" }))).toBe(false);
  expect(matchesLogFilter(inbound, filter({ person: ALICE }))).toBe(true);
  expect(matchesLogFilter(out, filter({ person: ALICE }))).toBe(false);
  expect(matchesLogFilter(inbound, filter({ q: "WHERE" }))).toBe(true);
  expect(matchesLogFilter(inbound, filter({ q: "pizza" }))).toBe(false);
  const at = Date.parse(inbound.timestamp);
  expect(matchesLogFilter(inbound, filter({ since: localInput(at + 60_000) }))).toBe(false);
  expect(matchesLogFilter(inbound, filter({ since: localInput(at - 60_000) }))).toBe(true);
  expect(matchesLogFilter(inbound, filter({ until: localInput(at - 60_000) }))).toBe(false);
  expect(matchesLogFilter(inbound, filter({ until: localInput(at + 60_000) }))).toBe(true);
});

function localInput(ms: number): string {
  const date = new Date(ms);
  const pad = (value: number): string => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

test("T175 A2 — rowsFromUpsert turns an SSE messages.upsert into log rows", () => {
  const rows = rowsFromUpsert({
    type: "messages.upsert",
    payload: {
      messages: [
        {
          key: { remoteJid: GROUP, fromMe: false, id: "L1", participant: ALICE },
          message: { conversation: "live hello" },
          messageTimestamp: 1791345600,
          pushName: "Alice P",
        },
        {
          key: { remoteJid: GROUP, fromMe: true, id: "L2" },
          message: { extendedTextMessage: { text: "live reply" } },
          messageTimestamp: "1791345660",
        },
      ],
    },
  });
  expect(rows).toEqual([
    {
      id: "L1",
      chatJid: GROUP,
      senderJid: ALICE,
      senderName: "Alice P",
      timestamp: new Date(1791345600 * 1000).toISOString(),
      content: "live hello",
      mediaType: null,
      isFromMe: false,
    },
    {
      id: "L2",
      chatJid: GROUP,
      senderJid: null,
      senderName: null,
      timestamp: new Date(1791345660 * 1000).toISOString(),
      content: "live reply",
      mediaType: null,
      isFromMe: true,
    },
  ]);
  expect(rowsFromUpsert({ type: "presence.update", payload: {} })).toEqual([]);
});

test("T175 A2 — table renders time (relative + absolute title), direction badge, names, escaped snippet", () => {
  const html = logsPageHtml({
    rows: ROWS,
    filter: EMPTY_LOG_FILTER,
    page: 0,
    hasMore: false,
    live: false,
    chats: [{ jid: GROUP, name: "Family" }],
    people: [{ jid: ALICE, name: "Alice" }],
    resolveName,
    now: NOW,
  });
  expect(html).toContain('id="logs-page"');
  expect(html).toContain("<h1>Logs</h1>");
  expect(html).toContain('<table class="logs-table">');
  expect(html).toContain(
    `<time datetime="2026-10-07T10:00:00.000Z" title="${new Date("2026-10-07T10:00:00.000Z").toLocaleString()}">2 h 0 m ago</time>`,
  );
  expect(html).toMatch(
    /<span class="dir-badge dir-in"><svg class="icon"[^>]*>.*?<\/svg>in<\/span>/,
  );
  expect(html).toMatch(
    /<span class="dir-badge dir-out"><svg class="icon"[^>]*>.*?<\/svg>out<\/span>/,
  );
  expect(html).toContain(`<td><a href="#/chat/${encodeURIComponent(GROUP)}">Family</a></td>`);
  expect(html).toContain("<td>Alice</td>");
  expect(html).toContain("<td>You</td>");
  expect(html).toContain("&lt;b&gt;where&lt;/b&gt; are you?");
  expect(html).not.toContain("<b>where</b>");
  expect(html.indexOf("on my way")).toBeLessThan(html.indexOf("are you?"));
});

test("T175 A2 — filter bar: chat + person pickers, direction select, datetime range, free text", () => {
  const html = logsPageHtml({
    rows: [],
    filter: filter({
      chat: GROUP,
      person: ALICE,
      direction: "out",
      since: "2026-10-01T09:00",
      q: "a&b",
    }),
    page: 0,
    hasMore: false,
    live: false,
    chats: [{ jid: GROUP, name: "Family" }],
    people: [{ jid: ALICE, name: "Alice" }],
    resolveName,
    now: NOW,
  });
  expect(html).toContain('<form id="logs-filter"');
  expect(html).toContain(`<option value="${GROUP}" selected>Family</option>`);
  expect(html).toContain(`<option value="${ALICE}" selected>Alice</option>`);
  expect(html).toContain('<option value="out" selected>Outgoing</option>');
  expect(html).toContain(
    '<input type="datetime-local" id="logs-since" name="since" value="2026-10-01T09:00"',
  );
  expect(html).toContain('<input type="datetime-local" id="logs-until" name="until" value=""');
  expect(html).toContain('id="logs-q" name="q" value="a&amp;b"');
  expect(html).toContain("No messages match these filters");
});

test("T175 A2 — pagination buttons and live-tail toggle reflect state", () => {
  const base = {
    rows: ROWS,
    filter: EMPTY_LOG_FILTER,
    chats: [],
    people: [],
    resolveName,
    now: NOW,
  };
  const first = logsPageHtml({ ...base, page: 0, hasMore: true, live: false });
  expect(first).toContain('<button type="button" id="logs-prev" disabled>');
  expect(first).toContain('<button type="button" id="logs-next">');
  expect(first).toContain("Page 1");
  expect(first).toContain('<input type="checkbox" id="logs-live" />');
  const later = logsPageHtml({ ...base, page: 3, hasMore: false, live: true });
  expect(later).toContain('<button type="button" id="logs-prev">');
  expect(later).toContain('<button type="button" id="logs-next" disabled>');
  expect(later).toContain("Page 4");
  expect(later).toContain('<input type="checkbox" id="logs-live" checked />');
});

test("T175 A2 — api client searchLogs hits /api/search with the composed query", async () => {
  const calls: string[] = [];
  const client = createApiClient({
    baseUrl: "http://bridge",
    token: "tok",
    fetchFn: (async (url: string | URL) => {
      calls.push(String(url));
      return Response.json({ messages: [] });
    }) as unknown as typeof fetch,
    onUnauthorized: () => {},
  });
  await client.searchLogs("direction=in&limit=51&offset=0");
  expect(calls).toEqual(["http://bridge/api/search?direction=in&limit=51&offset=0"]);
});

test("T175 A2 — openStatusStream hands the parsed raw frame to onRaw (live tail feed)", () => {
  const raws: unknown[] = [];
  const sources: Array<{ onmessage: ((e: { data: string }) => void) | null }> = [];
  class FakeEventSource {
    public onmessage: ((e: { data: string }) => void) | null = null;
    constructor() {
      sources.push(this);
    }
    close(): void {}
  }
  openStatusStream({
    url: "http://bridge",
    token: "tok",
    EventSourceImpl: FakeEventSource as unknown as typeof EventSource,
    onLine: () => {},
    onRaw: (raw) => raws.push(raw),
  });
  const frame = { type: "messages.upsert", payload: { messages: [] } };
  sources[0]?.onmessage?.({ data: JSON.stringify(frame) });
  expect(raws).toEqual([frame]);
});

function fakeDom(hash: string) {
  const calls: Array<{ nav?: string; app?: string; title?: string; hash?: string }> = [];
  const dom: AppDom = {
    getHash: () => hash,
    setHash: (h) => calls.push({ hash: h }),
    setNav: (html) => calls.push({ nav: html }),
    setApp: (html) => calls.push({ app: html }),
    setTitle: (t) => calls.push({ title: t }),
  };
  return { dom, calls };
}

test("T175 A2 — #/logs is a routed page with a nav entry and title", async () => {
  expect(ROUTES.some((route) => route.route === "logs" && route.pattern === "logs")).toBe(true);
  expect(navHtml("logs")).toContain(
    '<a href="#/logs" class="active" aria-current="page" data-nav="logs">Logs</a>',
  );
  const { dom, calls } = fakeDom("#/logs");
  await renderFrame({
    dom,
    settings: { bridgeUrl: "", token: "" },
    loaders: { logs: async () => '<section id="logs-page"></section>' },
  });
  expect(calls.some((call) => call.title === "Logs · wa-mcp")).toBe(true);
  expect(calls.some((call) => call.app === '<section id="logs-page"></section>')).toBe(true);
});

test("T175 A4 — #/events is gone: no route, no redirect, renders not-found", async () => {
  expect(ROUTES.some((route) => route.pattern === "events")).toBe(false);
  const { dom, calls } = fakeDom("#/events");
  await renderFrame({ dom, settings: { bridgeUrl: "", token: "" }, loaders: {} });
  expect(calls.some((call) => call.hash !== undefined)).toBe(false);
  expect(calls.some((call) => call.app?.includes('id="not-found"'))).toBe(true);
});
