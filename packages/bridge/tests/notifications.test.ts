import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openStore, type Store } from "../src/store/schema.ts";
import {
  createRule,
  deleteRule,
  evaluateRules,
  listRules,
  type WaEventLike,
} from "../src/notifications.ts";

function makeStore(): Store {
  return openStore(mkdtempSync(join(tmpdir(), "wa-mcp-notif-")));
}

function upsertEvent(chatJid: string, senderJid: string, text: string, fromMe = false): WaEventLike {
  return {
    type: "messages.upsert",
    payload: {
      messages: [
        {
          key: { remoteJid: chatJid, fromMe, id: `M-${senderJid}-${text}`, participant: senderJid },
          message: { conversation: text },
          pushName: "Vasilisa",
        },
      ],
      type: "notify",
    },
  } as WaEventLike;
}

test("createRule stores it and listRules returns all", () => {
  const store = makeStore();
  try {
    const rule = createRule(store, { title: "ping from {{sender}}", body: "{{text}}" });
    expect(rule.id).toBeGreaterThan(0);
    expect(rule.title).toBe("ping from {{sender}}");
    expect(rule.chatJid).toBeNull();
    expect(rule.unreadOnly).toBe(false);
    expect(listRules(store)).toHaveLength(1);
  } finally {
    store.close();
  }
});

test("deleteRule removes it", () => {
  const store = makeStore();
  try {
    const rule = createRule(store, { title: "t" });
    deleteRule(store, rule.id);
    expect(listRules(store)).toEqual([]);
  } finally {
    store.close();
  }
});

test("evaluateRules matches chat and sender and skips others", () => {
  const store = makeStore();
  try {
    createRule(store, { chatJid: "120363428874442773@g.us", title: "group ping", body: "{{text}}" });
    createRule(store, { fromJid: "358401112222@s.whatsapp.net", title: "from alice", body: "{{text}}" });
    const matches = evaluateRules(store, upsertEvent("120363428874442773@g.us", "358401112222@s.whatsapp.net", "hello"));
    expect(matches.map((match) => match.title).sort()).toEqual(["from alice", "group ping"]);
    const otherChat = evaluateRules(store, upsertEvent("120363999999999999@g.us", "999@s.whatsapp.net", "hi"));
    expect(otherChat).toEqual([]);
  } finally {
    store.close();
  }
});

test("unreadOnly rules skip from-me messages", () => {
  const store = makeStore();
  try {
    createRule(store, { unreadOnly: true, title: "only inbound", body: "{{text}}" });
    expect(evaluateRules(store, upsertEvent("g@g.us", "a@s.whatsapp.net", "from me", true))).toEqual([]);
    const matches = evaluateRules(store, upsertEvent("g@g.us", "a@s.whatsapp.net", "to me"));
    expect(matches).toHaveLength(1);
  } finally {
    store.close();
  }
});

test("templates substitute chat, sender and text", () => {
  const store = makeStore();
  try {
    createRule(store, {
      chatJid: "g@g.us",
      title: "{{sender}} in {{chat}}",
      body: "said: {{text}}",
    });
    const matches = evaluateRules(store, upsertEvent("g@g.us", "358401112222@s.whatsapp.net", "ding"));
    expect(matches[0]?.title).toBe("358401112222@s.whatsapp.net in g@g.us");
    expect(matches[0]?.body).toBe("said: ding");
  } finally {
    store.close();
  }
});
