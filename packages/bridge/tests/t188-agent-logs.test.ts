import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import type { WAMessage, WASocket } from "baileys";
import { openStore, type Store } from "../src/store/schema.ts";
import { storeMessage } from "../src/store/messages.ts";
import { searchMessages } from "../src/store/queries.ts";
import { listAgentActivity, recordAgentActivity } from "../src/store/agent-activity.ts";
import { sendViaSocket } from "../src/send/send.ts";
import { SendGuard } from "../src/send/safety.ts";
import { currentSendSource, withSendSource } from "../src/send/source.ts";
import { createSubsDispatcher } from "../src/subs-dispatch.ts";
import { createEventBus } from "../src/events.ts";
import { createHttpServer, type BridgeHttp } from "../src/http.ts";
import type { BridgeHandle } from "../src/lifecycle.ts";

const TOKEN = "t188-token";
const GROUP = "120363428874442773@g.us";
const DM = "358401112222@s.whatsapp.net";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) {
    await fn();
  }
});

function tempDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function makeStore(): Store {
  const store = openStore(tempDir("t188-store-"));
  cleanups.push(() => store.close());
  return store;
}

function seed(store: Store, id: string, chatJid: string, seconds: number, fromMe = false): void {
  storeMessage(store, {
    key: { remoteJid: chatJid, fromMe, id, participant: fromMe ? undefined : DM },
    message: { conversation: `text ${id}` },
    messageTimestamp: seconds,
  } as unknown as WAMessage);
}

function ids(rows: Array<{ id: string }>): string[] {
  return rows.map((row) => row.id);
}

function fakeSocket(): WASocket {
  let seq = 0;
  return {
    user: { id: "358497773518:1@s.whatsapp.net" },
    sendMessage: async (jid: string, content: { text?: string }) => {
      seq += 1;
      return {
        key: { id: `SENT${seq}`, remoteJid: jid, fromMe: true },
        message: { conversation: content.text ?? "" },
        messageTimestamp: 1_000 + seq,
      };
    },
  } as unknown as WASocket;
}

test("T188 P2 — send source context is scoped to its callback", async () => {
  expect(currentSendSource()).toBeUndefined();
  const seen = await withSendSource("codex", async () => {
    await Promise.resolve();
    return currentSendSource();
  });
  expect(seen).toBe("codex");
  expect(currentSendSource()).toBeUndefined();
});

test("T188 P2 — a send inside a source context is attributed durably", async () => {
  const store = makeStore();
  const socket = fakeSocket();
  await withSendSource("codex", () => sendViaSocket(socket, DM, { text: "hi" }, { store }));
  await sendViaSocket(socket, DM, { text: "no context" }, { store });
  expect(listAgentActivity(store)).toEqual([
    expect.objectContaining({
      kind: "send",
      source: "codex",
      subId: null,
      chatJid: DM,
      messageId: "SENT1",
    }),
  ]);
});

test("T188 P2 — the subscription dispatcher records every delivery with its subscription", () => {
  const store = makeStore();
  const dir = tempDir("t188-subs-");
  store.db
    .prepare(
      "INSERT INTO subscription_configs (id, name, chats, filter, delivery, enabled, created) VALUES (?, ?, ?, '{}', ?, 1, ?)",
    )
    .run("sub-a", "Team", JSON.stringify([GROUP]), '{"mode":"inbox"}', "2026-01-01T00:00:00.000Z");
  const dispatcher = createSubsDispatcher({
    store,
    subscriptionsDir: dir,
    ownJids: () => [],
    spawnFn: (() => undefined) as never,
    now: () => new Date("2026-10-08T10:00:00.000Z"),
  });
  const base = {
    chatJid: GROUP,
    rawChatJid: GROUP,
    fromJid: DM,
    chatName: null,
    fromName: null,
    text: "hello",
    media: false,
    mentionedJids: [],
    backlogTsMs: null,
  };
  expect(dispatcher.dispatch({ ...base, id: "IN1" })).toBe(1);
  expect(dispatcher.dispatch({ ...base })).toBe(1);
  expect(listAgentActivity(store)).toEqual([
    {
      kind: "delivery",
      source: null,
      subId: "sub-a",
      chatJid: GROUP,
      messageId: "IN1",
      ts: "2026-10-08T10:00:00.000Z",
    },
  ]);
});

test("T188 P2 — searchMessages agent filter = attributed sends + linked subscription deliveries", () => {
  const store = makeStore();
  seed(store, "D1", GROUP, 1000);
  seed(store, "S1", DM, 2000, true);
  seed(store, "S2", DM, 3000, true);
  seed(store, "X1", GROUP, 4000);
  recordAgentActivity(store, {
    kind: "delivery",
    source: null,
    subId: "sub-a",
    chatJid: GROUP,
    messageId: "D1",
  });
  recordAgentActivity(store, {
    kind: "send",
    source: "codex",
    subId: null,
    chatJid: DM,
    messageId: "S1",
  });
  recordAgentActivity(store, {
    kind: "send",
    source: "ui",
    subId: null,
    chatJid: DM,
    messageId: "S2",
  });
  expect(ids(searchMessages(store, "", { agent: { sources: ["codex"], subIds: [] } }))).toEqual([
    "S1",
  ]);
  expect(
    ids(searchMessages(store, "", { agent: { sources: ["codex"], subIds: ["sub-a"] } })),
  ).toEqual(["S1", "D1"]);
  expect(ids(searchMessages(store, "", { agent: { sources: [], subIds: [] } }))).toEqual([]);
  expect(
    ids(
      searchMessages(store, "text", { agent: { sources: ["ui"], subIds: [] }, direction: "out" }),
    ),
  ).toEqual(["S2"]);
});

function stubHandle(socket: WASocket): BridgeHandle {
  return {
    status: "connected",
    events: createEventBus(),
    close: async () => {},
    getLastQr: () => null,
    hasPairedAccount: () => true,
    pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
    resumePairing: () => {},
    connectionQuality: () => ({ reconnects: 0, lastDisconnectAt: null }),
    logout: async () => {},
    fetchHistory: async () => ({ requested: false, request_id: "" }),
    contactsWarm: () => true,
    socket,
  } as unknown as BridgeHandle;
}

function seedHome(): string {
  const home = tempDir("t188-home-");
  const inbox = join(home, ".wa-mcp", "subs", "sub-a", "inbox.jsonl");
  const path = join(home, ".claude", "settings.json");
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(
    path,
    JSON.stringify({
      hooks: {
        FileChanged: [
          {
            matcher: inbox,
            hooks: [{ type: "command", command: `wa-mcp inbox drain --inbox ${inbox}` }],
          },
        ],
      },
    }),
  );
  return home;
}

async function boot(store: Store, home: string): Promise<BridgeHttp> {
  const bridge = await createHttpServer(stubHandle(fakeSocket()), {
    token: TOKEN,
    store,
    homeDir: home,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 1000 }),
  });
  cleanups.push(() => bridge.close());
  return bridge;
}

function post(bridge: BridgeHttp, text: string, agent?: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${bridge.port}/api/send`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "application/json",
      ...(agent === undefined ? {} : { "x-wa-agent": agent }),
    },
    body: JSON.stringify({ chat_jid: DM, text }),
  });
}

async function search(
  bridge: BridgeHttp,
  query: string,
): Promise<{ status: number; ids: string[] }> {
  const res = await fetch(`http://127.0.0.1:${bridge.port}/api/search${query}`, {
    headers: { authorization: `Bearer ${TOKEN}` },
  });
  const body = (await res.json()) as { messages?: Array<{ id: string }> };
  return { status: res.status, ids: ids(body.messages ?? []) };
}

test("T188 P2 — HTTP sends carry the MCP client from x-wa-agent; UI sends are 'ui'", async () => {
  const store = makeStore();
  const bridge = await boot(store, seedHome());
  expect((await post(bridge, "from codex", "codex")).status).toBe(200);
  expect((await post(bridge, "from the web ui")).status).toBe(200);
  expect((await post(bridge, "bad header", "Codex Desktop!")).status).toBe(200);
  expect(listAgentActivity(store).map((row) => [row.source, row.messageId])).toEqual([
    ["codex", "SENT1"],
    ["ui", "SENT2"],
    ["ui", "SENT3"],
  ]);
});

test("T188 P2 — /api/search?agent= resolves the agent's sends and its linked subscriptions", async () => {
  const store = makeStore();
  const bridge = await boot(store, seedHome());
  seed(store, "D1", GROUP, 10);
  seed(store, "X1", GROUP, 20);
  recordAgentActivity(store, {
    kind: "delivery",
    source: null,
    subId: "sub-a",
    chatJid: GROUP,
    messageId: "D1",
  });
  await post(bridge, "from codex", "codex");
  await post(bridge, "from claude", "claude-code");
  expect((await search(bridge, "?agent=codex")).ids).toEqual(["SENT1"]);
  expect((await search(bridge, "?agent=claude-code")).ids).toEqual(["SENT2", "D1"]);
  expect((await search(bridge, "?agent=claude-code&direction=in")).ids).toEqual(["D1"]);
  expect((await search(bridge, "?agent=grok")).ids).toEqual([]);
  expect((await search(bridge, "?agent=Not%20A%20Slug")).status).toBe(400);
});
