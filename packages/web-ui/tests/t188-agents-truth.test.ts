import { expect, test } from "vite-plus/test";
import {
  agentOptions,
  agentSlug,
  connectionCardHtml,
  connectionsPageHtml,
  type ConnectionView,
} from "../src/connections.ts";
import {
  EMPTY_LOG_FILTER,
  logsFilterFromHash,
  logsPageHtml,
  logsQuery,
  matchesLogFilter,
} from "../src/logs.ts";
import { resolveRoute } from "../src/router.ts";
import { ROUTES } from "../src/app.ts";

function mcp(agent: string, label: string, installed: boolean | null): ConnectionView {
  return {
    kind: "mcp",
    agent,
    label,
    configPath: `/home/u/.${agent}/mcp.json`,
    detail: "wa-mcp-server",
    enabled: true,
    subId: null,
    inboxPath: null,
    subscription: null,
    installed,
  };
}

const CLAUDE_HOOK: ConnectionView = {
  kind: "hooks",
  agent: "claude",
  label: "Claude Code",
  configPath: "/home/u/.claude/settings.json",
  detail: "FileChanged hook drains /home/u/.wa-mcp/subs/abc/inbox.jsonl",
  enabled: true,
  subId: "abc",
  inboxPath: "/home/u/.wa-mcp/subs/abc/inbox.jsonl",
  subscription: { id: "abc", name: "Family", chatJid: "1203@g.us" },
  installed: true,
};

test("T188 P1 — a host app that is not installed gets a muted badge", () => {
  const html = connectionCardHtml(mcp("cursor", "Cursor", false));
  expect(html).toContain('<span class="badge badge-muted">App not installed</span>');
  expect(html).toContain('data-installed="false"');
  expect(connectionCardHtml(mcp("codex", "Codex", true))).not.toContain("App not installed");
  expect(connectionCardHtml(mcp("pi", "Pi", null))).not.toContain("App not installed");
});

test("T188 P1 — installed agents sort first, unknown next, not-installed last (stable)", () => {
  const html = connectionsPageHtml({
    connections: [
      mcp("cursor", "Cursor", false),
      mcp("pi", "Pi", null),
      mcp("codex", "Codex", true),
      mcp("grok", "Grok", false),
      CLAUDE_HOOK,
    ],
  });
  const order = [...html.matchAll(/data-connection-agent="([^"]+)"/g)].map((match) => match[1]);
  expect(order).toEqual(["codex", "claude", "pi", "cursor", "grok"]);
});

test("T188 P2 — View logs links to the logs page filtered to that agent", () => {
  expect(agentSlug(CLAUDE_HOOK)).toBe("claude-code");
  expect(agentSlug(mcp("codex", "Codex", true))).toBe("codex");
  expect(connectionCardHtml(CLAUDE_HOOK)).toContain(
    '<a href="#/logs?agent=claude-code">View logs</a>',
  );
  expect(connectionCardHtml(mcp("cursor", "Cursor", false))).toContain(
    '<a href="#/logs?agent=cursor">View logs</a>',
  );
});

test("T188 P2 — agent options are one per agent, labelled, in first-seen order", () => {
  expect(
    agentOptions([
      CLAUDE_HOOK,
      mcp("claude-code", "Claude Code", true),
      mcp("codex", "Codex", true),
    ]),
  ).toEqual([
    { value: "claude-code", label: "Claude Code" },
    { value: "codex", label: "Codex" },
  ]);
});

test("T188 P2 — #/logs?agent= resolves the logs route and pre-selects the agent", () => {
  expect(resolveRoute("#/logs?agent=codex", ROUTES)?.route).toBe("logs");
  expect(logsFilterFromHash("#/logs?agent=codex")).toEqual({ ...EMPTY_LOG_FILTER, agent: "codex" });
  expect(logsFilterFromHash("#/logs")).toBeNull();
  expect(logsFilterFromHash("#/logs?agent=")).toBeNull();
  expect(logsFilterFromHash("#/logs?agent=%3Cscript%3E")).toBeNull();
});

test("T188 P2 — the agent filter rides /api/search and the Agent select", () => {
  const params = new URLSearchParams(logsQuery({ ...EMPTY_LOG_FILTER, agent: "codex" }, 0, 50));
  expect(params.get("agent")).toBe("codex");
  expect(new URLSearchParams(logsQuery(EMPTY_LOG_FILTER, 0, 50)).has("agent")).toBe(false);
  const html = logsPageHtml({
    rows: [],
    filter: { ...EMPTY_LOG_FILTER, agent: "codex" },
    page: 0,
    hasMore: false,
    live: false,
    chats: [],
    people: [],
    agents: [
      { value: "claude-code", label: "Claude Code" },
      { value: "codex", label: "Codex" },
    ],
    resolveName: () => null,
  });
  expect(html).toContain('<select id="logs-agent" name="agent">');
  expect(html).toContain('<option value="">All agents</option>');
  expect(html).toContain('<option value="codex" selected>Codex</option>');
  const orphan = logsPageHtml({
    rows: [],
    filter: { ...EMPTY_LOG_FILTER, agent: "grok" },
    page: 0,
    hasMore: false,
    live: false,
    chats: [],
    people: [],
    resolveName: () => null,
  });
  expect(orphan).toContain('<option value="grok" selected>grok</option>');
});

test("T188 P2 — live tail cannot attribute rows client-side, so an agent filter skips them", () => {
  const row = {
    id: "M1",
    chatJid: "1203@g.us",
    senderJid: null,
    senderName: null,
    timestamp: "2026-10-08T10:00:00.000Z",
    content: "hi",
    mediaType: null,
    isFromMe: true,
  };
  expect(matchesLogFilter(row, EMPTY_LOG_FILTER)).toBe(true);
  expect(matchesLogFilter(row, { ...EMPTY_LOG_FILTER, agent: "codex" })).toBe(false);
});
