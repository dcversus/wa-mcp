import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { CLI_COMMANDS } from "../../shared/src/cli-reference.ts";
import { ROUTES, renderFrame, type AppDom } from "../src/app.ts";
import { connectionsPageHtml } from "../src/connections.ts";
import { helpPageHtml } from "../src/help.ts";
import { navHtml } from "../src/pages.ts";
import { resolveRoute } from "../src/router.ts";

const ROOT = join(import.meta.dirname, "..", "..", "..");
const SRC = join(import.meta.dirname, "..", "src");
const read = (path: string): string => readFileSync(join(ROOT, path), "utf8");

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

test("T185 A router — #/settings redirects to #/connection without rendering", async () => {
  const { dom, calls } = fakeDom("#/settings");
  await renderFrame({ dom, loaders: {} });
  expect(calls).toEqual([{ hash: "#/connection" }]);
});

test("T185 B router — #/agents is canonical; #/connections redirects to it", async () => {
  expect(resolveRoute("#/agents", ROUTES)?.route).toBe("agents");
  const { dom, calls } = fakeDom("#/connections");
  await renderFrame({ dom, loaders: {} });
  expect(calls).toEqual([{ hash: "#/agents" }]);
});

test("T185 B agents page — title, h1 and loader", async () => {
  const { dom, calls } = fakeDom("#/agents");
  await renderFrame({
    dom,
    loaders: { agents: async () => connectionsPageHtml({ connections: [] }) },
  });
  expect(calls.some((call) => call.title === "Agents · wa-mcp")).toBe(true);
  const app = calls.filter((call) => call.app !== undefined).at(-1)?.app ?? "";
  expect(app).toContain("<h1>Agents</h1>");
  expect(app).not.toContain("<h1>Connections</h1>");
});

test("T185 B nav — exactly two header-less groups in the owner's order, a spacer between", () => {
  const nav = navHtml("logs");
  const links = [...nav.matchAll(/<a href="([^"]+)"[^>]*>([^<]+)<\/a>/g)].map((match) => [
    match[1],
    match[2],
  ]);
  expect(links).toEqual([
    ["#/logs", "Logs"],
    ["#/subscriptions", "Subscriptions"],
    ["#/agents", "Agents"],
    ["#/profile", "Profile"],
    ["#/contacts", "Contacts"],
    ["#/connection", "Connection"],
    ["#/help", "Help"],
  ]);
  expect(nav).not.toContain("nav-group");
  for (const header of ["Messages", "People", "Agent<", "Me<", "System"]) {
    expect(nav, header).not.toContain(header);
  }
  expect(nav.match(/<span class="nav-separator" aria-hidden="true"><\/span>/g)).toHaveLength(1);
  expect(nav.indexOf("nav-separator")).toBeGreaterThan(nav.indexOf('href="#/agents"'));
  expect(nav.indexOf("nav-separator")).toBeLessThan(nav.indexOf('href="#/profile"'));
  expect(navHtml("agents")).toContain(
    '<a href="#/agents" class="active" aria-current="page" data-nav="agents">Agents</a>',
  );
});

test("T185 A removed code — no settings page, transcription panel or nav headers left in src", () => {
  for (const file of readdirSync(SRC)) {
    const text = readFileSync(join(SRC, file), "utf8");
    for (const gone of [
      "settingsHtml",
      "transcriptionSettingsHtml",
      "bindSettingsForm",
      "bindTranscriptionForm",
      "settings-page",
      '"settings-form"',
      "#settings-form",
      "transcription-form",
      "#/settings",
      "#/connections",
      "nav-group",
      "getConfig",
      "saveConfig",
    ]) {
      expect(text, `${file}: ${gone}`).not.toContain(gone);
    }
  }
  const routes = ROUTES.map((entry) => entry.route as string);
  expect(routes).toContain("agents");
});

test("T185 C styles — separator spacing on the token scale; no nav-group rules", () => {
  const css = readFileSync(join(SRC, "styles.css"), "utf8");
  const start = css.indexOf("\n.nav-separator {");
  expect(start).toBeGreaterThan(-1);
  expect(css.slice(start, css.indexOf("}", start))).toMatch(/height: var\(--s[5-7]\)/);
});

test("T185 C help + CLI reference — Agents, never Settings or Connections pages", () => {
  const html = helpPageHtml();
  expect(html).toContain('<h3><a href="#/agents">Agents</a></h3>');
  expect(html).not.toContain("#/settings");
  expect(html).not.toContain("#/connections");
  expect(html).not.toMatch(/>Settings</);
  for (const command of CLI_COMMANDS) {
    expect(command.web, command.name).not.toBe("#/settings");
    expect(command.web, command.name).not.toBe("#/connections");
  }
  expect(CLI_COMMANDS.find((command) => command.name === "connections")?.web).toBe("#/agents");
});

test("T185 C docs + scripts — no #/settings or #/connections page links", () => {
  for (const path of [
    "README.md",
    "docs/getting-started/desktop.md",
    "docs/getting-started/index.md",
    "docs/troubleshooting.md",
    "scripts/webui-e2e.mjs",
    "scripts/webui-dogfood.mjs",
  ]) {
    expect(read(path), path).not.toMatch(/#\/settings|#\/connections/);
  }
  const smoke = read("scripts/webui-smoke.mjs");
  expect(smoke).toContain("#/settings should redirect to #/connection");
  expect(smoke).not.toContain('id="settings-form"');
});
