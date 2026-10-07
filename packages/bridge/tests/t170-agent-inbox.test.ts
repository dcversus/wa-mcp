import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
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
  } as unknown as BridgeHandle;
}
function url(bridge: BridgeHttp, path: string): string {
  return `http://127.0.0.1:${bridge.port}${path}`;
}
function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function createSub(bridge: BridgeHttp): Promise<{ id: string; inboxPath: string }> {
  const created = await fetch(url(bridge, "/api/subscriptions"), {
    method: "POST",
    headers: auth("t170-token"),
    body: JSON.stringify({ chat_jid: "120363428874442773@g.us" }),
  });
  return (await created.json()) as { id: string; inboxPath: string };
}

test("T170 A2 — the test endpoint appends exactly one kind:test line", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t170-"));
  const store = openStore(dataDir);
  try {
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t170-token",
      store,
      subscriptionsDir: dataDir,
    });
    const { id, inboxPath } = await createSub(bridge);
    const res = await fetch(url(bridge, `/api/subscriptions/${id}/test`), {
      method: "POST",
      headers: auth("t170-token"),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok?: boolean; appended?: boolean; inboxPath?: string };
    expect(body.ok).toBe(true);
    expect(body.appended).toBe(true);
    expect(body.inboxPath).toBe(inboxPath);
    const lines = readFileSync(inboxPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const event = JSON.parse(lines[0] as string) as { kind?: string };
    expect(event.kind).toBe("test");
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T170 A2 — a second test within the window is rate-limited", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t170-"));
  const store = openStore(dataDir);
  try {
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t170-token",
      store,
      subscriptionsDir: dataDir,
    });
    const { id, inboxPath } = await createSub(bridge);
    const first = await fetch(url(bridge, `/api/subscriptions/${id}/test`), {
      method: "POST",
      headers: auth("t170-token"),
    });
    expect(first.status).toBe(200);
    const second = await fetch(url(bridge, `/api/subscriptions/${id}/test`), {
      method: "POST",
      headers: auth("t170-token"),
    });
    expect(second.status).toBe(429);
    const lines = readFileSync(inboxPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T170 A2 — an unknown subscription is 404", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t170-"));
  const store = openStore(dataDir);
  try {
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t170-token",
      store,
      subscriptionsDir: dataDir,
    });
    const res = await fetch(url(bridge, "/api/subscriptions/deadbeef/test"), {
      method: "POST",
      headers: auth("t170-token"),
    });
    expect(res.status).toBe(404);
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T170 A2 — the test endpoint needs auth", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t170-"));
  const store = openStore(dataDir);
  try {
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t170-token",
      store,
      subscriptionsDir: dataDir,
    });
    const res = await fetch(url(bridge, "/api/subscriptions/deadbeef/test"), { method: "POST" });
    expect(res.status).toBe(401);
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T170 A4 — dispatched events carry id, chatName and fromName", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t170-"));
  const store = openStore(dataDir);
  const events = createEventBus();
  try {
    store.db
      .prepare("INSERT INTO chats (jid, name) VALUES (?, ?)")
      .run("120363428874442773@g.us", "Test group");
    const bridge = await createHttpServer(stubHandle(events), {
      token: "t170-token",
      store,
      subscriptionsDir: dataDir,
    });
    const { inboxPath } = await createSub(bridge);
    events.emit({
      type: "messages.upsert",
      payload: {
        type: "notify",
        pushName: "Dana",
        messages: [
          {
            key: {
              remoteJid: "120363428874442773@g.us",
              fromMe: false,
              id: "MSG42",
              participant: "358400000002@s.whatsapp.net",
            },
            message: { conversation: "hello" },
            messageTimestamp: 1791156862,
          },
        ],
      },
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const lines = readFileSync(inboxPath, "utf8").trim().split("\n");
    const event = JSON.parse(lines[0] as string) as {
      id?: string;
      chatName?: string | null;
      fromName?: string | null;
      senderName?: string | null;
    };
    expect(event.id).toBe("MSG42");
    expect(event.chatName).toBe("Test group");
    expect(event.fromName).toBe("Dana");
    expect(event.senderName).toBeUndefined();
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
