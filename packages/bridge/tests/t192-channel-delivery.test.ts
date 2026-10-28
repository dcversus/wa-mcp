import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openStore, type Store } from "../src/store/schema.ts";
import { createHttpServer, type BridgeHttp } from "../src/http.ts";
import { createEventBus } from "../src/events.ts";
import type { BridgeHandle, BridgeStatus } from "../src/lifecycle.ts";
import { buildChannelNotification, type ChannelNotification } from "../src/subs-dispatch.ts";
import type { InboxEvent } from "../src/inbox.ts";
import type { SubscriptionConfig } from "@wa-mcp/shared";
import type { WASocket } from "baileys";

const authHeader = { authorization: "Bearer test-token" };

function stubHandle(status: BridgeStatus = "connected"): BridgeHandle {
  return {
    status,
    events: createEventBus(),
    close: async () => {},
    getLastQr: () => null,
    socket: {} as unknown as WASocket,
    hasPairedAccount: () => false,
    pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
    connectionQuality: () => ({ reconnects: 0, lastDisconnectAt: null }),
    fetchHistory: async () => ({ requested: true, request_id: "" }),
    contactsWarm: () => false,
    logout: async () => {},
    resumePairing: () => undefined,
  } as unknown as BridgeHandle;
}

function url(bridge: BridgeHttp, path: string): string {
  return `http://127.0.0.1:${bridge.port}${path}`;
}

test("T192 — buildChannelNotification shapes the Claude Code channel contract", () => {
  const config = {
    id: "sub1",
    delivery: { mode: "channel", agentName: "claude-code" },
    prompt: "answer briefly",
  } as unknown as SubscriptionConfig;
  const event: InboxEvent = {
    ts: "2026-10-25T10:00:00.000Z",
    kind: "message",
    chat: "120363428874442773@g.us",
    chatName: "Test group",
    from: "358497773518@s.whatsapp.net",
    fromName: "Vasilisa",
    fromMe: false,
    id: "MSG1",
    text: "hello channel",
    media: false,
    subId: "sub1",
  };
  const frame = buildChannelNotification(config, event);
  expect(frame.method).toBe("notifications/claude/channel");
  expect(frame.params.content).toBe("Vasilisa: hello channel");
  expect(frame.params.meta).toMatchObject({
    chat_id: "120363428874442773@g.us",
    chat_type: "group",
    message_id: "MSG1",
    user: "Vasilisa",
    user_id: "358497773518@s.whatsapp.net",
    ts: "2026-10-25T10:00:00.000Z",
    subscription_id: "sub1",
    agent: "claude-code",
    prompt: "answer briefly",
  });
});

test("T192 — media messages become an actionable placeholder", () => {
  const config = { id: "sub2", delivery: { mode: "channel" } } as unknown as SubscriptionConfig;
  const event: InboxEvent = {
    ts: "2026-10-25T10:00:00.000Z",
    kind: "message",
    chat: "351930017568@s.whatsapp.net",
    from: "351930017568@s.whatsapp.net",
    fromName: null,
    fromMe: false,
    text: "",
    media: true,
    subId: "sub2",
  };
  const frame = buildChannelNotification(config, event);
  expect(frame.params.content).toContain("[media message");
  expect((frame.params.meta as Record<string, unknown>).chat_type).toBe("dm");
  expect((frame.params.meta as Record<string, unknown>).agent).toBeUndefined();
});

test(
  "T192 — a channel subscription's inbound message streams on /api/mcp-notify",
  { timeout: 15000 },
  async () => {
    const dir = mkdtempSync(join(tmpdir(), "t192-channel-"));
    const store: Store = openStore(dir);
    const handle = stubHandle();
    const bridge = await createHttpServer(handle, {
      token: "test-token",
      store,
      subscriptionsDir: join(dir, "subs"),
    });
    // create a channel subscription through the public API
    const created = await fetch(url(bridge, "/api/subs2"), {
      method: "POST",
      headers: { ...authHeader, "content-type": "application/json" },
      body: JSON.stringify({
        name: "chan",
        chats: ["120363428874442773@g.us"],
        filter: {},
        delivery: { mode: "channel", agentName: "claude-code" },
      }),
    });
    expect(created.status).toBe(201);
    const sub = (await created.json()) as { id: string };
    expect(typeof sub.id).toBe("string");

    // open the SSE stream, then drive an inbound message through the bus
    const controller = new AbortController();
    const sse = await fetch(url(bridge, "/api/mcp-notify"), {
      headers: authHeader,
      signal: controller.signal,
    });
    const reader = sse.body!.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    const frames: ChannelNotification[] = [];
    const pump = (async () => {
      for (;;) {
        const chunk = await reader.read();
        if (chunk.done) break;
        buffered += decoder.decode(chunk.value, { stream: true });
        const parts = buffered.split("\n\n");
        buffered = parts.pop() ?? "";
        for (const part of parts) {
          const line = part.split("\n").find((l) => l.startsWith("data: "));
          if (line === undefined) continue;
          try {
            frames.push(JSON.parse(line.slice(6)) as ChannelNotification);
          } catch {
            // non-JSON frame
          }
        }
      }
    })();

    handle.events.emit({
      type: "messages.upsert",
      payload: {
        messages: [
          {
            key: {
              remoteJid: "120363428874442773@g.us",
              id: "CHMSG1",
              fromMe: false,
              participant: "358497773518@s.whatsapp.net",
            },
            message: { conversation: "stream me" },
            messageTimestamp: 1_767_228_300,
          },
        ],
        type: "notify",
      },
    });

    await new Promise<void>((resolve) => {
      const started = Date.now();
      const check = () => {
        if (frames.some((f) => f.method === "notifications/claude/channel")) resolve();
        else if (Date.now() - started > 10_000) resolve();
        else setTimeout(check, 100);
      };
      check();
    });
    controller.abort();
    await pump.catch(() => undefined);
    const channel = frames.find((f) => f.method === "notifications/claude/channel");
    expect(channel).toBeDefined();
    expect(channel?.params.content).toContain("stream me");
    expect((channel?.params.meta as Record<string, unknown> | undefined)?.subscription_id).toBe(
      sub.id,
    );
    await bridge.close();
  },
);
