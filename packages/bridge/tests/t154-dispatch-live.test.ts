import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openStore } from "../src/store/schema.ts";
import type { BaileysEventMap } from "baileys";
import { createEventBus } from "../src/events.ts";
import { createHttpServer, type BridgeHttp } from "../src/http.ts";
import { createRule } from "../src/notifications.ts";
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
    socket: {
      signalRepository: {
        lidMapping: {
          getPNForLID: async (lid: string) =>
            lid.startsWith("999") ? "358400000001@s.whatsapp.net" : null,
        },
      },
    },
  } as unknown as BridgeHandle;
}

function url(bridge: BridgeHttp, path: string): string {
  return `http://127.0.0.1:${bridge.port}${path}`;
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

async function subscribe(bridge: BridgeHttp, chatJid: string): Promise<string> {
  const created = await fetch(url(bridge, "/api/subs2"), {
    method: "POST",
    headers: auth("t154-token"),
    body: JSON.stringify({ name: "t154", chats: [chatJid], delivery: { mode: "inbox" } }),
  });
  const body = (await created.json()) as { inboxPath: string };
  return body.inboxPath;
}

function upsert(
  remoteJid: string,
  text: string,
  opts: { fromMe?: boolean; type?: string; id?: string; pushName?: string } = {},
): {
  type: "messages.upsert";
  payload: BaileysEventMap["messages.upsert"] & { pushName?: string | null };
} {
  return {
    type: "messages.upsert",
    payload: {
      type: opts.type === "append" ? ("append" as const) : ("notify" as const),
      pushName: opts.pushName,
      messages: [
        {
          key: {
            remoteJid,
            fromMe: opts.fromMe ?? false,
            id: opts.id ?? "3EB154TEST",
            ...(opts.fromMe === true ? {} : { participant: "358400000002@s.whatsapp.net" }),
          },
          message: { conversation: text },
          messageTimestamp: 1791156862,
        },
      ],
    },
  };
}

test("T154 W1 — a live notify from another person reaches the inbox", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t154-"));
  const store = openStore(dataDir);
  const events = createEventBus();
  try {
    const bridge = await createHttpServer(stubHandle(events), {
      token: "t154-token",
      store,
      subscriptionsDir: dataDir,
    });
    const inboxPath = await subscribe(bridge, "120363428874442773@g.us");
    events.emit(upsert("120363428874442773@g.us", "ping from Dana"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const lines = readFileSync(inboxPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] as string) as { kind: string; text: string };
    expect(line.kind).toBe("message");
    expect(line.text).toBe("ping from Dana");
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T154 W1 — the agent's own sends never land in the inbox", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t154-"));
  const store = openStore(dataDir);
  const events = createEventBus();
  try {
    const bridge = await createHttpServer(stubHandle(events), {
      token: "t154-token",
      store,
      subscriptionsDir: dataDir,
    });
    const inboxPath = await subscribe(bridge, "120363428874442773@g.us");
    events.emit(
      upsert("120363428874442773@g.us", "my own reply", { fromMe: true, type: "append" }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(existsSync(inboxPath)).toBe(true);
    expect(readFileSync(inboxPath, "utf8").trim()).toBe("");
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T154 W1 — notification rules are evaluated for notify traffic", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t154-"));
  const store = openStore(dataDir);
  const events = createEventBus();
  try {
    const bridge = await createHttpServer(stubHandle(events), {
      token: "t154-token",
      store,
      subscriptionsDir: dataDir,
    });
    const inboxPath = await subscribe(bridge, "120363428874442773@g.us");
    const subs = (await (
      await fetch(url(bridge, "/api/subs2"), {
        headers: auth("t154-token"),
      })
    ).json()) as { subscriptions: Array<{ id: string }> };
    createRule(store, {
      title: "group ping",
      body: "new message",
      chatJid: "120363428874442773@g.us",
      deliver: ["file"],
      subId: subs.subscriptions[0]?.id as string,
    });
    events.emit(upsert("120363428874442773@g.us", "rule probe"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const lines = readFileSync(inboxPath, "utf8").trim().split("\n");
    const kinds = lines.map((line) => (JSON.parse(line) as { kind: string }).kind);
    expect(kinds).toContain("rule");
    expect(kinds).toContain("message");
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T154 W2 — an @lid chat is canonicalized before matching", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t154-"));
  const store = openStore(dataDir);
  const events = createEventBus();
  try {
    const bridge = await createHttpServer(stubHandle(events), {
      token: "t154-token",
      store,
      subscriptionsDir: dataDir,
    });
    const inboxPath = await subscribe(bridge, "358400000001@s.whatsapp.net");
    events.emit(upsert("999555000111@lid", "lid traffic"));
    await new Promise((resolve) => setTimeout(resolve, 50));
    const lines = readFileSync(inboxPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] as string) as { chat: string; from: string };
    expect(line.chat).toBe("358400000001@s.whatsapp.net");
    expect(line.from).toBe("358400000002@s.whatsapp.net");
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T154 W1b — an old backlog append without fromMe is not re-delivered (age gate)", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t154-"));
  const store = openStore(dataDir);
  const events = createEventBus();
  try {
    const bridge = await createHttpServer(stubHandle(events), {
      token: "t154-token",
      store,
      subscriptionsDir: dataDir,
    });
    const inboxPath = await subscribe(bridge, "120363428874442773@g.us");
    events.emit({
      type: "messages.upsert",
      payload: {
        type: "append",
        messages: [
          {
            key: { remoteJid: "120363428874442773@g.us", id: "OLDSYNC" },
            message: { conversation: "old own message" },
            messageTimestamp: 1_759_000_000,
          },
        ],
      },
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(readFileSync(inboxPath, "utf8").trim()).toBe("");
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T154 W1b — backlog newer than the subscription still delivers on append", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t154-"));
  const store = openStore(dataDir);
  const events = createEventBus();
  try {
    const bridge = await createHttpServer(stubHandle(events), {
      token: "t154-token",
      store,
      subscriptionsDir: dataDir,
    });
    const inboxPath = await subscribe(bridge, "120363428874442773@g.us");
    events.emit({
      type: "messages.upsert",
      payload: {
        type: "append",
        messages: [
          {
            key: {
              remoteJid: "120363428874442773@g.us",
              fromMe: false,
              id: "NEWBACKLOG",
              participant: "358400000002@s.whatsapp.net",
            },
            message: { conversation: "genuine backlog" },
            messageTimestamp: Math.floor(Date.now() / 1000) + 60,
          },
        ],
      },
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const lines = readFileSync(inboxPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    expect((JSON.parse(lines[0] as string) as { id?: string }).id).toBe("NEWBACKLOG");
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T154 W1b — the age gate is append-only: an old notify still delivers", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t154-"));
  const store = openStore(dataDir);
  const events = createEventBus();
  try {
    const bridge = await createHttpServer(stubHandle(events), {
      token: "t154-token",
      store,
      subscriptionsDir: dataDir,
    });
    const inboxPath = await subscribe(bridge, "120363428874442773@g.us");
    events.emit({
      type: "messages.upsert",
      payload: {
        type: "notify",
        messages: [
          {
            key: {
              remoteJid: "120363428874442773@g.us",
              fromMe: false,
              id: "OLDNOTIFY",
              participant: "358400000002@s.whatsapp.net",
            },
            message: { conversation: "old ts live" },
            messageTimestamp: 1_759_000_000,
          },
        ],
      },
    } as never);
    await new Promise((resolve) => setTimeout(resolve, 50));
    const lines = readFileSync(inboxPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T154 W2 — the inbox line carries id, names and fromMe", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t154-"));
  const store = openStore(dataDir);
  const events = createEventBus();
  try {
    store.db
      .prepare("INSERT INTO chats (jid, name) VALUES (?, ?)")
      .run("120363428874442773@g.us", "Test group");
    store.db
      .prepare("INSERT INTO contacts (jid, name) VALUES (?, ?)")
      .run("358400000002@s.whatsapp.net", "Dana");
    const bridge = await createHttpServer(stubHandle(events), {
      token: "t154-token",
      store,
      subscriptionsDir: dataDir,
    });
    const inboxPath = await subscribe(bridge, "120363428874442773@g.us");
    events.emit(
      upsert("120363428874442773@g.us", "who said it", {
        id: "3EBENRICH",
        pushName: "Dana P",
      }),
    );
    await new Promise((resolve) => setTimeout(resolve, 50));
    const lines = readFileSync(inboxPath, "utf8").trim().split("\n");
    expect(lines).toHaveLength(1);
    const line = JSON.parse(lines[0] as string) as {
      id?: string;
      chatName?: string | null;
      fromName?: string | null;
      fromMe?: boolean;
    };
    expect(line.id).toBe("3EBENRICH");
    expect(line.chatName).toBe("Test group");
    expect(line.fromName).toBe("Dana P");
    expect(line.fromMe).toBe(false);
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});
