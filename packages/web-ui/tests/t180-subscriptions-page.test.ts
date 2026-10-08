import { expect, test } from "vite-plus/test";
import { createApiClient } from "../src/api.ts";
import { navHtml } from "../src/pages.ts";
import { renderFrame, type AppDom } from "../src/app.ts";
import {
  DELIVERY_OPTIONS,
  likePreview,
  readSubscriptionForm,
  subscriptionCardHtml,
  subscriptionFormHtml,
  subscriptionsPageHtml,
  type SubscriptionFormValues,
  type SubscriptionView,
} from "../src/subscriptions.ts";

const GROUP = "120363428874442773@g.us";
const DM = "358401112222@s.whatsapp.net";
const LID = "999555000111@lid";

const INBOX: SubscriptionView = {
  id: "abc123def456",
  name: "Team <ops>",
  chats: [GROUP, DM],
  filter: { like: "%invoice%", mentionOnly: true },
  prompt: "Triage invoices",
  delivery: { mode: "inbox" },
  enabled: true,
  created: "2026-10-08T00:00:00.000Z",
  inboxPath: "/d/subs/abc123def456/inbox.jsonl",
};
const SESSION: SubscriptionView = {
  ...INBOX,
  id: "s2",
  name: "Session",
  chats: ["*"],
  filter: {},
  delivery: { mode: "session", session: "claude:b41d" },
  enabled: false,
};
const SPAWN: SubscriptionView = {
  ...INBOX,
  id: "s3",
  name: "Spawn",
  filter: {},
  prompt: undefined,
  delivery: {
    mode: "spawn",
    agent: { command: "/usr/local/bin/claude", args: ["-p"], env: { A: "1" } },
  },
};
const SESSIONS = [{ id: "claude:b41d", label: "Claude Code · wa-mcp · 2026-10-08 09:00 UTC" }];
const CHATS = [
  { jid: DM, name: "Dana" },
  { jid: GROUP, name: "Team chat" },
  { jid: "120363000000000001@g.us", name: "Alpha group" },
];
const names = (jid: string): string | null => CHATS.find((chat) => chat.jid === jid)?.name ?? null;

test("T180 C — three delivery options, each with one line of help", () => {
  expect(DELIVERY_OPTIONS.map((option) => option.mode)).toEqual(["inbox", "session", "spawn"]);
  expect(DELIVERY_OPTIONS.map((option) => option.title)).toEqual([
    "Inbox file",
    "Agent session",
    "New agent each time",
  ]);
  for (const option of DELIVERY_OPTIONS) {
    expect(option.help.length).toBeGreaterThan(20);
  }
});

test.each([
  ["", "Every message"],
  ["invoice", "Messages containing “invoice” (any case)"],
  ["%invoice%", "Messages matching “%invoice%” — % is any text, _ is one character (any case)"],
])("T180 C likePreview(%j)", (pattern, expected) => {
  expect(likePreview(pattern)).toBe(expected);
});

test("T180 C card — name, chat chips by display name, filter + delivery badges, toggle, edit, delete", () => {
  const html = subscriptionCardHtml(INBOX, names, SESSIONS);
  expect(html).toContain('data-sub-id="abc123def456"');
  expect(html).toContain("Team &lt;ops&gt;");
  expect(html).toContain('<li class="chip">Team chat</li>');
  expect(html).toContain('<li class="chip">Dana</li>');
  expect(html).toContain('<span class="badge badge-filter">~ %invoice%</span>');
  expect(html).toContain('<span class="badge badge-filter">mentions only</span>');
  expect(html).toContain('<span class="badge badge-delivery">Inbox</span>');
  expect(html).toContain('data-toggle-sub="abc123def456" checked');
  expect(html).toContain("Triage invoices");
  expect(html).toContain("wa-mcp inbox drain --inbox /d/subs/abc123def456/inbox.jsonl");
  expect(html).toContain('data-copy-cmd="wa-mcp install --hooks claude --sub abc123def456"');
  expect(html).toContain('data-edit-sub="abc123def456"');
  expect(html).toContain('data-test-sub="abc123def456"');
  expect(html).toContain(
    '<button class="danger" type="button" data-delete-sub="abc123def456" data-sub-name="Team &lt;ops&gt;">Delete</button>',
  );
});

test("T180 C card — session label from the picker, all-chats chip, disabled toggle; spawn shows the command", () => {
  const session = subscriptionCardHtml(SESSION, names, SESSIONS);
  expect(session).toContain(
    '<span class="badge badge-delivery">Session: Claude Code · wa-mcp · 2026-10-08 09:00 UTC</span>',
  );
  expect(session).toContain('<li class="chip">All chats</li>');
  expect(session).not.toContain('data-toggle-sub="s2" checked');
  expect(session).not.toContain("inbox drain");
  expect(subscriptionCardHtml({ ...SESSION, delivery: { mode: "session" } }, names, [])).toContain(
    "Session: any active session",
  );
  const spawn = subscriptionCardHtml(SPAWN, names, []);
  expect(spawn).toContain('<span class="badge badge-delivery">Spawn: /usr/local/bin/claude</span>');
  expect(spawn).not.toContain("sub-prompt");
});

test("T180 C form — new: steps, chat picker with groups first, like hint, prompt, all delivery options", () => {
  const html = subscriptionFormHtml(null, CHATS, SESSIONS);
  expect(html).toContain('<form id="subscription-form" data-sub-id="">');
  expect(html).toContain("New subscription");
  for (const legend of ["1. Name and chats", "2. Filter", "3. Prompt", "4. Delivery"]) {
    expect(html).toContain(`<legend>${legend}</legend>`);
  }
  expect(html).toContain('aria-label="Filter chats"');
  const alpha = html.indexOf("Alpha group");
  const team = html.indexOf("Team chat");
  const dana = html.indexOf("Dana");
  expect(alpha).toBeLessThan(team);
  expect(team).toBeLessThan(dana);
  expect(html).toContain('name="like"');
  expect(html).toContain('id="like-preview"');
  expect(html).toContain('name="mention_only"');
  expect(html).toContain("System prompt your agent receives with the event");
  expect(html).toContain('<input type="radio" name="mode" value="inbox" checked');
  expect(html).toContain('<input type="radio" name="mode" value="session"');
  expect(html).toContain('<input type="radio" name="mode" value="spawn"');
  expect(html).toContain('<option value="">Any active session</option>');
  expect(html).toContain(
    '<option value="claude:b41d">Claude Code · wa-mcp · 2026-10-08 09:00 UTC</option>',
  );
  expect(html).toContain('name="command"');
  expect(html).toContain('name="args"');
  expect(html).toContain('name="env"');
  expect(html).toContain('data-mode-config="session" hidden');
  expect(html).toContain('data-mode-config="spawn" hidden');
  expect(html).toContain("Create subscription");
});

test("T180 C form — edit: prefilled values, checked chats incl. ones not in the chat list, mode config shown", () => {
  const html = subscriptionFormHtml({ ...SPAWN, chats: [GROUP, LID] }, CHATS, SESSIONS);
  expect(html).toContain('data-sub-id="s3"');
  expect(html).toContain("Edit “Spawn”");
  expect(html).toContain(`value="${GROUP}" checked`);
  expect(html).toContain(`value="${LID}" checked`);
  expect(html).not.toContain(`value="${DM}" checked`);
  expect(html).toContain('<input type="radio" name="mode" value="spawn" checked');
  expect(html).toContain('data-mode-config="spawn">');
  expect(html).toContain('data-mode-config="inbox" hidden');
  expect(html).toContain('value="/usr/local/bin/claude"');
  expect(html).toContain(">-p</textarea>");
  expect(html).toContain(">A=1</textarea>");
  expect(html).toContain("Save changes");
  const inbox = subscriptionFormHtml(INBOX, CHATS, SESSIONS);
  expect(inbox).toContain('value="%invoice%"');
  expect(inbox).toContain('name="mention_only" checked');
  expect(inbox).toContain(">Triage invoices</textarea>");
  expect(inbox).toContain("wa-mcp inbox drain --inbox /d/subs/abc123def456/inbox.jsonl");
  const allChats = subscriptionFormHtml(SESSION, CHATS, SESSIONS);
  expect(allChats).toContain('name="all_chats" checked');
  expect(allChats).toContain('<option value="claude:b41d" selected>');
});

const VALUES: SubscriptionFormValues = {
  name: " Team ",
  chats: [GROUP],
  allChats: false,
  like: " %invoice% ",
  mentionOnly: true,
  prompt: " Triage ",
  mode: "inbox",
  session: "",
  command: "",
  args: "",
  env: "",
  enabled: true,
};

test("T180 C read form — inbox body", () => {
  expect(readSubscriptionForm(VALUES)).toEqual({
    ok: true,
    value: {
      name: "Team",
      chats: [GROUP],
      filter: { like: "%invoice%", mentionOnly: true },
      prompt: "Triage",
      delivery: { mode: "inbox" },
      enabled: true,
    },
  });
});

test("T180 C read form — all chats, session pick, spawn with args/env lines", () => {
  expect(
    readSubscriptionForm({
      ...VALUES,
      allChats: true,
      like: "",
      mentionOnly: false,
      prompt: "",
      mode: "session",
      session: "claude:b41d",
    }),
  ).toEqual({
    ok: true,
    value: {
      name: "Team",
      chats: ["*"],
      filter: {},
      delivery: { mode: "session", session: "claude:b41d" },
      enabled: true,
    },
  });
  expect(
    readSubscriptionForm({
      ...VALUES,
      mode: "spawn",
      command: " claude ",
      args: "-p\n\n--model\nopus\n",
      env: "ANTHROPIC_MODEL=opus\nX=a=b\n",
    }),
  ).toMatchObject({
    ok: true,
    value: {
      delivery: {
        mode: "spawn",
        agent: {
          command: "claude",
          args: ["-p", "--model", "opus"],
          env: { ANTHROPIC_MODEL: "opus", X: "a=b" },
        },
      },
    },
  });
});

test("T180 C read form — editing clears an emptied prompt with null", () => {
  const result = readSubscriptionForm({ ...VALUES, prompt: "  " }, { editing: true });
  expect(result).toMatchObject({ ok: true, value: { prompt: null } });
});

test("T180 C read form — friendly validation messages", () => {
  expect(readSubscriptionForm({ ...VALUES, name: " " })).toEqual({
    ok: false,
    message: "Give the subscription a name",
  });
  expect(readSubscriptionForm({ ...VALUES, chats: [] })).toEqual({
    ok: false,
    message: "Pick at least one chat, or tick All chats",
  });
  expect(readSubscriptionForm({ ...VALUES, mode: "spawn", command: "" })).toEqual({
    ok: false,
    message: "Enter the agent command (CLI path) to start",
  });
  expect(
    readSubscriptionForm({ ...VALUES, mode: "spawn", command: "c", env: "OK=1\nbroken" }),
  ).toEqual({ ok: false, message: "Environment line 2 must look like NAME=value" });
});

test("T180 C page — h1, new button, list, delivery help, error, empty state", () => {
  const html = subscriptionsPageHtml({
    subscriptions: [INBOX, SESSION],
    chats: CHATS,
    sessions: SESSIONS,
    editing: null,
    resolveName: names,
    error: "save failed <x>",
  });
  expect(html.match(/<h1>/g)).toHaveLength(1);
  expect(html).toContain("<h1>Subscriptions</h1>");
  expect(html).toContain('id="new-subscription"');
  expect(html).toContain('<ul id="subscription-list" aria-label="Subscriptions">');
  expect(html.match(/class="sub-card"/g)).toHaveLength(2);
  expect(html).not.toContain('id="subscription-form"');
  expect(html).toContain('role="alert"');
  expect(html).toContain("save failed &lt;x&gt;");
  for (const option of DELIVERY_OPTIONS) {
    expect(html).toContain(option.title);
  }
  expect(html).toContain("wa-mcp subs create");
  const empty = subscriptionsPageHtml({
    subscriptions: [],
    chats: CHATS,
    sessions: [],
    editing: "new",
  });
  expect(empty).toContain("No subscriptions yet");
  expect(empty).toContain('id="subscription-form"');
});

test("T180 C nav + fallback — the nav says Subscriptions (no more Agent alerts)", async () => {
  const nav = navHtml("subscriptions");
  expect(nav).toContain(
    '<a href="#/subscriptions" class="active" aria-current="page" data-nav="subscriptions">Subscriptions</a>',
  );
  expect(nav).not.toContain("Agent alerts");
  const calls: Array<{ app?: string; title?: string }> = [];
  const dom: AppDom = {
    getHash: () => "#/subscriptions",
    setHash: () => {},
    setNav: () => {},
    setApp: (html) => calls.push({ app: html }),
    setTitle: (title) => calls.push({ title }),
  };
  await renderFrame({ dom, loaders: {} });
  expect(calls.some((call) => call.title === "Subscriptions · wa-mcp")).toBe(true);
  expect(calls.at(-1)?.app).toContain("No subscriptions yet");
});

test("T180 C api — subs2 CRUD, test and sessions call shapes", async () => {
  const calls: Array<{ path: string; method: string; body?: unknown }> = [];
  const client = createApiClient({
    baseUrl: "http://bridge",
    token: "tok",
    fetchFn: (async (url: string | URL, init?: RequestInit) => {
      calls.push({
        path: String(url).slice("http://bridge".length),
        method: init?.method ?? "GET",
        ...(typeof init?.body === "string" ? { body: JSON.parse(init.body) } : {}),
      });
      return new Response("{}", { status: 200 });
    }) as unknown as typeof fetch,
    onUnauthorized: () => {},
  });
  await client.subscriptions();
  await client.createSubscription({ name: "x" });
  await client.updateSubscription("a b", { enabled: false });
  await client.deleteSubscription("a b");
  await client.testSubscription("a b");
  await client.sessions();
  expect(calls).toEqual([
    { path: "/api/subs2", method: "GET" },
    { path: "/api/subs2", method: "POST", body: { name: "x" } },
    { path: "/api/subs2/a%20b", method: "PATCH", body: { enabled: false } },
    { path: "/api/subs2/a%20b", method: "DELETE" },
    { path: "/api/subs2/a%20b/test", method: "POST" },
    { path: "/api/sessions", method: "GET" },
  ]);
});

test("T180 C card — ids, names, chats and prompts are HTML-escaped", () => {
  const evil = `x"><script>alert(1)</script>`;
  const html = subscriptionCardHtml(
    { ...INBOX, id: evil, name: evil, chats: [evil], prompt: evil, inboxPath: `/d/${evil}` },
    () => null,
    [],
  );
  expect(html).not.toContain("<script>");
  expect(html).toContain("&lt;script&gt;");
});

test("T180 C styles — cards, chips, badges, form steps and delivery options are styled", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  for (const selector of [
    "#subscription-list",
    ".sub-card",
    ".sub-head",
    ".chip-row",
    ".chip",
    ".badge-filter",
    ".badge-delivery",
    ".sub-actions",
    "#subscription-form fieldset",
    ".delivery-option",
    ".delivery-config",
    "#sub-chat-picker",
  ]) {
    expect(css, selector).toContain(selector);
  }
});
