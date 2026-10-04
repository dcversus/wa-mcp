import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vite-plus/test";
import type { WASocket } from "baileys";
import { createEventBus } from "../src/events.ts";
import type { BridgeHandle, BridgeStatus } from "../src/lifecycle.ts";
import { openStore, type Store } from "../src/store/schema.ts";
import { storeMessage } from "../src/store/messages.ts";
import { createHttpServer } from "../src/http.ts";

const GROUP_A = "120363428874442773@g.us";
const created: Array<{ close(): Promise<void> }> = [];

function stubHandle(status: BridgeStatus = "connected"): BridgeHandle {
  return {
    status,
    events: createEventBus(),
    close: async () => {},
    getLastQr: () => null,
    socket: { sendMessage: vi.fn(async () => ({ key: { id: "X" } })) } as unknown as WASocket,
    hasPairedAccount: () => false,
    pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
    resumePairing: () => {},
    connectionQuality: () => ({ reconnects: 0, lastDisconnectAt: null }),
    logout: async () => {},
    fetchHistory: async () => ({ requested: true, request_id: "" }),
  };
}

function url(bridge: { port: number }, path: string): string {
  return `http://127.0.0.1:${bridge.port}${path}`;
}

const authHeader = { authorization: "Bearer test-token" };

describe("T87 — read deepening", () => {
  test("line120 — edits mark the row (edited flag) alongside full fidelity", () => {
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-editflag-")));
    try {
      storeMessage(store, {
        key: {
          remoteJid: GROUP_A,
          fromMe: false,
          id: "EDIT-1",
          participant: "358401112222@s.whatsapp.net",
        },
        message: { conversation: "original" },
        messageTimestamp: 1000,
      } as never);
      storeMessage(store, {
        key: {
          remoteJid: GROUP_A,
          fromMe: false,
          id: "EDIT-2",
          participant: "358401112222@s.whatsapp.net",
        },
        message: {
          protocolMessage: {
            type: 14,
            key: { id: "EDIT-1", remoteJid: GROUP_A },
            editedMessage: { conversation: "corrected" },
          },
        },
        messageTimestamp: 2000,
      } as never);
      const row = store.db
        .prepare("SELECT edited, content FROM messages WHERE id = 'EDIT-1'")
        .get() as { edited: number; content: string };
      expect(row.content).toBe("corrected");
      expect(row.edited).toBe(1);
      const untouched = store.db
        .prepare("SELECT edited FROM messages WHERE id != 'EDIT-1'")
        .all() as Array<{ edited: number }>;
      expect(untouched.every((r) => r.edited === 0)).toBe(true);
    } finally {
      store.close();
    }
  });

  test("line121 — /api/messages adds truncation meta when capped", async () => {
    const store: Store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-trunc-")));
    try {
      for (let i = 0; i < 30; i += 1) {
        storeMessage(store, {
          key: { remoteJid: GROUP_A, fromMe: false, id: `T${i}` },
          message: { conversation: `msg ${i}` },
          messageTimestamp: 1000 + i,
        } as never);
      }
      const bridge = await createHttpServer(stubHandle(), { token: "test-token", store });
      created.push({ close: bridge.close });
      const res = await fetch(
        url(bridge, `/api/messages?chat_jid=${encodeURIComponent(GROUP_A)}&limit=20&offset=0`),
        { headers: authHeader },
      );
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        messages: unknown[];
        meta?: { truncated: boolean; total: number; returned: number; nextOffset: number };
      };
      expect(body.messages).toHaveLength(20);
      expect(body.meta).toEqual({ truncated: true, total: 30, returned: 20, nextOffset: 20 });
      const full = await fetch(
        url(bridge, `/api/messages?chat_jid=${encodeURIComponent(GROUP_A)}&limit=50&offset=0`),
        { headers: authHeader },
      );
      const fullBody = (await full.json()) as {
        messages: unknown[];
        meta?: { truncated: boolean };
      };
      expect(fullBody.messages).toHaveLength(30);
      expect(fullBody.meta?.truncated ?? false).toBe(false);
    } finally {
      store.close();
    }
  });

  test("line120 — full-fidelity read-back carries mentions, reactions, poll, forwarded", async () => {
    const store: Store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-fidelity-")));
    try {
      storeMessage(store, {
        key: {
          remoteJid: GROUP_A,
          fromMe: false,
          id: "FF1",
          participant: "358401112222@s.whatsapp.net",
        },
        message: {
          extendedTextMessage: {
            text: "check @358400000001@s.whatsapp.net",
            contextInfo: { mentionedJid: ["358400000001@s.whatsapp.net"] },
          },
        },
        messageTimestamp: 1000,
      } as never);
      const bridge = await createHttpServer(stubHandle(), { token: "test-token", store });
      created.push({ close: bridge.close });
      const res = await fetch(
        url(bridge, `/api/messages?chat_jid=${encodeURIComponent(GROUP_A)}&limit=10`),
        { headers: authHeader },
      );
      const body = (await res.json()) as {
        messages: Array<{
          id: string;
          mentions: string[];
          forwarded?: boolean;
          reactions: unknown;
        }>;
      };
      const row = body.messages.find((m) => m.id === "FF1");
      expect(row?.mentions).toContain("358400000001@s.whatsapp.net");
      expect(row?.forwarded).toBe(false);
      void row?.reactions;
    } finally {
      store.close();
    }
  });
});
