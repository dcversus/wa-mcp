import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openStore } from "../src/store/schema.ts";
import { createRule, evaluateRules, listRules } from "../src/notifications.ts";

function upsertEvent(chatJid: string, text: string): Parameters<typeof evaluateRules>[1] {
  return {
    type: "messages.upsert",
    payload: {
      messages: [
        { key: { remoteJid: chatJid, fromMe: false, id: "E1" }, message: { conversation: text } },
      ],
      type: "append",
    },
  };
}

test("existing rules (pre-V19 rows) default deliver to [mcp]", () => {
  const dir = mkdtempSync(join(tmpdir(), "t116-"));
  const store = openStore(dir);
  try {
    store.db
      .prepare(
        "INSERT INTO notification_rules (chat_jid, from_jid, unread_only, title, body, created_at) VALUES (NULL, NULL, 0, 'legacy', 'b', ?)",
      )
      .run(new Date().toISOString());
    const rules = listRules(store);
    expect(rules).toHaveLength(1);
    expect(rules[0]?.deliver).toEqual(["mcp"]);
    expect(rules[0]?.subId).toBeNull();
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deliver [file] with sub_id appends a kind:rule line to the subscription inbox path via matches", () => {
  const dir = mkdtempSync(join(tmpdir(), "t116-"));
  const store = openStore(dir);
  try {
    const rule = createRule(store, {
      title: "ping {chat}",
      body: "new message",
      chatJid: "120363428874442773@g.us",
      deliver: ["file"],
      subId: "sub42",
    });
    const matches = evaluateRules(store, upsertEvent("120363428874442773@g.us", "hello"));
    expect(matches).toHaveLength(1);
    expect(matches[0]?.deliver).toEqual(["file"]);
    expect(matches[0]?.subId).toBe("sub42");
    expect(rule.deliver).toEqual(["file"]);
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("deliver [mcp] and [ui] round-trip on matches", () => {
  const dir = mkdtempSync(join(tmpdir(), "t116-"));
  const store = openStore(dir);
  try {
    createRule(store, { title: "a", body: "b", deliver: ["mcp", "ui"] });
    const matches = evaluateRules(store, upsertEvent("any@g.us", "x"));
    expect(matches[0]?.deliver).toEqual(["mcp", "ui"]);
    expect(matches[0]?.subId).toBeNull();
  } finally {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("POST /api/notifications rejects unknown channel and file-without-sub_id (400)", async () => {
  const { createHttpServer } = await import("../src/http.ts");
  const { createEventBus } = await import("../src/events.ts");
  const dir = mkdtempSync(join(tmpdir(), "t116-http-"));
  const store = openStore(dir);
  const events = createEventBus();
  try {
    const handle = {
      status: "connected",
      events,
      close: async () => {},
      getLastQr: () => null,
      socket: {},
      hasPairedAccount: () => true,
      pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
      resumePairing: () => {},
      connectionQuality: () => ({ reconnects: 0, lastDisconnectAt: null }),
      logout: async () => {},
      fetchHistory: async () => ({ requested: false, request_id: "" }),
      contactsWarm: () => true,
    } as never;
    const bridge = await createHttpServer(handle, {
      token: "t116",
      store,
      subscriptionsDir: dir,
    });
    const base = `http://127.0.0.1:${bridge.port}`;
    const badChannel = await fetch(`${base}/api/notifications`, {
      method: "POST",
      headers: { authorization: "Bearer t116", "content-type": "application/json" },
      body: JSON.stringify({ title: "t", deliver: ["sms"] }),
    });
    expect(badChannel.status).toBe(400);
    const fileNoSub = await fetch(`${base}/api/notifications`, {
      method: "POST",
      headers: { authorization: "Bearer t116", "content-type": "application/json" },
      body: JSON.stringify({ title: "t", deliver: ["file"] }),
    });
    expect(fileNoSub.status).toBe(400);
    const ok = await fetch(`${base}/api/notifications`, {
      method: "POST",
      headers: { authorization: "Bearer t116", "content-type": "application/json" },
      body: JSON.stringify({
        title: "t",
        chat_jid: "120363428874442773@g.us",
        deliver: ["file"],
        sub_id: "sub42",
      }),
    });
    expect(ok.status).toBe(200);
    await bridge.close();
    store.close();
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});
