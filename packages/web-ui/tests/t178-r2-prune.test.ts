import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { ROUTES, renderFrame, type AppDom } from "../src/app.ts";
import { navHtml } from "../src/pages.ts";
import { connectionPageHtml } from "../src/connection.ts";

const SRC = join(import.meta.dirname, "..", "src");

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

test("T178 C — deleted routes render the not-found page with the way home, no redirect", async () => {
  for (const hash of ["#/automations", "#/unread", "#/health", "#/events"]) {
    const { dom, calls } = fakeDom(hash);
    await renderFrame({ dom, settings: { bridgeUrl: "", token: "" }, loaders: {} });
    expect(
      calls.some((call) => call.hash !== undefined),
      hash,
    ).toBe(false);
    const app = calls.find((call) => call.app !== undefined)?.app ?? "";
    expect(app, hash).toContain("Page not found");
    expect(app, hash).toContain('href="#/chats"');
  }
});

test("T178 C — the route table no longer knows the deleted pages", () => {
  const routes = ROUTES.map((entry) => entry.route as string);
  for (const gone of ["automations", "unread", "health", "events"]) {
    expect(routes).not.toContain(gone);
  }
  expect(routes).toContain("contacts");
});

test("T178 C — nav renders Contacts and no Automations entry; status links nowhere dead", () => {
  const nav = navHtml("contacts");
  expect(nav).toContain('href="#/contacts" class="active" aria-current="page"');
  expect(nav).not.toMatch(/automation/i);
  const status = connectionPageHtml({
    health: {},
    me: null,
    stats: null,
    settings: null,
    events: [],
  });
  expect(status).not.toMatch(/automation/i);
});

test("T178 C — no web-ui source mentions automations or calls their endpoints", () => {
  for (const file of readdirSync(SRC)) {
    const text = readFileSync(join(SRC, file), "utf8");
    expect(text, file).not.toMatch(/automation/i);
    expect(text, file).not.toMatch(/\/api\/(autoreply|scheduled|send-rules)/);
    expect(text, file).not.toMatch(/\b(unreadHtml|healthHtml)\b/);
    expect(text, file).not.toContain('"#/unread"');
    expect(text, file).not.toContain('"#/health"');
  }
});
