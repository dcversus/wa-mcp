import { expect, test } from "vite-plus/test";
import { createApiClient } from "../src/api.ts";
import { ROUTES, renderFrame, type AppDom } from "../src/app.ts";
import {
  connectionCardHtml,
  connectionsPageHtml,
  type ConnectionView,
} from "../src/connections.ts";
import { navHtml } from "../src/pages.ts";

const CLAUDE_HOOK: ConnectionView = {
  kind: "hooks",
  agent: "claude",
  label: "Claude Code",
  configPath: "/home/u/.claude/settings.json",
  detail: "FileChanged hook drains /home/u/.wa-mcp/subs/abc/inbox.jsonl",
  enabled: true,
  subId: "abc",
  inboxPath: "/home/u/.wa-mcp/subs/abc/inbox.jsonl",
  subscription: { id: "abc", name: "Family <alerts>", chatJid: "1203@g.us" },
};
const CODEX_HOOK: ConnectionView = {
  ...CLAUDE_HOOK,
  agent: "codex",
  label: "Codex",
  enabled: false,
  subId: "gone",
  subscription: null,
};
const CURSOR_MCP: ConnectionView = {
  kind: "mcp",
  agent: "cursor",
  label: "Cursor",
  configPath: "/home/u/.cursor/mcp.json",
  detail: "wa-mcp-server · env WA_TOKEN=[redacted]",
  enabled: true,
  subId: null,
  inboxPath: null,
  subscription: null,
};

function fakeDom(hash: string) {
  const calls: Array<{ nav?: string; app?: string; title?: string }> = [];
  const dom: AppDom = {
    getHash: () => hash,
    setHash: () => {},
    setNav: (html) => calls.push({ nav: html }),
    setApp: (html) => calls.push({ app: html }),
    setTitle: (t) => calls.push({ title: t }),
  };
  return { dom, calls };
}

test("T179 C card — agent name, Hooks badge, enabled status, linked subscription, logs + disconnect", () => {
  const html = connectionCardHtml(CLAUDE_HOOK);
  expect(html).toContain('data-connection-kind="hooks"');
  expect(html).toContain("Claude Code");
  expect(html).toContain('<span class="badge badge-hooks">Hooks</span>');
  expect(html).toContain("Hooks enabled ✓");
  expect(html).toContain('href="#/subscriptions"');
  expect(html).toContain("Family &lt;alerts&gt;");
  expect(html).toContain('<a href="#/logs?agent=claude-code">View logs</a>');
  expect(html).toContain(
    '<button class="danger" type="button" data-disconnect-kind="hooks" data-disconnect-agent="claude" data-disconnect-sub="abc" data-disconnect-label="Claude Code" aria-label="Disconnect Claude Code">Disconnect</button>',
  );
});

test("T179 C card — disabled hooks and a missing subscription are called out", () => {
  const html = connectionCardHtml(CODEX_HOOK);
  expect(html).toContain("Hooks disabled");
  expect(html).not.toContain("Hooks enabled");
  expect(html).toContain("Subscription gone no longer exists");
  expect(html).toContain('<a href="#/logs?agent=codex">View logs</a>');
  expect(html).not.toContain("data-logs-chat");
});

test("T179 C card — MCP registrations get an MCP badge and a set-up-subscription link", () => {
  const html = connectionCardHtml(CURSOR_MCP);
  expect(html).toContain('<span class="badge badge-mcp">MCP</span>');
  expect(html).toContain("Registered ✓");
  expect(html).toContain("wa-mcp-server · env WA_TOKEN=[redacted]");
  expect(html).toContain('data-disconnect-kind="mcp" data-disconnect-agent="cursor"');
  expect(html).not.toContain("data-disconnect-sub");
  expect(html).toContain('<a href="#/subscriptions">Set up a subscription</a>');
});

test("T179 C page — h1, Connected agents list, error banner", () => {
  const html = connectionsPageHtml({
    connections: [CLAUDE_HOOK, CURSOR_MCP],
    error: "could not disconnect <x>",
  });
  expect(html.match(/<h1>/g)).toHaveLength(1);
  expect(html).toContain("<h1>Agents</h1>");
  expect(html).toContain("<h2>Connected agents</h2>");
  expect(html).toContain('<ul id="connections-list" aria-label="Connected agents">');
  expect(html.match(/class="connection-card"/g)).toHaveLength(2);
  expect(html).toContain('role="alert"');
  expect(html).toContain("could not disconnect &lt;x&gt;");
});

test("T179 C page — empty state points to Subscriptions", () => {
  const html = connectionsPageHtml({ connections: [] });
  expect(html).toContain("No agents connected yet — set one up in");
  expect(html).toContain('<a href="#/subscriptions">Subscriptions</a>');
  expect(html).not.toContain("connection-card");
});

test("T179 C router — the agents page (renamed from Connections in R2-9) replaces the Connect agent stub", async () => {
  const routes = ROUTES.map((entry) => entry.route as string);
  expect(routes).toContain("agents");
  expect(routes).not.toContain("connect");
  const nav = navHtml("agents");
  expect(nav).toContain(
    '<a href="#/agents" class="active" aria-current="page" data-nav="agents">Agents</a>',
  );
  expect(nav).not.toContain("Connect agent");
  const { dom, calls } = fakeDom("#/agents");
  await renderFrame({
    dom,
    loaders: { agents: async () => connectionsPageHtml({ connections: [CURSOR_MCP] }) },
  });
  expect(calls.some((call) => call.title === "Agents · wa-mcp")).toBe(true);
  expect(calls.at(-1)?.app).toContain("Cursor");
  const fallback = fakeDom("#/agents");
  await renderFrame({ dom: fallback.dom, loaders: {} });
  expect(fallback.calls.at(-1)?.app).toContain("No agents connected yet");
});

test("T179 C api — connections() GETs and disconnectConnection() DELETEs with optional sub", async () => {
  const calls: Array<{ path: string; method: string }> = [];
  const client = createApiClient({
    baseUrl: "http://bridge",
    token: "tok",
    fetchFn: (async (url: string | URL, init?: RequestInit) => {
      calls.push({
        path: String(url).slice("http://bridge".length),
        method: init?.method ?? "GET",
      });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch,
    onUnauthorized: () => {},
  });
  await client.connections();
  await client.disconnectConnection("hooks", "claude", "abc");
  await client.disconnectConnection("mcp", "claude-code");
  expect(calls).toEqual([
    { path: "/api/connections", method: "GET" },
    { path: "/api/connections/hooks/claude?sub=abc", method: "DELETE" },
    { path: "/api/connections/mcp/claude-code", method: "DELETE" },
  ]);
});

test("T179 C styles — cards, kind badges and status colours are styled", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  for (const selector of [
    "#connections-list",
    ".connection-card",
    ".connection-head",
    ".badge-hooks",
    ".badge-mcp",
    ".connection-status.ok",
    ".connection-status.off",
    ".connection-actions",
  ]) {
    expect(css, selector).toContain(selector);
  }
});
