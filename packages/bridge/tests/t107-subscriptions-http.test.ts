import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
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

function auth(token: string): HeadersInit {
  return { authorization: `Bearer ${token}` };
}

test("POST /api/subscriptions creates with inbox path; GET lists; DELETE removes; 401 without token", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t107-"));
  const store = openStore(dataDir);
  try {
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t107-token",
      store,
      subscriptionsDir: join(dataDir, "subs"),
    });
    const created = await fetch(url(bridge, "/api/subscriptions"), {
      method: "POST",
      headers: auth("t107-token"),
      body: JSON.stringify({ chat_jid: "120363428874442773@g.us" }),
    });
    expect(created.status).toBe(201);
    const createdBody = (await created.json()) as { id: string; inboxPath: string };
    expect(createdBody.id).toBeTruthy();
    expect(createdBody.inboxPath).toMatch(/subs\/[a-z0-9-]+\/inbox\.jsonl$/);
    expect(existsSync(createdBody.inboxPath)).toBe(true);
    const listed = await fetch(url(bridge, "/api/subscriptions"), { headers: auth("t107-token") });
    expect(listed.status).toBe(200);
    const listedBody = (await listed.json()) as { subscriptions: unknown[] };
    expect(listedBody.subscriptions).toHaveLength(1);
    const unauth = await fetch(url(bridge, "/api/subscriptions"), { headers: auth("wrong") });
    expect(unauth.status).toBe(401);
    const deleted = await fetch(url(bridge, `/api/subscriptions/${createdBody.id}`), {
      method: "DELETE",
      headers: auth("t107-token"),
    });
    expect(deleted.status).toBe(204);
    const after = (await (
      await fetch(url(bridge, "/api/subscriptions"), { headers: auth("t107-token") })
    ).json()) as {
      subscriptions: unknown[];
    };
    expect(after.subscriptions).toHaveLength(0);
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("messages.upsert on the bus appends to the matching subscription inbox only", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t107-"));
  const store = openStore(dataDir);
  const events = createEventBus();
  try {
    const bridge = await createHttpServer(stubHandle(events), {
      token: "t107-token",
      store,
      subscriptionsDir: join(dataDir, "subs"),
    });
    const created = await fetch(url(bridge, "/api/subscriptions"), {
      method: "POST",
      headers: auth("t107-token"),
      body: JSON.stringify({ chat_jid: "120363428874442773@g.us" }),
    });
    const { inboxPath } = (await created.json()) as { inboxPath: string };
    events.emit({
      type: "messages.upsert",
      payload: {
        messages: [
          {
            key: { remoteJid: "120363428874442773@g.us", fromMe: false, id: "EV1" },
            message: { conversation: "hello subscriptions" },
            messageTimestamp: 1759000000,
          },
        ],
      },
    } as never);
    const lines = readFileSync(inboxPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const parsed = JSON.parse(lines[0] ?? "{}") as {
      chat: string;
      text: string;
      kind: string;
      media: boolean;
    };
    expect(parsed.chat).toBe("120363428874442773@g.us");
    expect(parsed.text).toBe("hello subscriptions");
    expect(parsed.kind).toBe("message");
    expect(parsed.media).toBe(false);
    const other = await fetch(url(bridge, "/api/subscriptions"), {
      method: "POST",
      headers: auth("t107-token"),
      body: JSON.stringify({ chat_jid: "other@s.whatsapp.net" }),
    });
    const otherBody = (await other.json()) as { inboxPath: string };
    events.emit({
      type: "messages.upsert",
      payload: {
        messages: [
          {
            key: { remoteJid: "120363428874442773@g.us", fromMe: false, id: "EV2" },
            message: { conversation: "second" },
            messageTimestamp: 1759000001,
          },
        ],
      },
    } as never);
    const otherLines = readFileSync(otherBody.inboxPath, "utf8").trim();
    expect(otherLines).toBe("");
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("/health reports subscriptions {count, dropped}", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t107-"));
  const store = openStore(dataDir);
  try {
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t107-token",
      store,
      subscriptionsDir: join(dataDir, "subs"),
    });
    const health = (await (await fetch(url(bridge, "/health"))).json()) as {
      subscriptions?: { count: number; dropped: number };
    };
    expect(health.subscriptions).toEqual({ count: 0, dropped: 0 });
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("LIVE-shaped upsert (top-level participant, extendedText, string ts, append) appends", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t107-"));
  const store = openStore(dataDir);
  const events = createEventBus();
  try {
    const bridge = await createHttpServer(stubHandle(events), {
      token: "t107-token",
      store,
      subscriptionsDir: dataDir,
    });
    const created = await fetch(url(bridge, "/api/subscriptions"), {
      method: "POST",
      headers: auth("t107-token"),
      body: JSON.stringify({ chat_jid: "120363428874442773@g.us" }),
    });
    const { inboxPath } = (await created.json()) as { inboxPath: string };
    events.emit({
      type: "messages.upsert",
      payload: {
        messages: [
          {
            key: { remoteJid: "120363428874442773@g.us", fromMe: true, id: "3EB0764213F942527D3C58" },
            message: { extendedTextMessage: { text: "t107 sse probe 2" }, messageContextInfo: { messageSecret: "x" } },
            messageTimestamp: "1791156862",
            status: "PENDING",
            participant: "358497773518:2@s.whatsapp.net",
          },
        ],
        type: "append",
      },
    } as never);
    const lines = readFileSync(inboxPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
