import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { proto } from "baileys";
import type { WAMessage } from "baileys";
import { openStore } from "../../src/store/schema.ts";
import { storeMessage } from "../../src/store/messages.ts";

function makeStore() {
  return openStore(mkdtempSync(join(tmpdir(), "wa-mcp-msgstore-")));
}

function waMessage(
  overrides: Partial<WAMessage> = {},
  content: proto.IMessage = { conversation: "hello" },
): WAMessage {
  return {
    key: {
      remoteJid: "120363428874442773@g.us",
      fromMe: false,
      id: "MSG1",
      participant: "358497773518@s.whatsapp.net",
    },
    message: content,
    messageTimestamp: 1727812345,
    ...overrides,
  } as unknown as WAMessage;
}

function row(
  store: ReturnType<typeof openStore>,
  id: string,
  chatJid = "120363428874442773@g.us",
): Record<string, unknown> | undefined {
  return store.db
    .prepare("SELECT * FROM messages WHERE chat_jid = ? AND id = ?")
    .get(chatJid, id) as Record<string, unknown> | undefined;
}

test("stores a full text message row with all 13 columns populated", () => {
  const store = makeStore();
  try {
    const stored = storeMessage(
      store,
      waMessage({ pushName: "Vasilisa" }, { conversation: "hello world" }),
    );
    expect(stored).toBe(true);
    const fetched = row(store, "MSG1");
    if (!fetched) throw new Error("row missing");
    expect(fetched.id).toBe("MSG1");
    expect(fetched.chat_jid).toBe("120363428874442773@g.us");
    expect(fetched.sender_jid).toBe("358497773518@s.whatsapp.net");
    expect(fetched.sender_name).toBe("Vasilisa");
    expect(fetched.timestamp).toBe(new Date(1727812345 * 1000).toISOString());
    expect(fetched.content).toBe("hello world");
    expect(fetched.media_type).toBeNull();
    expect(fetched.media_path).toBeNull();
    expect(fetched.quoted_message_id).toBeNull();
    expect(fetched.mentions).toBe("[]");
    expect(fetched.is_from_me).toBe(0);
    expect(fetched.is_unread).toBe(1);
    expect(fetched.reactions).toBeNull();
  } finally {
    store.close();
  }
});

test("storing the same chat_jid and id twice is idempotent", () => {
  const store = makeStore();
  try {
    const message = waMessage({ pushName: "Vasilisa" });
    expect(storeMessage(store, message)).toBe(true);
    expect(storeMessage(store, message)).toBe(false);
    const count = store.db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number };
    expect(count.n).toBe(1);
  } finally {
    store.close();
  }
});

test("chat row is created on first store and timestamp only advances", () => {
  const store = makeStore();
  try {
    storeMessage(store, waMessage({ pushName: "Vasilisa", messageTimestamp: 1727812345 }));
    const chatRow = () =>
      store.db.prepare("SELECT * FROM chats WHERE jid = ?").get("120363428874442773@g.us") as
        | { name: string | null; last_message_ts: string }
        | undefined;
    const afterFirst = chatRow();
    if (!afterFirst) throw new Error("chat row missing");
    expect(afterFirst.last_message_ts).toBe(new Date(1727812345 * 1000).toISOString());
    expect(afterFirst.name).toBe("Vasilisa");
    storeMessage(
      store,
      waMessage({
        key: {
          remoteJid: "120363428874442773@g.us",
          fromMe: false,
          id: "MSG2",
          participant: "358497773518@s.whatsapp.net",
        },
        messageTimestamp: 1727810000,
      }),
    );
    const afterOlder = chatRow();
    if (!afterOlder) throw new Error("chat row missing after older store");
    expect(afterOlder.last_message_ts).toBe(new Date(1727812345 * 1000).toISOString());
  } finally {
    store.close();
  }
});

test("chat timestamp is untouched when a duplicate message is not stored", () => {
  const store = makeStore();
  try {
    const message = waMessage({ pushName: "Vasilisa", messageTimestamp: 1727812345 });
    storeMessage(store, message);
    storeMessage(
      store,
      waMessage(
        {
          key: {
            remoteJid: "120363428874442773@g.us",
            fromMe: false,
            id: "MSG2",
            participant: "358497773518@s.whatsapp.net",
          },
          messageTimestamp: 1727819999,
        },
        { conversation: "later" },
      ),
    );
    storeMessage(store, message);
    const chatRow = store.db
      .prepare("SELECT last_message_ts FROM chats WHERE jid = ?")
      .get("120363428874442773@g.us") as { last_message_ts: string };
    expect(chatRow.last_message_ts).toBe(new Date(1727819999 * 1000).toISOString());
  } finally {
    store.close();
  }
});

test("sender name falls back to verifiedBizName then phone digits", { timeout: 20_000 }, () => {
  const store = makeStore();
  try {
    storeMessage(store, waMessage({ verifiedBizName: "Biz Co" }));
    expect(row(store, "MSG1")?.sender_name).toBe("Biz Co");
    storeMessage(
      store,
      waMessage({
        key: {
          remoteJid: "120363428874442773@g.us",
          fromMe: false,
          id: "MSG2",
          participant: "35840111222@s.whatsapp.net",
        },
      }),
    );
    expect(row(store, "MSG2")?.sender_name).toBe("35840111222");
  } finally {
    store.close();
  }
});

test("from-me rows are marked not unread", () => {
  const store = makeStore();
  try {
    storeMessage(
      store,
      waMessage({ key: { remoteJid: "358497773518@s.whatsapp.net", fromMe: true, id: "MSG1" } }),
    );
    const fetched = row(store, "MSG1", "358497773518@s.whatsapp.net");
    if (!fetched) throw new Error("row missing");
    expect(fetched.is_from_me).toBe(1);
    expect(fetched.is_unread).toBe(0);
  } finally {
    store.close();
  }
});

test.skipIf(process.platform === "win32")("quoted id and mentions are stored as provided", () => {
  const store = makeStore();
  try {
    storeMessage(
      store,
      waMessage(
        {},
        {
          extendedTextMessage: {
            text: "re @551199",
            contextInfo: {
              stanzaId: "QUOTED1",
              mentionedJid: ["551199@s.whatsapp.net", "551188@s.whatsapp.net"],
            },
          },
        },
      ),
    );
    const fetched = row(store, "MSG1");
    if (!fetched) throw new Error("row missing");
    expect(fetched.quoted_message_id).toBe("QUOTED1");
    expect(fetched.mentions).toBe('["551199@s.whatsapp.net","551188@s.whatsapp.net"]');
  } finally {
    store.close();
  }
});

test("a reaction updates the target row instead of creating a row", () => {
  const store = makeStore();
  try {
    storeMessage(store, waMessage({ pushName: "Vasilisa" }));
    const stored = storeMessage(
      store,
      waMessage(
        {
          key: {
            remoteJid: "120363428874442773@g.us",
            fromMe: false,
            id: "REACT1",
            participant: "358497773518@s.whatsapp.net",
          },
        },
        {
          reactionMessage: {
            key: { id: "MSG1", remoteJid: "120363428874442773@g.us" },
            text: "👍",
          },
        },
      ),
    );
    expect(stored).toBe(false);
    const count = store.db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number };
    expect(count.n).toBe(1);
    const fetched = row(store, "MSG1");
    if (!fetched) throw new Error("target row missing");
    // T78 M2: reactions live in the sender-keyed table now
    const reactions = store.db
      .prepare("SELECT emoji, sender_jid FROM reactions WHERE message_id = 'MSG1'")
      .all() as Array<{ emoji: string; sender_jid: string }>;
    expect(reactions).toEqual([{ emoji: "👍", sender_jid: "358497773518@s.whatsapp.net" }]);
    // T60: the send-echo + the reaction event both land here — a repeated
    // identical emote must NOT duplicate the entry (live: [{👍},{👍}])
    storeMessage(
      store,
      waMessage(
        {
          key: {
            remoteJid: "120363428874442773@g.us",
            fromMe: false,
            id: "REACT2",
            participant: "358497773518@s.whatsapp.net",
          },
        },
        {
          reactionMessage: {
            key: { id: "MSG1", remoteJid: "120363428874442773@g.us" },
            text: "👍",
          },
        },
      ),
    );
    const refetched = row(store, "MSG1");
    if (!refetched) throw new Error("target row missing after dedupe");
    // T78 M2: the sender-keyed PK dedupes — the repeated emote is ONE row
    const deduped = store.db
      .prepare("SELECT COUNT(*) AS n FROM reactions WHERE message_id = 'MSG1'")
      .get() as { n: number };
    expect(deduped.n).toBe(1);
  } finally {
    store.close();
  }
});

test("an edit rewrites the target content", () => {
  const store = makeStore();
  try {
    storeMessage(store, waMessage({ pushName: "Vasilisa" }));
    storeMessage(
      store,
      waMessage(
        {
          key: {
            remoteJid: "120363428874442773@g.us",
            fromMe: false,
            id: "EDIT1",
            participant: "358497773518@s.whatsapp.net",
          },
        },
        {
          protocolMessage: {
            type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
            key: { id: "MSG1", remoteJid: "120363428874442773@g.us" },
            editedMessage: { conversation: "hello, edited" },
          },
        },
      ),
    );
    expect(row(store, "MSG1")?.content).toBe("hello, edited");
  } finally {
    store.close();
  }
});

test("a revoke blanks the target content and media", () => {
  const store = makeStore();
  try {
    storeMessage(
      store,
      waMessage({ pushName: "Vasilisa" }, { imageMessage: { caption: "pic", url: "https://x" } }),
    );
    storeMessage(
      store,
      waMessage(
        {
          key: {
            remoteJid: "120363428874442773@g.us",
            fromMe: false,
            id: "REVOKE1",
            participant: "358497773518@s.whatsapp.net",
          },
        },
        {
          protocolMessage: {
            type: proto.Message.ProtocolMessage.Type.REVOKE,
            key: { id: "MSG1", remoteJid: "120363428874442773@g.us" },
          },
        },
      ),
    );
    const fetched = row(store, "MSG1");
    if (!fetched) throw new Error("target row missing");
    expect(fetched.content).toBe("[revoked]");
    expect(fetched.media_type).toBeNull();
    expect(fetched.media_path).toBeNull();
  } finally {
    store.close();
  }
});

test("T62: an incoming revoke tombstones the row (deleted=1)", () => {
  const store = makeStore();
  try {
    storeMessage(store, waMessage({ pushName: "Vasilisa" }, { conversation: "will be revoked" }));
    storeMessage(
      store,
      waMessage(
        {
          key: {
            remoteJid: "120363428874442773@g.us",
            fromMe: false,
            id: "REVOKE-T62",
            participant: "358497773518@s.whatsapp.net",
          },
        },
        {
          protocolMessage: {
            key: { id: "MSG1", remoteJid: "120363428874442773@g.us", fromMe: false },
            type: proto.Message.ProtocolMessage.Type.REVOKE,
          },
        },
      ),
    );
    const fetched = row(store, "MSG1");
    if (!fetched) throw new Error("target row missing");
    expect(fetched.deleted).toBe(1);
    expect(fetched.content).toBe("[revoked]");
  } finally {
    store.close();
  }
});

test("T60b: a protocol message with no extractable content stores NO row", () => {
  const store = makeStore();
  try {
    // protocol echo with an unknown/ineffectual type — carries no user content
    const stored = storeMessage(
      store,
      waMessage(
        {
          key: {
            remoteJid: "120363428874442773@g.us",
            fromMe: false,
            id: "ECHOID",
            participant: "358497773518@s.whatsapp.net",
          },
        },
        { protocolMessage: { type: proto.Message.ProtocolMessage.Type.EPHEMERAL_SETTING } },
      ),
    );
    expect(stored).toBe(false);
    const rows = store.db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number };
    expect(rows.n).toBe(0);
  } finally {
    store.close();
  }
});

test("T60b: a message with no content and no media stores NO row", () => {
  const store = makeStore();
  try {
    const stored = storeMessage(
      store,
      waMessage(
        {
          key: {
            remoteJid: "120363428874442773@g.us",
            fromMe: false,
            id: "EMPTYID",
            participant: "358497773518@s.whatsapp.net",
          },
        },
        {},
      ),
    );
    expect(stored).toBe(false);
    const rows = store.db.prepare("SELECT COUNT(*) AS n FROM messages").get() as { n: number };
    expect(rows.n).toBe(0);
  } finally {
    store.close();
  }
});
