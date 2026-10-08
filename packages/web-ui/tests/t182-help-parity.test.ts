import { expect, test } from "vite-plus/test";
import { CLI_COMMANDS, CLI_GROUP_LABELS } from "../../shared/src/cli-reference.ts";
import { renderFrame, ROUTES, type AppDom } from "../src/app.ts";
import { escapeHtml } from "../src/escape.ts";
import { helpPageHtml } from "../src/help.ts";
import { navHtml } from "../src/pages.ts";
import { resolveRoute } from "../src/router.ts";
import { blockTargetJid } from "../src/state.ts";

test("T182 A help — one h1 and the five sections in order", () => {
  const html = helpPageHtml();
  expect((html.match(/<h1>/g) ?? []).length).toBe(1);
  expect(html).toContain('<section id="help-page"><h1>Help</h1>');
  const order = [
    "help-what",
    "help-start",
    "help-concepts",
    "help-cli",
    "help-troubleshooting",
  ].map((id) => html.indexOf(`id="${id}"`));
  expect(order.every((index) => index > 0)).toBe(true);
  expect([...order].sort((a, b) => a - b)).toEqual(order);
  for (const heading of [
    "What is this?",
    "Getting started",
    "Concepts",
    "Command line",
    "Troubleshooting",
  ]) {
    expect(html).toContain(`<h2>${heading}</h2>`);
  }
});

test("T182 A help — getting started walks link phone → first subscription → connect an agent", () => {
  const html = helpPageHtml();
  const start = html.slice(html.indexOf('id="help-start"'), html.indexOf('id="help-concepts"'));
  const steps = [...start.matchAll(/<li>(.*?)<\/li>/g)].map((match) => match[1] ?? "");
  expect(steps).toHaveLength(3);
  expect(steps[0]).toContain('href="#/connection"');
  expect(steps[0]).toContain("wa-mcp pair");
  expect(steps[1]).toContain('href="#/subscriptions"');
  expect(steps[1]).toContain("wa-mcp subs create");
  expect(steps[2]).toContain('href="#/connections"');
  expect(steps[2]).toContain("wa-mcp install --hooks claude --sub");
});

test("T182 A help — concepts cover every page and the subscription + connection settings vocabulary", () => {
  const html = helpPageHtml();
  const concepts = html.slice(html.indexOf('id="help-concepts"'), html.indexOf('id="help-cli"'));
  for (const [title, href] of [
    ["Logs", "#/logs"],
    ["Contacts", "#/contacts"],
    ["Connections", "#/connections"],
    ["Subscriptions", "#/subscriptions"],
    ["Profile", "#/profile"],
    ["Connection settings", "#/connection"],
  ]) {
    expect(concepts).toContain(`<h3><a href="${href}">${title}</a></h3>`);
  }
  for (const term of [
    "%like%",
    "Mention-only",
    "Prompt",
    "Inbox file",
    "Agent session",
    "New agent each time",
    "Humanisation",
    "Send limits",
  ]) {
    expect(concepts).toContain(term);
  }
});

test("T182 A help — every link resolves in the router table", () => {
  const hrefs = [...helpPageHtml().matchAll(/href="([^"]+)"/g)].map((match) => match[1] ?? "");
  expect(hrefs.length).toBeGreaterThan(10);
  for (const href of hrefs) {
    expect(href.startsWith("#/"), href).toBe(true);
    expect(resolveRoute(href, ROUTES), href).not.toBeNull();
  }
});

test("T182 A help drift — every CLI command is in the reference with its exact usage, grouped", () => {
  const html = helpPageHtml();
  const cli = html.slice(html.indexOf('id="help-cli"'), html.indexOf('id="help-troubleshooting"'));
  for (const label of Object.values(CLI_GROUP_LABELS)) {
    expect(cli).toContain(`<h3>${escapeHtml(label)}</h3>`);
  }
  for (const command of CLI_COMMANDS) {
    expect(cli, command.name).toContain(
      `<dt><code>wa-mcp ${escapeHtml(command.usage)}</code></dt>`,
    );
    expect(cli, command.name).toContain(escapeHtml(command.summary));
  }
});

test("T182 A help — troubleshooting covers not linked, 401, 429 limits and a silent subscription", () => {
  const html = helpPageHtml();
  const trouble = html.slice(html.indexOf('id="help-troubleshooting"'));
  for (const topic of [
    "WhatsApp is not linked",
    "401",
    "429",
    "SEND_LIMIT_REACHED",
    "A subscription never fires",
  ]) {
    expect(trouble).toContain(topic);
  }
});

function fakeDom(hash: string): { dom: AppDom; state: { app: string; nav: string } } {
  const state = { app: "", nav: "" };
  return {
    state,
    dom: {
      getHash: () => hash,
      setHash: () => {},
      setNav: (html) => {
        state.nav = html;
      },
      setApp: (html) => {
        state.app = html;
      },
      setTitle: () => {},
    },
  };
}

test("T182 A help — #/help renders without a loader; Help is a top-level nav link", async () => {
  const frame = fakeDom("#/help");
  await renderFrame({ dom: frame.dom, settings: { bridgeUrl: "", token: "t" }, loaders: {} });
  expect(frame.state.app).toBe(helpPageHtml());
  expect(navHtml("help")).toContain(
    '<a href="#/help" class="active" aria-current="page" data-nav="help">Help</a>',
  );
});

test("T182 C router — the route table after the R2 cleanup", () => {
  expect(ROUTES.map((route) => route.route)).toEqual([
    "status",
    "connection",
    "chats",
    "chat",
    "contacts",
    "profile",
    "settings",
    "logs",
    "subscriptions",
    "connections",
    "pairing",
    "help",
  ]);
  for (const gone of ["#/groups", "#/connect", "#/unread", "#/events", "#/automations"]) {
    expect(resolveRoute(gone, ROUTES), gone).toBeNull();
  }
});

test("T182 B profile — Block a number accepts a phone number and turns it into a WhatsApp id", () => {
  expect(blockTargetJid("+44 7700 900123")).toBe("447700900123@s.whatsapp.net");
  expect(blockTargetJid("447700900123@s.whatsapp.net")).toBe("447700900123@s.whatsapp.net");
  expect(blockTargetJid("not a number")).toBeNull();
  expect(blockTargetJid("")).toBeNull();
});

test("T182 A help — styles: panel stack, step list, term lists, command reference", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  for (const selector of ["#help-page {", ".help-steps {", ".help-terms dt {", ".help-cli dt {"]) {
    expect(css).toContain(selector);
  }
});
