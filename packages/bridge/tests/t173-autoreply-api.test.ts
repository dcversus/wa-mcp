import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openStore } from "../src/store/schema.ts";
import { addAutoreplyRule } from "../src/store/autoreply.ts";
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
function authed(token: string): { headers: Record<string, string> } {
  return { headers: auth(token) };
}

test("T173 B1 — GET /api/autoreply lists seeded rules with ids and enabled", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t173-"));
  const store = openStore(dataDir);
  try {
    addAutoreplyRule(store, { match: "invoice", reply: "on it" });
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t173-token",
      store,
    });
    const res = await fetch(url(bridge, "/api/autoreply"), authed("t173-token"));
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      autoreplies?: Array<{
        id: number;
        match: string;
        reply: string;
        enabled: boolean;
        createdAt?: string;
      }>;
    };
    expect(body.autoreplies).toHaveLength(1);
    expect(body.autoreplies?.[0]).toMatchObject({
      match: "invoice",
      reply: "on it",
      enabled: true,
    });
    expect(typeof body.autoreplies?.[0]?.id).toBe("number");
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T173 B1 — DELETE /api/autoreply/:id removes exactly that rule; unknown → 404", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t173-"));
  const store = openStore(dataDir);
  try {
    const kept = addAutoreplyRule(store, { match: "keep", reply: "k" });
    const removed = addAutoreplyRule(store, { match: "drop", reply: "d" });
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t173-token",
      store,
    });
    const del = await fetch(url(bridge, `/api/autoreply/${removed}`), {
      method: "DELETE",
      ...authed("t173-token"),
    });
    expect(del.status).toBe(200);
    const list = (await (
      await fetch(url(bridge, "/api/autoreply"), authed("t173-token"))
    ).json()) as { autoreplies: Array<{ id: number }> };
    expect(list.autoreplies.map((rule) => rule.id)).toEqual([kept]);
    const missing = await fetch(url(bridge, `/api/autoreply/${removed}`), {
      method: "DELETE",
      ...authed("t173-token"),
    });
    expect(missing.status).toBe(404);
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T173 B1 — POST /api/autoreply/:id/toggle pauses and resumes", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t173-"));
  const store = openStore(dataDir);
  try {
    const id = addAutoreplyRule(store, { match: "hi", reply: "hello" });
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t173-token",
      store,
    });
    const pause = await fetch(url(bridge, `/api/autoreply/${id}/toggle`), {
      method: "POST",
      headers: { ...auth("t173-token"), "content-type": "application/json" },
      body: JSON.stringify({ enabled: false }),
    });
    expect(pause.status).toBe(200);
    const paused = (await (
      await fetch(url(bridge, "/api/autoreply"), authed("t173-token"))
    ).json()) as { autoreplies: Array<{ enabled: boolean }> };
    expect(paused.autoreplies[0]?.enabled).toBe(false);
    const resume = await fetch(url(bridge, `/api/autoreply/${id}/toggle`), {
      method: "POST",
      headers: { ...auth("t173-token"), "content-type": "application/json" },
      body: JSON.stringify({ enabled: true }),
    });
    expect(resume.status).toBe(200);
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T173 B1 — the autoreply endpoints need auth", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t173-"));
  const store = openStore(dataDir);
  try {
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t173-token",
      store,
    });
    expect((await fetch(url(bridge, "/api/autoreply"))).status).toBe(401);
    expect((await fetch(url(bridge, "/api/autoreply/1"), { method: "DELETE" })).status).toBe(401);
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
