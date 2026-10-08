import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { CLI_COMMANDS } from "../../shared/src/cli-reference.ts";
import { ROUTES, renderFrame, type AppDom } from "../src/app.ts";
import { contactsPageHtml, type ContactView } from "../src/contacts.ts";
import { helpPageHtml } from "../src/help.ts";
import { EMPTY_LOG_FILTER, logRowHtml, type LogRow, type LogsPageInput } from "../src/logs.ts";
import { navHtml, notFoundHtml } from "../src/pages.ts";
import { pairingHtml } from "../src/pages-pairing.ts";
import { resolveRoute, routeKind } from "../src/router.ts";
import { firstRunGate } from "../src/state.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const SRC = join(import.meta.dirname, "..", "src");
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

function fakeDom(hash: string) {
  const calls: Array<{ nav?: string; app?: string; hash?: string }> = [];
  const dom: AppDom = {
    getHash: () => hash,
    setHash: (h) => calls.push({ hash: h }),
    setNav: (html) => calls.push({ nav: html }),
    setApp: (html) => calls.push({ app: html }),
    setTitle: () => {},
  };
  return { dom, calls };
}

const DANA: ContactView = {
  jid: "358400000001@s.whatsapp.net",
  displayName: "Dana Scully",
  phone: "+358 40 000 0001",
  name: "Dana Scully",
  pushname: null,
  username: null,
  alias: null,
  source: "whatsapp",
};

test("T183 A router — #/chats redirects to #/contacts without rendering a page", async () => {
  const { dom, calls } = fakeDom("#/chats");
  await renderFrame({ dom, loaders: {} });
  expect(calls).toEqual([{ hash: "#/contacts" }]);
});

test("T183 A router — the bare hash lands on Contacts; chat detail still resolves", () => {
  expect(resolveRoute("", ROUTES)?.route).toBe("contacts");
  expect(resolveRoute("#/", ROUTES)?.route).toBe("contacts");
  const chat = resolveRoute("#/chat/358400000001%40s.whatsapp.net", ROUTES);
  expect(chat?.route).toBe("chat");
  expect(chat?.params.jid).toBe("358400000001@s.whatsapp.net");
  expect(routeKind("#/chat/358400000001%40s.whatsapp.net")).toBe("chat-view");
  expect(routeKind("#/chats")).toBe("other");
});

test("T183 A nav — no Chats entry", () => {
  const nav = navHtml("logs");
  expect(nav).not.toContain("#/chats");
  expect(nav).not.toContain(">Chats<");
});

test("T183 A first run — unlinked on the landing page (Contacts) gets the pairing pane", () => {
  for (const hash of ["", "#/", "#/contacts"]) {
    expect(
      firstRunGate({ loggedIn: false, contactsWarm: false, chatCount: 0, hash }).renderPairing,
      hash,
    ).toBe(true);
  }
  expect(
    firstRunGate({ loggedIn: false, contactsWarm: true, chatCount: 0, hash: "#/logs" }),
  ).toEqual({ renderPairing: false, banner: true, syncing: false });
});

test("T183 A entry points — not-found and the paired pane send you to Contacts", () => {
  expect(notFoundHtml("#/nope")).toContain('<a href="#/contacts">Go to contacts</a>');
  const paired = pairingHtml({
    pane: "paired",
    health: { connected: true },
    qr: { qr: null, png: null },
    countdownPct: 0,
    me: "Versus",
  });
  expect(paired).toContain('<a href="#/contacts">Contacts</a>');
  expect(paired).not.toContain("#/chats");
});

test("T183 A contacts — a contact row opens its chat; first sync shows a loading state", () => {
  const html = contactsPageHtml({ contacts: [DANA], total: 1, query: "", saved: true });
  expect(html).toContain('<a class="contact-open" href="#/chat/358400000001%40s.whatsapp.net">');
  const loading = contactsPageHtml({
    contacts: [],
    total: 0,
    query: "",
    saved: true,
    syncing: true,
  });
  expect(loading).toContain('<div class="spinner"></div>');
  expect(loading).toContain("Loading your contacts from your phone");
});

test("T183 A removed code — no Chats list page left in web-ui source or styles", () => {
  for (const file of readdirSync(SRC)) {
    const text = readFileSync(join(SRC, file), "utf8");
    for (const gone of [
      "chats-page",
      "chatListHtml",
      "chats-list",
      "chat-tab",
      "archived-toggle",
      "bindChatsControls",
      "bindChatClicks",
      "chatSearchQuery",
      "#/chats",
      "ChatSummaryView",
    ]) {
      expect(text, `${file}: ${gone}`).not.toContain(gone);
    }
  }
  const css = readFileSync(join(SRC, "styles.css"), "utf8");
  for (const selector of [
    ".chat-list",
    ".chat-tab",
    "#chat-search",
    ".hide-archived",
    ".unread-badge",
    ".chat-preview",
  ]) {
    expect(css, selector).not.toContain(selector);
  }
});

test("T183 A help + CLI reference — nothing points at the deleted Chats page", () => {
  expect(helpPageHtml()).not.toContain("#/chats");
  expect(helpPageHtml()).not.toContain("Chats page");
  for (const command of CLI_COMMANDS) {
    expect(command.web, command.name).not.toBe("#/chats");
    expect(command.summary, command.name).not.toContain("Chats page");
  }
});

test("T183 A docs + scripts — the page lists and browser scripts no longer use #/chats", () => {
  for (const path of [
    "README.md",
    "docs/getting-started/desktop.md",
    "docs/troubleshooting.md",
    "scripts/webui-e2e.mjs",
    "scripts/webui-dogfood.mjs",
  ]) {
    expect(read(path), path).not.toContain("#/chats");
  }
  const smoke = read("scripts/webui-smoke.mjs");
  expect(smoke).toContain("#/chats should redirect to #/contacts");
  expect(smoke).not.toContain("chats-page");
  expect(read("README.md")).not.toMatch(/unread inbox|status dashboard|, groups,/);
});

test("T183 A e2e — enters via Contacts, opens the chat from a contact row, then sends", () => {
  const e2e = read("scripts/webui-e2e.mjs");
  expect(e2e).toContain("/#/contacts");
  expect(e2e).toContain("contacts-page");
  expect(e2e).toContain(".contact-open");
  expect(e2e.indexOf("/#/contacts")).toBeLessThan(e2e.indexOf(".contact-open"));
  expect(e2e.indexOf(".contact-open")).toBeLessThan(e2e.indexOf(".send-box button"));
});

test("T183 B contacts — no sync copy, no sync button, automatic empty state", () => {
  for (const html of [
    contactsPageHtml({ contacts: [DANA], total: 1, query: "", saved: true }),
    contactsPageHtml({ contacts: [], total: 0, query: "", saved: false }),
    contactsPageHtml({ contacts: [], total: 0, query: "x", saved: false }),
  ]) {
    expect(html).not.toMatch(/sync/i);
    expect(html).not.toContain("like WhatsApp Web");
  }
  expect(contactsPageHtml({ contacts: [], total: 0, query: "", saved: false })).toContain(
    "No contacts yet. Contacts appear automatically as you chat.",
  );
});

test("T183 B contacts — a successful save shows a plain Saved confirmation", () => {
  const html = contactsPageHtml({
    contacts: [DANA],
    total: 1,
    query: "",
    saved: true,
    notice: "Saved",
  });
  expect(html).toContain('<p class="save-flash ok" role="status">Saved</p>');
  const main = readFileSync(join(SRC, "main.ts"), "utf8");
  const write = main.slice(main.indexOf("async function contactWrite"));
  expect(write.slice(0, write.indexOf("\n}\n"))).toContain('contactsNotice = "Saved"');
});

test("T183 B removed code — the sync UI surface is gone; the CLI keeps contacts sync", () => {
  for (const file of readdirSync(SRC)) {
    const text = readFileSync(join(SRC, file), "utf8");
    for (const gone of [
      "contacts-sync",
      "contactsSyncSummary",
      "ContactsSyncResult",
      "syncContacts",
    ]) {
      expect(text, `${file}: ${gone}`).not.toContain(gone);
    }
    expect(text, file).not.toContain("/api/contacts/sync");
  }
  expect(CLI_COMMANDS.find((command) => command.name === "contacts")?.actions).toContain("sync");
});

test("T183 B help — Contacts reads like WhatsApp Web, with no sync paragraph", () => {
  const html = helpPageHtml();
  const concepts = html.slice(html.indexOf('id="help-concepts"'), html.indexOf('id="help-cli"'));
  const contacts = concepts.slice(
    concepts.indexOf('href="#/contacts"'),
    concepts.indexOf('href="#/agents"'),
  );
  expect(contacts).toContain("exactly like WhatsApp Web");
  expect(contacts).not.toMatch(/sync/i);
  expect(contacts).toContain("click a contact to open your conversation");
});

const GROUP = "120363000000000001@g.us";
const ROW: LogRow = {
  id: "M1",
  chatJid: GROUP,
  senderJid: "358400000001@s.whatsapp.net",
  senderName: "Alice",
  timestamp: "2026-10-08T10:00:00Z",
  content: "hi",
  mediaType: null,
  isFromMe: false,
};
const INPUT: LogsPageInput = {
  filter: EMPTY_LOG_FILTER,
  rows: [ROW],
  chats: [{ jid: GROUP, name: "Family" }],
  people: [],
  resolveName: () => null,
  live: false,
  page: 0,
  hasMore: false,
  now: Date.parse("2026-10-08T10:05:00Z"),
};

test("T183 C logs — every row's chat cell links to that chat's detail", () => {
  const html = logRowHtml(ROW, INPUT);
  expect(html).toContain(`<td><a href="#/chat/${encodeURIComponent(GROUP)}">Family</a></td>`);
  const unknown = logRowHtml({ ...ROW, chatJid: "x<y@g.us" }, INPUT);
  expect(unknown).toContain(`href="#/chat/${encodeURIComponent("x<y@g.us")}"`);
  expect(unknown).not.toContain("x<y");
});
