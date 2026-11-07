import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vite-plus/test";
import type { WAMessage } from "baileys";
import { DISPATCHED_SUBSCRIPTION_KINDS } from "@wa-mcp/shared";
import { openStore, type Store } from "../src/store/schema.ts";
import { storeMessage } from "../src/store/messages.ts";
import { createEventBus } from "../src/events.ts";
import { createHttpServer, type BridgeHttp } from "../src/http.ts";
import type { BridgeHandle } from "../src/lifecycle.ts";

const GROUP = "120363000000000001@g.us";
const DM = "358400000001@s.whatsapp.net";
const TEAMMATE = "358400000002@s.whatsapp.net";
const TOKEN = "t204-token";
const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

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
      user: { id: "358400000009:12@s.whatsapp.net", lid: "211111111111111:12@lid" },
      signalRepository: { lidMapping: { getPNForLID: async () => null } },
    },
  } as unknown as BridgeHandle;
}

/** engine shape: a reaction is a message whose content is reactionMessage,
 * its key.id naming the target; in a DM key.participant arrives empty */
function reaction(opts: {
  chat: string;
  id: string;
  participant: string;
  target: string;
  emote: string;
}): { type: "messages.upsert"; payload: { type: "notify"; messages: WAMessage[] } } {
  return {
    type: "messages.upsert",
    payload: {
      type: "notify",
      messages: [
        {
          key: { remoteJid: opts.chat, fromMe: false, id: opts.id, participant: opts.participant },
          pushName: "Teammate",
          message: {
            reactionMessage: {
              key: { remoteJid: opts.chat, fromMe: false, id: opts.target },
              text: opts.emote,
            },
          },
          messageTimestamp: Math.floor(Date.now() / 1000),
        } as WAMessage,
      ],
    },
  };
}

function seed(store: Store, chat: string, id: string, fromMe: boolean): void {
  storeMessage(store, {
    key: { remoteJid: chat, fromMe, id, ...(fromMe ? {} : { participant: TEAMMATE }) },
    message: { conversation: "earlier" },
    messageTimestamp: Math.floor(Date.now() / 1000) - 60,
  } as WAMessage);
}

async function withInbox(
  chat: string,
  run: (ctx: {
    store: Store;
    emit: (event: ReturnType<typeof reaction>) => Promise<void>;
    events: () => Array<Record<string, unknown>>;
  }) => Promise<void>,
): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), "t204-"));
  const store = openStore(dataDir);
  const bus = createEventBus();
  const bridge: BridgeHttp = await createHttpServer(stubHandle(bus), {
    token: TOKEN,
    store,
    subscriptionsDir: dataDir,
  });
  try {
    const created = await fetch(`http://127.0.0.1:${bridge.port}/api/subs2`, {
      method: "POST",
      headers,
      body: JSON.stringify({ name: "t204", chats: [chat], delivery: { mode: "inbox" } }),
    });
    const { inboxPath } = (await created.json()) as { inboxPath: string };
    await run({
      store,
      emit: async (event) => {
        bus.emit(event as never);
        await new Promise((resolve) => setTimeout(resolve, 80));
      },
      events: () =>
        readFileSync(join(dirname(inboxPath), "inbox.jsonl"), "utf8")
          .trim()
          .split("\n")
          .map((line) => JSON.parse(line) as Record<string, unknown>),
    });
  } finally {
    await bridge.close();
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

test("a reaction to our own message arrives as kind reaction with its target", async () => {
  await withInbox(GROUP, async ({ store, emit, events }) => {
    seed(store, GROUP, "BOTMSG", true);
    await emit(
      reaction({ chat: GROUP, id: "R1", participant: TEAMMATE, target: "BOTMSG", emote: "😢" }),
    );
    expect(events()).toHaveLength(1);
    expect(events()[0]).toMatchObject({
      kind: "reaction",
      chat: GROUP,
      from: TEAMMATE,
      fromName: "Teammate",
      id: "R1",
      emote: "😢",
      targetMessageId: "BOTMSG",
      targetFromMe: true,
      text: "",
      media: false,
    });
  });
});

test("a reaction to someone else's message says targetFromMe false", async () => {
  await withInbox(GROUP, async ({ store, emit, events }) => {
    seed(store, GROUP, "THEIRS", false);
    await emit(
      reaction({ chat: GROUP, id: "R2", participant: TEAMMATE, target: "THEIRS", emote: "👍" }),
    );
    expect(events()[0]).toMatchObject({ kind: "reaction", targetFromMe: false });
  });
});

test("a reaction to a message the bridge never stored omits targetFromMe", async () => {
  await withInbox(GROUP, async ({ emit, events }) => {
    await emit(
      reaction({ chat: GROUP, id: "R3", participant: TEAMMATE, target: "UNSEEN", emote: "😢" }),
    );
    expect(events()[0]).toMatchObject({ kind: "reaction", targetMessageId: "UNSEEN" });
    expect(events()[0]).not.toHaveProperty("targetFromMe");
  });
});

test("removing a reaction arrives with an empty emote", async () => {
  await withInbox(GROUP, async ({ store, emit, events }) => {
    seed(store, GROUP, "BOTMSG", true);
    await emit(
      reaction({ chat: GROUP, id: "R4", participant: TEAMMATE, target: "BOTMSG", emote: "" }),
    );
    expect(events()[0]).toMatchObject({ kind: "reaction", emote: "", targetFromMe: true });
  });
});

test("a DM reaction with an empty participant names the chat peer, in the event and the store", async () => {
  await withInbox(DM, async ({ store, emit, events }) => {
    seed(store, DM, "BOTDM", true);
    const event = reaction({ chat: DM, id: "R5", participant: "", target: "BOTDM", emote: "😢" });
    storeMessage(store, event.payload.messages[0] as WAMessage);
    await emit(event);
    expect(events()[0]).toMatchObject({ kind: "reaction", from: DM, targetFromMe: true });
    expect(
      store.db
        .prepare("SELECT sender_jid FROM reactions WHERE chat_jid = ? AND message_id = ?")
        .all(DM, "BOTDM"),
    ).toEqual([{ sender_jid: DM }]);
  });
});

test("an ordinary message stays kind message, with no reaction fields", async () => {
  await withInbox(GROUP, async ({ emit, events }) => {
    await emit({
      type: "messages.upsert",
      payload: {
        type: "notify",
        messages: [
          {
            key: { remoteJid: GROUP, fromMe: false, id: "M1", participant: TEAMMATE },
            message: { conversation: "hello" },
            messageTimestamp: Math.floor(Date.now() / 1000),
          } as WAMessage,
        ],
      },
    });
    expect(events()[0]).toMatchObject({ kind: "message", text: "hello" });
    expect(events()[0]).not.toHaveProperty("emote");
    expect(events()[0]).not.toHaveProperty("targetMessageId");
  });
});

test("reaction is a filterable dispatched kind", () => {
  expect(DISPATCHED_SUBSCRIPTION_KINDS).toContain("reaction");
});
