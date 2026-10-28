import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vite-plus/test";
import type { WAMessage } from "baileys";
import { openStore, type Store } from "../src/store/schema.ts";
import { storeMessage } from "../src/store/messages.ts";
import { createEventBus } from "../src/events.ts";
import { createHttpServer, type BridgeHttp } from "../src/http.ts";
import type { BridgeHandle } from "../src/lifecycle.ts";
import { replyContext } from "../src/ingest/extract.ts";

const GROUP = "120363428874442773@g.us";
const OWN_PN = "351930017568@s.whatsapp.net";
const OWN_LID = "211111111111111@lid";
const TEAMMATE = "358400000002@s.whatsapp.net";
const TOKEN = "t196-token";

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
      // engine shape: own ids carry a device suffix
      user: { id: "351930017568:12@s.whatsapp.net", lid: "211111111111111:12@lid" },
      signalRepository: { lidMapping: { getPNForLID: async () => null } },
    },
  } as unknown as BridgeHandle;
}

function url(bridge: BridgeHttp, path: string): string {
  return `http://127.0.0.1:${bridge.port}${path}`;
}

const headers = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

async function subscribe(
  bridge: BridgeHttp,
  chat: string,
  delivery: Record<string, unknown>,
): Promise<{ id: string; dir: string }> {
  const created = await fetch(url(bridge, "/api/subs2"), {
    method: "POST",
    headers,
    body: JSON.stringify({ name: `t196-${String(delivery.mode)}`, chats: [chat], delivery }),
  });
  const body = (await created.json()) as { id: string; inboxPath: string };
  return { id: body.id, dir: dirname(body.inboxPath) };
}

/** engine shape: pushName rides the MESSAGE (decode-wa-message.js), the
 * reply context rides contextInfo on the content */
function inbound(opts: {
  chat: string;
  id: string;
  participant?: string;
  text: string;
  pushName?: string;
  quoted?: { stanzaId: string; participant?: string };
  mentions?: string[];
}): { type: "messages.upsert"; payload: { type: "notify"; messages: WAMessage[] } } {
  const contextInfo =
    opts.quoted !== undefined || opts.mentions !== undefined
      ? {
          ...(opts.quoted !== undefined
            ? {
                stanzaId: opts.quoted.stanzaId,
                ...(opts.quoted.participant !== undefined
                  ? { participant: opts.quoted.participant }
                  : {}),
                quotedMessage: { conversation: "earlier" },
              }
            : {}),
          ...(opts.mentions !== undefined ? { mentionedJid: opts.mentions } : {}),
        }
      : undefined;
  return {
    type: "messages.upsert",
    payload: {
      type: "notify",
      messages: [
        {
          key: {
            remoteJid: opts.chat,
            fromMe: false,
            id: opts.id,
            ...(opts.participant !== undefined ? { participant: opts.participant } : {}),
          },
          ...(opts.pushName !== undefined ? { pushName: opts.pushName } : {}),
          message:
            contextInfo === undefined
              ? { conversation: opts.text }
              : { extendedTextMessage: { text: opts.text, contextInfo } },
          messageTimestamp: Math.floor(Date.now() / 1000),
        } as WAMessage,
      ],
    },
  };
}

function seedOwnMessage(store: Store, chat: string, id: string): void {
  storeMessage(store, {
    key: { remoteJid: chat, fromMe: true, id },
    message: { conversation: "the bot's answer" },
    messageTimestamp: Math.floor(Date.now() / 1000) - 60,
  } as WAMessage);
}

function lastLine(path: string): Record<string, unknown> {
  const lines = readFileSync(path, "utf8").trim().split("\n");
  return JSON.parse(lines[lines.length - 1] as string) as Record<string, unknown>;
}

async function settle(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 80));
}

async function withBridge(
  run: (ctx: {
    bridge: BridgeHttp;
    store: Store;
    events: ReturnType<typeof createEventBus>;
  }) => Promise<void>,
): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), "t196-"));
  const store = openStore(dataDir);
  const events = createEventBus();
  const bridge = await createHttpServer(stubHandle(events), {
    token: TOKEN,
    store,
    subscriptionsDir: dataDir,
  });
  try {
    await run({ bridge, store, events });
  } finally {
    await bridge.close();
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

test("#241 — replyContext reads stanzaId, participant and mentions through wrappers", () => {
  const plain = replyContext({
    key: { remoteJid: GROUP, id: "A" },
    message: {
      extendedTextMessage: {
        text: "hi",
        contextInfo: { stanzaId: "Q1", participant: OWN_PN, mentionedJid: [OWN_PN] },
      },
    },
  } as WAMessage);
  expect(plain).toEqual({
    quotedMessageId: "Q1",
    quotedParticipant: OWN_PN,
    mentionedJids: [OWN_PN],
  });
  const wrapped = replyContext({
    key: { remoteJid: GROUP, id: "B" },
    message: {
      ephemeralMessage: {
        message: {
          imageMessage: { caption: "look", contextInfo: { stanzaId: "Q2", participant: TEAMMATE } },
        },
      },
    },
  } as WAMessage);
  expect(wrapped).toEqual({
    quotedMessageId: "Q2",
    quotedParticipant: TEAMMATE,
    mentionedJids: [],
  });
  expect(
    replyContext({ key: { id: "C" }, message: { conversation: "plain" } } as WAMessage),
  ).toEqual({ quotedMessageId: null, quotedParticipant: null, mentionedJids: [] });
});

test(
  "#241 — a reply+mention carries quotedMessageId/quotedParticipant/quotedFromMe/mentionedJids in inbox, session and channel delivery",
  { timeout: 15000 },
  async () => {
    await withBridge(async ({ bridge, store, events }) => {
      seedOwnMessage(store, GROUP, "BOTMSG1");
      const inbox = await subscribe(bridge, GROUP, { mode: "inbox" });
      const session = await subscribe(bridge, GROUP, { mode: "session" });
      await subscribe(bridge, GROUP, { mode: "channel" });

      const controller = new AbortController();
      const sse = await fetch(url(bridge, "/api/mcp-notify"), {
        headers,
        signal: controller.signal,
      });
      const reader = sse.body!.getReader();
      const decoder = new TextDecoder();
      let buffered = "";
      const frames: Array<{ method: string; params: { meta: Record<string, unknown> } }> = [];
      const pump = (async () => {
        for (;;) {
          const chunk = await reader.read();
          if (chunk.done) break;
          buffered += decoder.decode(chunk.value, { stream: true });
          const parts = buffered.split("\n\n");
          buffered = parts.pop() ?? "";
          for (const part of parts) {
            const line = part.split("\n").find((l) => l.startsWith("data: "));
            if (line !== undefined) {
              try {
                frames.push(JSON.parse(line.slice(6)) as (typeof frames)[number]);
              } catch {
                // keep-alive / non-JSON frame
              }
            }
          }
        }
      })();

      events.emit(
        inbound({
          chat: GROUP,
          id: "REPLY1",
          participant: TEAMMATE,
          pushName: "Dana",
          text: "thanks — can you also check the build?",
          quoted: { stanzaId: "BOTMSG1", participant: OWN_PN },
          mentions: [OWN_PN],
        }),
      );
      const started = Date.now();
      while (
        !frames.some((f) => f.method === "notifications/claude/channel") &&
        Date.now() - started < 5000
      ) {
        await settle();
      }
      controller.abort();
      await pump.catch(() => undefined);

      const expected = {
        quotedMessageId: "BOTMSG1",
        quotedParticipant: OWN_PN,
        quotedFromMe: true,
        mentionedJids: [OWN_PN],
        fromName: "Dana",
      };
      expect(lastLine(join(inbox.dir, "inbox.jsonl"))).toMatchObject(expected);
      expect(lastLine(join(session.dir, "session.jsonl"))).toMatchObject(expected);

      const channel = frames.find((f) => f.method === "notifications/claude/channel");
      expect(channel?.params.meta).toMatchObject({
        quoted_message_id: "BOTMSG1",
        quoted_participant: OWN_PN,
        quoted_from_me: "true",
        mentioned_jids: OWN_PN,
        user: "Dana",
      });
      // Claude Code's meta contract is Record<string, string>
      for (const value of Object.values(channel?.params.meta ?? {})) {
        expect(typeof value).toBe("string");
      }
    });
  },
);

test("#241 — quoting a teammate is quotedFromMe:false", async () => {
  await withBridge(async ({ bridge, events }) => {
    const inbox = await subscribe(bridge, GROUP, { mode: "inbox" });
    events.emit(
      inbound({
        chat: GROUP,
        id: "REPLY2",
        participant: "358400000003@s.whatsapp.net",
        text: "+1 to Dana",
        quoted: { stanzaId: "DANAMSG", participant: TEAMMATE },
      }),
    );
    await settle();
    expect(lastLine(join(inbox.dir, "inbox.jsonl"))).toMatchObject({
      quotedMessageId: "DANAMSG",
      quotedParticipant: TEAMMATE,
      quotedFromMe: false,
    });
  });
});

test("#241 — an unknown quoted id still resolves quotedFromMe from the participant (own LID, device suffix ignored)", async () => {
  await withBridge(async ({ bridge, events }) => {
    const inbox = await subscribe(bridge, GROUP, { mode: "inbox" });
    events.emit(
      inbound({
        chat: GROUP,
        id: "REPLY3",
        participant: TEAMMATE,
        text: "about your message from yesterday",
        quoted: { stanzaId: "NOT-IN-STORE", participant: OWN_LID },
      }),
    );
    await settle();
    expect(lastLine(join(inbox.dir, "inbox.jsonl"))).toMatchObject({
      quotedMessageId: "NOT-IN-STORE",
      quotedFromMe: true,
    });
  });
});

test("#241 — a plain message carries no reply fields (lines stay compact)", async () => {
  await withBridge(async ({ bridge, events }) => {
    const inbox = await subscribe(bridge, GROUP, { mode: "inbox" });
    events.emit(inbound({ chat: GROUP, id: "PLAIN1", participant: TEAMMATE, text: "hello" }));
    await settle();
    const line = lastLine(join(inbox.dir, "inbox.jsonl"));
    expect(line.text).toBe("hello");
    expect("quotedMessageId" in line).toBe(false);
    expect("quotedFromMe" in line).toBe(false);
    expect("mentionedJids" in line).toBe(false);
  });
});

test("#247 hardening — a DM whose key.participant is an empty string still fills from with the peer", async () => {
  await withBridge(async ({ bridge, events }) => {
    const dm = "358400000004@s.whatsapp.net";
    const inbox = await subscribe(bridge, dm, { mode: "inbox" });
    events.emit(inbound({ chat: dm, id: "DM1", participant: "", text: "hey" }));
    await settle();
    expect(lastLine(join(inbox.dir, "inbox.jsonl"))).toMatchObject({ from: dm });
  });
});
