import { expect, test } from "vite-plus/test";
import { renderFrame, type AppDom } from "../src/app.ts";

interface RecordedDom {
  hash: string;
  navHtml: string | null;
  appHtml: string | null;
  hashChanges: number;
}

function fakeDom(initialHash: string): RecordedDom & { io: { dom: AppDom } } {
  const state: RecordedDom = {
    hash: initialHash,
    navHtml: null,
    appHtml: null,
    hashChanges: 0,
  };
  const dom: AppDom = {
    getHash: () => state.hash,
    setHash: (hash: string) => {
      state.hashChanges += 1;
      state.hash = hash;
    },
    setNav: (html: string) => {
      state.navHtml = html;
    },
    setApp: (html: string) => {
      state.appHtml = html;
    },
  };
  return Object.assign(state, { io: { dom } });
}

const NO_TOKEN = { bridgeUrl: "http://127.0.0.1:8080", token: "" };
const WITH_TOKEN = { bridgeUrl: "http://127.0.0.1:8080", token: "tok" };

function boom(name: string): () => Promise<string> {
  return async () => {
    throw new Error(`loader ${name} must not run`);
  };
}

test("no token + #/pairing renders the token form inline with the qr area, no redirect", async () => {
  const state = fakeDom("#/pairing");
  await renderFrame({
    dom: state.io.dom,
    settings: NO_TOKEN,
    loaders: {
      pairing: boom("pairing"),
      chats: boom("chats"),
      unread: boom("unread"),
      health: boom("health"),
    },
  });
  expect(state.hashChanges).toBe(0);
  expect(state.hash).toBe("#/pairing");
  expect(state.appHtml).toContain('id="pairing"');
  expect(state.appHtml).toContain('id="settings-form"');
  expect(state.appHtml).toContain('id="token"');
  expect(state.navHtml).toContain("#/chats");
});

test("no token + #/settings renders the form without touching the hash", async () => {
  const state = fakeDom("#/settings");
  await renderFrame({
    dom: state.io.dom,
    settings: NO_TOKEN,
    loaders: { chats: boom("chats") },
  });
  expect(state.appHtml).toContain('id="settings-form"');
  expect(state.hashChanges).toBe(0);
});

test("no token + other route redirects once AND renders the form", async () => {
  const state = fakeDom("#/chats");
  await renderFrame({
    dom: state.io.dom,
    settings: NO_TOKEN,
    loaders: { chats: boom("chats") },
  });
  expect(state.hash).toBe("#/settings");
  expect(state.appHtml).toContain('id="settings-form"');
});

test("nav is populated on every render", async () => {
  const state = fakeDom("#/health");
  await renderFrame({
    dom: state.io.dom,
    settings: WITH_TOKEN,
    loaders: { health: async () => "<dl>ok</dl>" },
  });
  expect(state.navHtml).toContain("#/chats");
  expect(state.navHtml).toContain("#/settings");
});

test("with a token, route loaders render into the app", async () => {
  const state = fakeDom("#/health");
  await renderFrame({
    dom: state.io.dom,
    settings: WITH_TOKEN,
    loaders: { health: async () => "<dl>health ok</dl>" },
  });
  expect(state.appHtml).toContain("health ok");
});

test("unknown channel + status route renders the status dashboard (T51)", async () => {
  const state = fakeDom("#/status");
  await renderFrame({
    dom: state.io.dom,
    settings: WITH_TOKEN,
    loaders: { status: async () => '<section id="status-dashboard">ok</section>' },
  });
  expect(state.appHtml).toContain("status-dashboard");
});

test("contacts route resolves (T51)", async () => {
  const state = fakeDom("#/contacts");
  await renderFrame({
    dom: state.io.dom,
    settings: WITH_TOKEN,
    loaders: { contacts: async () => '<ul id="contacts-list"></ul>' },
  });
  expect(state.appHtml).toContain("contacts-list");
});

test("groups route resolves (T51)", async () => {
  const state = fakeDom("#/groups");
  await renderFrame({
    dom: state.io.dom,
    settings: WITH_TOKEN,
    loaders: { groups: async () => '<ul id="groups-list"></ul>' },
  });
  expect(state.appHtml).toContain("groups-list");
});
