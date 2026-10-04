import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openStore } from "../src/store/schema.ts";
import { createEventBus } from "../src/events.ts";
import { createHttpServer, type BridgeHttp } from "../src/http.ts";
import type { BridgeHandle } from "../src/lifecycle.ts";
import { toMcpNotifications } from "../src/mcp-notify.ts";

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

test("messages.upsert maps to resources/updated for wa://unread and wa://chats", () => {
  const out = toMcpNotifications({
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
  expect(out).toHaveLength(2);
  expect(out[0]?.method).toBe("notifications/resources/updated");
  expect(out[0]?.params.uri).toBe("wa://unread");
  expect(out[1]?.params.uri).toBe("wa://chats");
});

test("connection.update maps to notifications/message info + wa://health update", () => {
  const out = toMcpNotifications({
    type: "connection.update",
    payload: { connection: "close", lastDisconnect: undefined },
  } as never);
  const msg = out.find((n) => n.method === "notifications/message");
  const res = out.find((n) => n.method === "notifications/resources/updated");
  expect(msg?.params.level).toBe("info");
  expect(msg?.params.logger).toBe("wa-mcp.connection");
  expect(res?.params.uri).toBe("wa://health");
});

test("creds.update maps to nothing (security regression guard)", () => {
  const out = toMcpNotifications({ type: "creds.update", payload: {} } as never);
  expect(out).toHaveLength(0);
});

test("rule match maps to notifications/message notice with wa-mcp.rules logger", () => {
  const out = toMcpNotifications({ type: "chats.update", payload: [] } as never, [
    { ruleId: "r1", title: "unread in Test", body: "5 unread" },
  ]);
  const msg = out.find((n) => n.method === "notifications/message");
  expect(msg?.params.level).toBe("notice");
  expect(msg?.params.logger).toBe("wa-mcp.rules");
  expect(msg?.params.data).toEqual({ ruleId: "r1", title: "unread in Test", body: "5 unread" });
});

test("GET /api/mcp-notify streams mapped JSON-RPC lines and requires auth", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t108-"));
  const store = openStore(dataDir);
  const events = createEventBus();
  try {
    const bridge: BridgeHttp = await createHttpServer(stubHandle(events), {
      token: "t108-token",
      store,
      subscriptionsDir: dataDir,
    });
    const unauth = await fetch(`http://127.0.0.1:${bridge.port}/api/mcp-notify`, {
      headers: { authorization: "Bearer wrong" },
    });
    expect(unauth.status).toBe(401);
    const controller = new AbortController();
    const res = await fetch(`http://127.0.0.1:${bridge.port}/api/mcp-notify`, {
      headers: { authorization: "Bearer t108-token" },
      signal: controller.signal,
    });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/event-stream");
    const reader = res.body?.getReader();
    expect(reader).toBeTruthy();
    events.emit({
      type: "messages.upsert",
      payload: {
        messages: [
          {
            key: { remoteJid: "120363428874442773@g.us", fromMe: false, id: "E2" },
            message: { conversation: "hi" },
          },
        ],
        type: "notify",
      },
    } as never);
    const decoder = new TextDecoder();
    let buffered = "";
    let sawUnread = false;
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
    }
    controller.abort();
    expect(sawUnread).toBe(true);
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
