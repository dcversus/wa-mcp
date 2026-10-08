import { expect, test } from "vite-plus/test";
import { renderFrame, type AppDom } from "../src/app.ts";

interface RecordedDom {
  hash: string;
  navHtml: string | null;
  appHtml: string | null;
  title: string | null;
  hashChanges: number;
}

function fakeDom(initialHash: string): RecordedDom & { io: { dom: AppDom } } {
  const state: RecordedDom = {
    hash: initialHash,
    navHtml: null,
    appHtml: null,
    title: null as string | null,
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
    setTitle: (title: string) => {
      state.title = title;
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

test("no token + #/pairing renders the pairing FLOW — never a token wall (T53)", async () => {
  const state = fakeDom("#/pairing");
  await renderFrame({
    dom: state.io.dom,
    settings: NO_TOKEN,
    loaders: {
      pairing: async () => '<section id="pairing" class="pane pane-methods">QR</section>',
      contacts: boom("contacts"),
    },
    pairingView: () => ({
      pane: "methods",
      health: {},
      qr: { qr: null, png: null },
      countdownPct: 0,
    }),
  });
  expect(state.hashChanges).toBe(0);
  expect(state.hash).toBe("#/pairing");
  expect(state.appHtml).toContain("pane-methods");
  expect(state.appHtml).not.toContain('id="settings-form"');
  expect(state.appHtml).not.toContain('id="token"');
  expect(state.navHtml).toContain("#/contacts");
});

test("no token + #/settings renders the form without touching the hash", async () => {
  const state = fakeDom("#/settings");
  await renderFrame({
    dom: state.io.dom,
    settings: NO_TOKEN,
    loaders: { contacts: boom("contacts") },
  });
  expect(state.appHtml).toContain('id="settings-form"');
  expect(state.hashChanges).toBe(0);
});

test("no token + #/contacts renders the contacts page via the ephemeral UI token (T54 revised)", async () => {
  const state = fakeDom("#/contacts");
  await renderFrame({
    dom: state.io.dom,
    settings: NO_TOKEN,
    loaders: {
      contacts: async () => '<section id="contacts-page"><ul id="contacts-list"></ul></section>',
    },
  });
  expect(state.hashChanges).toBe(0);
  expect(state.hash).toBe("#/contacts");
  expect(state.appHtml).toContain("contacts-list");
  expect(state.appHtml).not.toContain('id="settings-form"');
  expect(state.appHtml).not.toContain("cat ~");
});

test("nav is populated on every render", async () => {
  const state = fakeDom("#/connection");
  await renderFrame({
    dom: state.io.dom,
    settings: WITH_TOKEN,
    loaders: { connection: async () => "<dl>ok</dl>" },
  });
  expect(state.navHtml).toContain("#/contacts");
  expect(state.navHtml).toContain("#/settings");
});

test("with a token, route loaders render into the app", async () => {
  const state = fakeDom("#/connection");
  await renderFrame({
    dom: state.io.dom,
    settings: WITH_TOKEN,
    loaders: { connection: async () => "<dl>health ok</dl>" },
  });
  expect(state.appHtml).toContain("health ok");
});

test("unknown channel + connection route renders the status dashboard (T51)", async () => {
  const state = fakeDom("#/connection");
  await renderFrame({
    dom: state.io.dom,
    settings: WITH_TOKEN,
    loaders: { connection: async () => '<section id="status-dashboard">ok</section>' },
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
