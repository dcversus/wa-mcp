import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openStore } from "../src/store/schema.ts";
import {
  createSubscription,
  deleteSubscription,
  listSubscriptions,
  matchSubscription,
  subscriptionDir,
} from "../src/subscriptions.ts";

function setup(): { dataDir: string; cleanup: () => void } {
  const dataDir = mkdtempSync(join(tmpdir(), "t105-"));
  return { dataDir, cleanup: () => rmSync(dataDir, { recursive: true, force: true }) };
}

test("createSubscription persists filters, creates subs dir, list/delete round-trip", () => {
  const { dataDir, cleanup } = setup();
  try {
    const store = openStore(dataDir);
    const sub = createSubscription(store, dataDir, {
      chatJid: "120363428874442773@g.us",
      fromJid: null,
      kinds: ["message", "reaction"],
      includeMedia: true,
      allChats: false,
    });
    expect(sub.id).toMatch(/^[a-z0-9]{8,}$/);
    expect(existsSync(subscriptionDir(dataDir, sub.id))).toBe(true);
    const listed = listSubscriptions(store);
    expect(listed).toHaveLength(1);
    expect(listed[0]?.id).toBe(sub.id);
    expect(listed[0]?.chatJid).toBe("120363428874442773@g.us");
    expect(listed[0]?.kinds).toEqual(["message", "reaction"]);
    expect(listed[0]?.includeMedia).toBe(true);
    expect(listed[0]?.allChats).toBe(false);
    const second = openStore(dataDir);
    expect(listSubscriptions(second)).toHaveLength(1);
    second.close();
    expect(deleteSubscription(store, sub.id)).toBe(true);
    expect(listSubscriptions(store)).toHaveLength(0);
    expect(existsSync(subscriptionDir(dataDir, sub.id))).toBe(true);
    expect(deleteSubscription(store, sub.id)).toBe(false);
    store.close();
  } finally {
    cleanup();
  }
});

test("matchSubscription filters by chat, from, kind, include_media", () => {
  const sub = {
    chatJid: "120363428874442773@g.us",
    fromJid: null,
    kinds: ["message"],
    includeMedia: false,
    allChats: false,
  };
  expect(
    matchSubscription(sub, {
      chatJid: "120363428874442773@g.us",
      fromJid: "351@s.whatsapp.net",
      kind: "message",
      hasMedia: false,
    }),
  ).toBe(true);
  expect(
    matchSubscription(sub, {
      chatJid: "other@s.whatsapp.net",
      fromJid: "351@s.whatsapp.net",
      kind: "message",
      hasMedia: false,
    }),
  ).toBe(false);
  expect(
    matchSubscription(sub, {
      chatJid: "120363428874442773@g.us",
      fromJid: "351@s.whatsapp.net",
      kind: "reaction",
      hasMedia: false,
    }),
  ).toBe(false);
  expect(
    matchSubscription(sub, {
      chatJid: "120363428874442773@g.us",
      fromJid: "351@s.whatsapp.net",
      kind: "message",
      hasMedia: true,
    }),
  ).toBe(false);
  const allChats = {
    chatJid: null,
    fromJid: "351@s.whatsapp.net",
    kinds: [],
    includeMedia: true,
    allChats: true,
  };
  expect(
    matchSubscription(allChats, {
      chatJid: "anywhere@g.us",
      fromJid: "351@s.whatsapp.net",
      kind: "reaction",
      hasMedia: true,
    }),
  ).toBe(true);
  expect(
    matchSubscription(allChats, {
      chatJid: "anywhere@g.us",
      fromJid: "someone@s.whatsapp.net",
      kind: "reaction",
      hasMedia: true,
    }),
  ).toBe(false);
});
