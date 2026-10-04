import { mkdtempSync, rmSync } from "node:fs";
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
    socket: {},
    hasPairedAccount: () => true,
    pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
    resumePairing: () => {},
    connectionQuality: () => ({ reconnects: 0, lastDisconnectAt: null }),
    logout: async () => {},
    fetchHistory: async () => ({ requested: false, request_id: "" }),
    contactsWarm: () => true,
  } as unknown as BridgeHandle;
}

test("POST initialize returns Mcp-Session-Id; GET /mcp streams for subscribed uris; unknown session 404", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t110-"));
  const store = openStore(dataDir);
  const events = createEventBus();
  try {
    const bridge: BridgeHttp = await createHttpServer(stubHandle(events), {
      token: "t110-token",
      store,
      subscriptionsDir: dataDir,
    });
    const init = await fetch(`http://127.0.0.1:${bridge.port}/mcp`, {
      method: "POST",
      headers: { authorization: "Bearer t110-token", "content-type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} }),
    });
    expect(init.status).toBe(200);
    const sessionId = init.headers.get("mcp-session-id");
    expect(sessionId).toBeTruthy();
    await fetch(`http://127.0.0.1:${bridge.port}/mcp`, {
      method: "POST",
      headers: {
        authorization: "Bearer t110-token",
        "content-type": "application/json",
        "mcp-session-id": sessionId as string,
      },
      body: JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "resources/subscribe",
        params: { uri: "wa://unread" },
      }),
    });
    const unknown = await fetch(`http://127.0.0.1:${bridge.port}/mcp`, {
      headers: { authorization: "Bearer t110-token", "mcp-session-id": "no-such-session" },
    });
    expect(unknown.status).toBe(404);
    const controller = new AbortController();
    const sse = await fetch(`http://127.0.0.1:${bridge.port}/mcp`, {
      headers: { authorization: "Bearer t110-token", "mcp-session-id": sessionId as string },
      signal: controller.signal,
    });
    expect(sse.status).toBe(200);
    expect(sse.headers.get("content-type")).toContain("text/event-stream");
    const reader = sse.body?.getReader();
    events.emit({
      type: "messages.upsert",
      payload: {
        messages: [
          {
            key: { remoteJid: "120363428874442773@g.us", fromMe: false, id: "E1" },
            message: { conversation: "x" },
          },
        ],
        type: "notify",
      },
    } as never);
    const decoder = new TextDecoder();
    let buffered = "";
    let sawUnread = false;
    let sawChats = false;
    const deadline = Date.now() + 5000;
    while (Date.now() < deadline && !sawUnread) {
      const chunk = await reader?.read();
      if (chunk === undefined || chunk.done) {
        break;
      }
      buffered += decoder.decode(chunk.value, { stream: true });
      if (buffered.includes("wa://unread")) {
        sawUnread = true;
      }
      if (buffered.includes("wa://chats")) {
        sawChats = true;
      }
    }
    controller.abort();
    expect(sawUnread).toBe(true);
    expect(sawChats).toBe(false);
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
