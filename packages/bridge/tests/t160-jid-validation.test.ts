import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { isJid } from "@wa-mcp/shared";
import { openStore } from "../src/store/schema.ts";
import { createEventBus } from "../src/events.ts";
import { createHttpServer, type BridgeHttp } from "../src/http.ts";
import type { BridgeHandle } from "../src/lifecycle.ts";

function stubHandle(events: ReturnType<typeof createEventBus>): BridgeHandle {
  return {
    status: "connected",
    events,
    close: async () => {},
    getLastQr: () => null,
    hasPairedAccount: () => true,
    pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
    resumePairing: () => {},
    connectionQuality: () => ({ reconnects: 0, lastDisconnectAt: null }),
    logout: async () => {},
    fetchHistory: async () => ({ requested: false, request_id: "" }),
    contactsWarm: () => true,
    socket: {},
  } as unknown as BridgeHandle;
}

function url(bridge: BridgeHttp, path: string): string {
  return `http://127.0.0.1:${bridge.port}${path}`;
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

test("T160 W10 — isJid accepts WhatsApp shapes and rejects garbage", () => {
  expect(isJid("358400000001@s.whatsapp.net")).toBe(true);
  expect(isJid("120363428874442773@g.us")).toBe(true);
  expect(isJid("999555000111@lid")).toBe(true);
  expect(isJid("358400000001:12@s.whatsapp.net")).toBe(true);
  expect(isJid("status@broadcast")).toBe(true);
  expect(isJid("not-a-jid")).toBe(false);
  expect(isJid("hello@world")).toBe(false);
  expect(isJid("")).toBe(false);
  expect(isJid(42)).toBe(false);
});

test("T160 W10 — a garbage chat_jid is a 400, not a stored subscription", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t160-"));
  const store = openStore(dataDir);
  try {
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t160-token",
      store,
      subscriptionsDir: join(dataDir, "subs"),
    });
    const res = await fetch(url(bridge, "/api/subs2"), {
      method: "POST",
      headers: auth("t160-token"),
      body: JSON.stringify({ name: "x", chats: ["not-a-jid"], delivery: { mode: "inbox" } }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toContain("not a WhatsApp chat id");
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T160 W10 — a garbage block jid is a 400, not a 500", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t160-"));
  const store = openStore(dataDir);
  try {
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t160-token",
      store,
    });
    const res = await fetch(url(bridge, "/api/block"), {
      method: "POST",
      headers: auth("t160-token"),
      body: JSON.stringify({ jid: "not-a-jid", block: true }),
    });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { error?: { message?: string } };
    expect(body.error?.message).toContain("WhatsApp number or group");
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
