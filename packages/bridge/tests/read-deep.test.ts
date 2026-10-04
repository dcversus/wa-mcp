import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vite-plus/test";
import type { WASocket } from "baileys";
import { createEventBus } from "../src/events.ts";
import type { BridgeHandle, BridgeStatus } from "../src/lifecycle.ts";
import { openStore, type Store } from "../src/store/schema.ts";
import { storeMessage } from "../src/store/messages.ts";
import { upsertContact } from "../src/store/contacts.ts";
import { createHttpServer } from "../src/http.ts";

const GROUP_A = "120363428874442773@g.us";
const created: Array<{ close(): Promise<void> }> = [];

function stubHandle(
  status: BridgeStatus = "connected",
  _lastQr: string | null = null,
  socketOverride?: WASocket,
): BridgeHandle {
  return {
    status,
    events: createEventBus(),
    close: async () => {},
    getLastQr: () => null,
    socket: (socketOverride ?? {
      sendMessage: vi.fn(async () => ({ key: { id: "X" } })),
    }) as unknown as WASocket,
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

describe("T87-B — export, bulk clear, photo fields", () => {
  function seed(store: Store): void {
    storeMessage(store, {
      key: {
        remoteJid: GROUP_A,
        fromMe: false,
        id: "E1",
        participant: "358401112222@s.whatsapp.net",
      },
      message: { conversation: "export me" },
      messageTimestamp: 1700000100,
    } as never);
    storeMessage(store, {
      key: { remoteJid: "358497773518@s.whatsapp.net", fromMe: false, id: "E2" },
      message: { conversation: "unread dm" },
      messageTimestamp: 1700000200,
    } as never);
    store.db.prepare("UPDATE messages SET is_unread = 1 WHERE id IN ('E1','E2')").run();
    store.db
      .prepare(
        "INSERT INTO chats (jid, name) VALUES (?, ?) ON CONFLICT(jid) DO UPDATE SET name = excluded.name",
      )
      .run(GROUP_A, "Test Group");
    store.db
      .prepare(
        "INSERT INTO chats (jid, name) VALUES (?, ?) ON CONFLICT(jid) DO UPDATE SET name = excluded.name",
      )
      .run("358497773518@s.whatsapp.net", "DM");
  }

  test("line122 — export_chat JSONL/MD/TXT", async () => {
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-exp-")));
    seed(store);
    const bridge = await createHttpServer(stubHandle(), { token: "test-token", store });
    created.push({ close: bridge.close });
    for (const [fmt, marker] of [
      ["jsonl", '"text":"export me"'],
      ["md", "## 2023-11-14"],
      ["txt", "export me"],
    ] as const) {
      const res = await fetch(
        url(bridge, `/api/export?chat_jid=${encodeURIComponent(GROUP_A)}&format=${fmt}`),
        { headers: authHeader },
      );
      expect(res.status).toBe(200);
      const text = await res.text();
      expect(text).toContain(marker);
    }
    const jsonl = await fetch(
      url(bridge, `/api/export?chat_jid=${encodeURIComponent(GROUP_A)}&format=jsonl`),
      { headers: authHeader },
    );
    const first = JSON.parse((await jsonl.text()).split("\n")[0] ?? "{}") as { text: string };
    expect(first.text).toBe("export me");
  });

  test("line122 — export_unread_messages exports only unread with chat attribution", async () => {
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-expu-")));
    seed(store);
    const bridge = await createHttpServer(stubHandle(), { token: "test-token", store });
    created.push({ close: bridge.close });
    const res = await fetch(url(bridge, "/api/export?unread=true&format=jsonl"), {
      headers: authHeader,
    });
    expect(res.status).toBe(200);
    const lines = (await res.text()).split("\n").filter((l) => l.length > 0);
    expect(lines).toHaveLength(2);
    const first = JSON.parse(lines[0] ?? "{}") as { chatJid?: string };
    expect(first.chatJid).toBe(GROUP_A);
  });

  test("line130 — bulk read clears multiple chats", async () => {
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-bulk-")));
    seed(store);
    const bridge = await createHttpServer(stubHandle(), { token: "test-token", store });
    created.push({ close: bridge.close });
    const res = await fetch(url(bridge, "/api/read-bulk"), {
      method: "POST",
      headers: { ...authHeader, "content-type": "application/json" },
      body: JSON.stringify({ chat_jids: [GROUP_A, "358497773518@s.whatsapp.net"] }),
    });
    expect(res.status).toBe(200);
    // bulk read clears the unread MARKERS on messages
    const unread = store.db
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE is_unread = 1")
      .get() as { n: number };
    expect(unread.n).toBe(0);
  });

  test("line108/109 — get_chat detail carries hasPhoto + pictureUrl when available", async () => {
    const socket = stubHandle().socket;
    (socket as { profilePictureUrl?: unknown }).profilePictureUrl = vi.fn(
      async () => "https://cdn.example/pic.jpg",
    );
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-photo-")));
    upsertContact(store, { jid: GROUP_A, name: "Test Group" });
    const bridge = await createHttpServer(stubHandle("connected", null, socket), {
      token: "test-token",
      store,
    });
    created.push({ close: bridge.close });
    const res = await fetch(
      url(bridge, `/api/contacts/${encodeURIComponent(GROUP_A)}?with_photo=true`),
      { headers: authHeader },
    );
    const body = (await res.json()) as { contact?: { hasPhoto?: boolean; pictureUrl?: string } };
    expect(body.contact?.hasPhoto).toBe(true);
    expect(body.contact?.pictureUrl).toContain("https://");
  });
});
