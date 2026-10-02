import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { proto } from "@whiskeysockets/baileys";
import type { WAMessage } from "@whiskeysockets/baileys";
import { openStore, type Store } from "../../src/store/schema.ts";
import { storeMessage } from "../../src/store/messages.ts";
import {
  fetchMessageFromStore,
  getMessageContext,
  listChats,
  listMessages,
  searchMessages,
} from "../../src/store/queries.ts";

const GROUP_A = "120363428874442773@g.us";
const GROUP_B = "120363999999999999@g.us";
const DM = "358497773518@s.whatsapp.net";
const SENDER = "358401112222@s.whatsapp.net";

function makeStore(): Store {
  return openStore(mkdtempSync(join(tmpdir(), "wa-mcp-queries-")));
}

function message(
  id: string,
  chatJid: string,
  timestamp: number,
  text: string,
  overrides: Partial<WAMessage> = {},
  content: proto.IMessage = { conversation: text },
): WAMessage {
  return {
    key: { remoteJid: chatJid, fromMe: false, id, participant: SENDER },
    message: content,
    messageTimestamp: timestamp,
    pushName: "Vasilisa",
    ...overrides,
  } as unknown as WAMessage;
}

test("listChats returns unread counts and last-message previews, newest first", () => {
  const store = makeStore();
  try {
    storeMessage(store, message("A1", GROUP_A, 1000, "older in A"));
    storeMessage(store, message("A2", GROUP_A, 2000, "newest in A"));
    storeMessage(store, message("B1", GROUP_B, 1500, "only in B"));
    store.db.prepare("UPDATE messages SET is_unread = 0 WHERE id = 'A1'").run();
    const chats = listChats(store, {});
    expect(chats.map((chat) => chat.jid)).toEqual([GROUP_A, GROUP_B]);
    const chatA = chats[0];
    if (!chatA) throw new Error("chat A missing");
    expect(chatA.unreadCount).toBe(1);
    expect(chatA.lastMessage?.id).toBe("A2");
    expect(chatA.lastMessage?.text).toBe("newest in A");
    expect(chatA.lastMessage?.senderName).toBe("Vasilisa");
    expect(chatA.archived).toBe(false);
    expect(chatA.name).toBe("Vasilisa");
  } finally {
    store.close();
  }
});

test("listChats falls back to phone digits for unnamed chats and filters archived", () => {
  const store = makeStore();
  try {
    storeMessage(store, message("D1", DM, 1000, "dm message"));
    store.db.prepare("UPDATE chats SET name = NULL WHERE jid = ?").run(DM);
    storeMessage(store, message("B1", GROUP_B, 2000, "group message"));
    const named = listChats(store, {});
    const dmRow = named.find((chat) => chat.jid === DM);
    expect(dmRow?.name).toBe("358497773518");
    store.db.prepare("UPDATE chats SET archived = 1 WHERE jid = ?").run(GROUP_B);
    expect(listChats(store, {}).map((chat) => chat.jid)).toEqual([DM]);
    expect(listChats(store, { archived: true }).map((chat) => chat.jid)).toEqual([GROUP_B]);
  } finally {
    store.close();
  }
});

test("listChats pagination is clamped and offset applies", () => {
  const store = makeStore();
  try {
    storeMessage(store, message("A1", GROUP_A, 1000, "a"));
    storeMessage(store, message("B1", GROUP_B, 2000, "b"));
    expect(listChats(store, { limit: 1 })).toHaveLength(1);
    expect(listChats(store, { limit: 1, offset: 1 }).map((chat) => chat.jid)).toEqual([GROUP_A]);
    expect(listChats(store, { limit: 0 })).toHaveLength(1);
    expect(listChats(store, { offset: -5 }).length).toBe(2);
    expect(listChats(store, { limit: 10_000 })).toHaveLength(2);
  } finally {
    store.close();
  }
});

test("listMessages filters by chat, sender and instant bounds", () => {
  const store = makeStore();
  try {
    storeMessage(store, message("A1", GROUP_A, 1000, "one"));
    storeMessage(
      store,
      message("A2", GROUP_A, 2000, "two", {
        key: {
          remoteJid: GROUP_A,
          fromMe: false,
          id: "A2",
          participant: "358403334444@s.whatsapp.net",
        },
      }),
    );
    storeMessage(store, message("A3", GROUP_A, 3000, "three"));
    storeMessage(store, message("B1", GROUP_B, 2500, "other chat"));
    const all = listMessages(store, { chatJid: GROUP_A });
    expect(all.map((row) => row.id)).toEqual(["A3", "A2", "A1"]);
    const fromSender = listMessages(store, { chatJid: GROUP_A, sender: SENDER });
    expect(fromSender.map((row) => row.id)).toEqual(["A3", "A1"]);
    const after = listMessages(store, { chatJid: GROUP_A, after: new Date(2000 * 1000) });
    expect(after.map((row) => row.id)).toEqual(["A3"]);
    const before = listMessages(store, { chatJid: GROUP_A, before: new Date(2000 * 1000) });
    expect(before.map((row) => row.id)).toEqual(["A1"]);
    const windowed = listMessages(store, {
      chatJid: GROUP_A,
      after: new Date(1000 * 1000),
      before: new Date(3000 * 1000),
    });
    expect(windowed.map((row) => row.id)).toEqual(["A2"]);
  } finally {
    store.close();
  }
});

test("listMessages clamps pagination and maps rows to camelCase", () => {
  const store = makeStore();
  try {
    for (const [id, ts] of [
      ["M1", 1000],
      ["M2", 2000],
      ["M3", 3000],
    ] as const) {
      storeMessage(store, message(id, GROUP_A, ts, `text ${id}`));
    }
    const page = listMessages(store, { chatJid: GROUP_A, limit: 2, offset: -10 });
    expect(page).toHaveLength(2);
    expect(page[0]?.id).toBe("M3");
    expect(page[0]?.chatJid).toBe(GROUP_A);
    expect(page[0]?.mentions).toEqual([]);
    expect(page[0]?.isFromMe).toBe(false);
    expect(listMessages(store, { chatJid: GROUP_A, limit: 10_000, offset: 5 })).toEqual([]);
  } finally {
    store.close();
  }
});

test("getMessageContext returns adjacent rows in the same chat", () => {
  const store = makeStore();
  try {
    for (const [id, ts] of [
      ["T1", 1000],
      ["T2", 2000],
      ["T3", 3000],
      ["T4", 4000],
      ["T5", 5000],
    ] as const) {
      storeMessage(store, message(id, GROUP_A, ts, `msg ${id}`));
    }
    storeMessage(store, message("X1", GROUP_B, 3500, "not this chat"));
    const context = getMessageContext(store, "T3", 2);
    if (!context) throw new Error("context missing");
    expect(context.target.id).toBe("T3");
    expect(context.before.map((row) => row.id)).toEqual(["T1", "T2"]);
    expect(context.after.map((row) => row.id)).toEqual(["T4", "T5"]);
    expect(getMessageContext(store, "MISSING", 2)).toBeNull();
  } finally {
    store.close();
  }
});

test("searchMessages ranks matches by recency", () => {
  const store = makeStore();
  try {
    storeMessage(store, message("S1", GROUP_A, 1000, "pizza night"));
    storeMessage(store, message("S2", GROUP_A, 3000, "pizza and burger"));
    storeMessage(store, message("S3", GROUP_B, 2000, "burger time"));
    const hits = searchMessages(store, "pizza", {});
    expect(hits.map((row) => row.id)).toEqual(["S2", "S1"]);
  } finally {
    store.close();
  }
});

test("searchMessages supports OR and phrase queries", () => {
  const store = makeStore();
  try {
    storeMessage(store, message("S1", GROUP_A, 1000, "pizza night"));
    storeMessage(store, message("S2", GROUP_A, 3000, "pizza and burger"));
    storeMessage(store, message("S3", GROUP_B, 2000, "burger time"));
    expect(searchMessages(store, "pizza OR burger", {}).map((row) => row.id)).toEqual([
      "S2",
      "S3",
      "S1",
    ]);
    expect(searchMessages(store, '"pizza night"', {}).map((row) => row.id)).toEqual(["S1"]);
    expect(searchMessages(store, '"pizza burger"', {})).toEqual([]);
  } finally {
    store.close();
  }
});

test("searchMessages can be scoped to one chat", () => {
  const store = makeStore();
  try {
    storeMessage(store, message("S1", GROUP_A, 1000, "pizza"));
    storeMessage(store, message("S2", GROUP_B, 2000, "pizza too"));
    const hits = searchMessages(store, "pizza", { chatJid: GROUP_B });
    expect(hits.map((row) => row.id)).toEqual(["S2"]);
  } finally {
    store.close();
  }
});

test("searchMessages survives injection attempts without damage", () => {
  const store = makeStore();
  try {
    storeMessage(store, message("S1", GROUP_A, 1000, "pizza"));
    const hits = searchMessages(store, 'pizza"; DROP TABLE messages;--', {});
    expect(Array.isArray(hits)).toBe(true);
    const count = store.db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number };
    expect(count.n).toBe(1);
  } finally {
    store.close();
  }
});

test("searchMessages falls back safely on fts-breaking input", () => {
  const store = makeStore();
  try {
    storeMessage(store, message("S1", GROUP_A, 1000, "plain text"));
    expect(Array.isArray(searchMessages(store, '"unbalanced quote', {}))).toBe(true);
    expect(Array.isArray(searchMessages(store, "a OR", {}))).toBe(true);
    expect(Array.isArray(searchMessages(store, "", {}))).toBe(true);
  } finally {
    store.close();
  }
});

test("searchMessages matches accents insensitively", () => {
  const store = makeStore();
  try {
    storeMessage(store, message("S1", GROUP_A, 1000, "where is Schröder"));
    const hits = searchMessages(store, "schroder", {});
    expect(hits.map((row) => row.id)).toEqual(["S1"]);
  } finally {
    store.close();
  }
});

test("fts stays in sync through the full message lifecycle", () => {
  const store = makeStore();
  try {
    const versions = store.db.prepare("SELECT version FROM migrations ORDER BY version").all();
    expect(versions.map((row) => (row as { version: number }).version)).toEqual([1, 2, 3, 4, 5, 6]);
    storeMessage(store, message("S1", GROUP_A, 1000, "original words"));
    expect(searchMessages(store, "original", {})).toHaveLength(1);
    storeMessage(
      store,
      message(
        "EDIT1",
        GROUP_A,
        6000,
        "ignored",
        {},
        {
          protocolMessage: {
            type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
            key: { id: "S1", remoteJid: GROUP_A },
            editedMessage: { conversation: "replaced words" },
          },
        },
      ),
    );
    expect(searchMessages(store, "replaced", {}).map((row) => row.id)).toEqual(["S1"]);
    expect(searchMessages(store, "original", {})).toEqual([]);
    store.db.prepare("DELETE FROM messages WHERE id = 'S1'").run();
    expect(searchMessages(store, "replaced", {})).toEqual([]);
  } finally {
    store.close();
  }
});

test("fetchMessageFromStore reconstructs a sendable message or returns null", () => {
  const store = makeStore();
  try {
    storeMessage(store, message("F1", GROUP_A, 5000, "forward me"));
    const fetched = fetchMessageFromStore(store, "F1");
    if (!fetched) throw new Error("message not found");
    expect(fetched.key.id).toBe("F1");
    expect(fetched.key.remoteJid).toBe(GROUP_A);
    expect(fetched.key.fromMe).toBe(false);
    expect(fetched.message?.conversation).toBe("forward me");
    expect(fetchMessageFromStore(store, "MISSING")).toBeNull();
  } finally {
    store.close();
  }
});
