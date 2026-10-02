import { expect, test } from "vite-plus/test";
import { renderFrame } from "../src/app.ts";

interface RecordedDom {
  hash: string;
  navHtml: string | null;
  appHtml: string | null;
  hashChanges: number;
}

function fakeDom(initialHash: string): RecordedDom & {
  io: Parameters<typeof renderFrame>[0]["dom"];
} {
  const state: RecordedDom = {
    hash: initialHash,
    navHtml: null,
    appHtml: null,
    hashChanges: 0,
  };
  const io = {
    dom: {
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
    },
  };
  return Object.assign(state, { io });
}

const NO_TOKEN = { bridgeUrl: "http://127.0.0.1:8080", token: "" };
const WITH_TOKEN = { bridgeUrl: "http://127.0.0.1:8080", token: "tok" };

function boom(name: string): () => Promise<string> {
  return async () => {
    throw new Error(`loader ${name} must not run`);
  };
}

test("no token + #/pairing renders the settings form instead of looping", async () => {
  const state = fakeDom("#/pairing");
  await renderFrame({
    dom: state.io.dom,
    settings: NO_TOKEN,
    loaders: { pairing: boom("pairing"), chats: boom("chats"), unread: boom("unread"), health: boom("health") },
  });
  expect(state.appHtml).toContain('id="settings-form"');
  expect(state.hash).toBe("#/settings");
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
