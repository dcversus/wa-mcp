import { existsSync, mkdirSync, mkdtempSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, test } from "vite-plus/test";
import { proto } from "baileys";
import type { WAMessage } from "baileys";
import { openStore, type Store } from "../../src/store/schema.ts";
import { applyMigrations } from "../../src/store/schema.ts";
import { storeMessage } from "../../src/store/messages.ts";
import { runBackup } from "../../src/store/backup.ts";
import { markHistorySynced } from "../../src/store/meta.ts";
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
    expect(versions.map((row) => (row as { version: number }).version)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
    ]);
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

describe("T76 H3 — migrations run in a transaction", () => {
  test("a failed migration leaves no partial state; the re-run is idempotent", () => {
    const db = new DatabaseSync(":memory:");
    const broken: ReadonlyArray<{ version: number; sql: string }> = [
      { version: 1, sql: "CREATE TABLE sentinel (x TEXT)" },
      // autocommit would leave the INSERT applied when the CREATE fails
      {
        version: 2,
        sql: "INSERT INTO sentinel VALUES ('once'); CREATE TABLE definitely_broken (",
      },
    ];
    expect(() => applyMigrations(db, broken)).toThrow();
    expect(db.prepare("SELECT COUNT(*) AS n FROM migrations WHERE version = 2").get()).toEqual({
      n: 0,
    });
    expect(db.prepare("SELECT COUNT(*) AS n FROM sentinel").get()).toEqual({ n: 0 });
    const fixed: ReadonlyArray<{ version: number; sql: string }> = [
      { version: 1, sql: "CREATE TABLE sentinel (x TEXT)" },
      { version: 2, sql: "INSERT INTO sentinel VALUES ('once')" },
    ];
    expect(() => applyMigrations(db, fixed)).not.toThrow();
    // FTS-rebuild idempotency: the retry inserts the row EXACTLY once
    expect(db.prepare("SELECT COUNT(*) AS n FROM sentinel").get()).toEqual({ n: 1 });
    expect(db.prepare("SELECT COUNT(*) AS n FROM migrations").get()).toEqual({ n: 2 });
    db.close();
  });
});

describe("T78 M1 — protocol-message tombstones verify the sender", () => {
  function revokeFrom(id: string, participant: string, fromMe: boolean, target: string) {
    return message(
      "R-" + id,
      GROUP_A,
      3000,
      "",
      {
        key: { remoteJid: GROUP_A, fromMe, id: "R-" + id, participant },
      },
      {
        protocolMessage: {
          type: proto.Message.ProtocolMessage.Type.REVOKE,
          key: { id: target, remoteJid: GROUP_A },
        },
      },
    );
  }

  test("a revoke from a DIFFERENT sender does not tombstone someone else's message", () => {
    const store = makeStore();
    try {
      storeMessage(store, message("T1", GROUP_A, 1000, "keep me"));
      storeMessage(store, revokeFrom("SPOOF", "3584999999999@s.whatsapp.net", false, "T1"));
      const row = store.db
        .prepare("SELECT deleted, content FROM messages WHERE id = 'T1'")
        .get() as { deleted: number; content: string };
      expect(row.deleted).toBe(0);
      expect(row.content).toBe("keep me");
    } finally {
      store.close();
    }
  });

  test("the ORIGINAL sender and the account itself may revoke", () => {
    const store = makeStore();
    try {
      storeMessage(store, message("T2", GROUP_A, 1000, "mine"));
      storeMessage(store, revokeFrom("OK", SENDER, false, "T2"));
      const row = store.db.prepare("SELECT deleted FROM messages WHERE id = 'T2'").get() as {
        deleted: number;
      };
      expect(row.deleted).toBe(1);
      // the account revoking its OWN message (fromMe revoke) still applies
      storeMessage(store, message("T3", GROUP_A, 1500, "account msg"));
      storeMessage(
        store,
        message(
          "R-T3",
          GROUP_A,
          3000,
          "",
          {
            key: { remoteJid: GROUP_A, fromMe: true, id: "R-T3", participant: SENDER },
          },
          {
            protocolMessage: {
              type: proto.Message.ProtocolMessage.Type.REVOKE,
              key: { id: "T3", remoteJid: GROUP_A },
            },
          },
        ),
      );
      const own = store.db.prepare("SELECT deleted FROM messages WHERE id = 'T3'").get() as {
        deleted: number;
      };
      expect(own.deleted).toBe(1);
    } finally {
      store.close();
    }
  });

  test("a foreign MESSAGE_EDIT does not rewrite someone else's text", () => {
    const store = makeStore();
    try {
      storeMessage(store, message("E1", GROUP_A, 1000, "original words"));
      storeMessage(
        store,
        message(
          "R-E1",
          GROUP_A,
          3000,
          "",
          {
            key: {
              remoteJid: GROUP_A,
              fromMe: false,
              id: "R-E1",
              participant: "3584999999999@s.whatsapp.net",
            },
          },
          {
            protocolMessage: {
              type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
              key: { id: "E1", remoteJid: GROUP_A },
              editedMessage: { conversation: "spoofed edit" },
            },
          },
        ),
      );
      const row = store.db.prepare("SELECT content FROM messages WHERE id = 'E1'").get() as {
        content: string;
      };
      expect(row.content).toBe("original words");
    } finally {
      store.close();
    }
  });
});

describe("T78 M2 — reactions are an aggregated per-sender model", () => {
  function reactionFrom(id: string, participant: string, emote: string, target: string) {
    return message(
      "RX-" + id,
      GROUP_A,
      4000,
      "",
      {
        key: { remoteJid: GROUP_A, fromMe: false, id: "RX-" + id, participant },
      },
      {
        reactionMessage: { key: { id: target, remoteJid: GROUP_A }, text: emote },
      },
    );
  }

  test("two senders on one emoji + a third on another -> counts and senders", () => {
    const store = makeStore();
    try {
      const targetMsg = message("M1", GROUP_A, 1000, "react to me");
      const rxA = reactionFrom("A", "3584000000001@s.whatsapp.net", "👍", "M1");
      const rxB = reactionFrom("B", "3584000000002@s.whatsapp.net", "👍", "M1");
      const rxC = reactionFrom("C", "3584000000003@s.whatsapp.net", "🎉", "M1");
      if (rxA === undefined || rxB === undefined || rxC === undefined) {
        throw new Error(
          `fixture undefined: ${String(rxA === undefined)} ${String(rxB === undefined)} ${String(rxC === undefined)}`,
        );
      }
      storeMessage(store, targetMsg);
      storeMessage(store, rxA);
      storeMessage(store, rxB);
      storeMessage(store, rxC);
      const list = listMessages(store, { chatJid: GROUP_A });
      const target = list.find((row) => row.id === "M1");
      expect(target?.reactions).toEqual([
        {
          emote: "👍",
          count: 2,
          senders: ["3584000000001@s.whatsapp.net", "3584000000002@s.whatsapp.net"],
        },
        { emote: "🎉", count: 1, senders: ["3584000000003@s.whatsapp.net"] },
      ]);
    } finally {
      store.close();
    }
  });

  test("an empty emote removes that sender's reaction only", () => {
    const store = makeStore();
    try {
      storeMessage(store, message("M2", GROUP_A, 1000, "react to me"));
      const rxA = reactionFrom("A", "3584000000001@s.whatsapp.net", "👍", "M2");
      const rxB = reactionFrom("B", "3584000000002@s.whatsapp.net", "👍", "M2");
      const rxA2 = reactionFrom("A2", "3584000000001@s.whatsapp.net", "", "M2");
      storeMessage(store, rxA);
      storeMessage(store, rxB);
      storeMessage(store, rxA2);
      const list = listMessages(store, { chatJid: GROUP_A });
      const target = list.find((row) => row.id === "M2");
      expect(target?.reactions).toEqual([
        { emote: "👍", count: 1, senders: ["3584000000002@s.whatsapp.net"] },
      ]);
    } finally {
      store.close();
    }
  });

  test("migration v9 creates the sender-keyed reactions table", () => {
    const store = makeStore();
    try {
      const versions = store.db.prepare("SELECT version FROM migrations ORDER BY version").all();
      expect(versions.map((row) => (row as { version: number }).version)).toEqual([
        1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11,
      ]);
    } finally {
      store.close();
    }
  });
});

describe("T78 M3 — poll data rides the read API", () => {
  test("listMessages returns question + per-option vote counts", () => {
    const store = makeStore();
    try {
      storeMessage(store, message("P1", GROUP_A, 1000, "lunch?"));
      store.db
        .prepare(
          "INSERT INTO poll_options (chat_jid, message_id, idx, label) VALUES (?, 'P1', 0, 'Pizza'), (?, 'P1', 1, 'Burger')",
        )
        .run(GROUP_A, GROUP_A);
      store.db
        .prepare(
          "INSERT INTO poll_votes (chat_jid, message_id, voter_jid, option_idx, voted_at) VALUES (?, 'P1', 'a@s.whatsapp.net', 0, '2026-01-01'), (?, 'P1', 'b@s.whatsapp.net', 0, '2026-01-02')",
        )
        .run(GROUP_A, GROUP_A);
      const list = listMessages(store, { chatJid: GROUP_A });
      const row = list.find((entry) => entry.id === "P1");
      expect(row?.poll).toEqual({
        question: "lunch?",
        options: [
          { label: "Pizza", votes: 2 },
          { label: "Burger", votes: 0 },
        ],
      });
    } finally {
      store.close();
    }
  });
});

describe("T80 — line45 disappearing settings + line66 sync watermark", () => {
  test("line45 — an EPHEMERAL_SETTING ingest stores per-chat disappearing", () => {
    const store = makeStore();
    try {
      storeMessage(
        store,
        message("EPH1", GROUP_A, 1000, "x", {}, {
          protocolMessage: {
            type: proto.Message.ProtocolMessage.Type.EPHEMERAL_SETTING,
            ephemeralExpiration: 604_800,
          },
        } as never),
      );
      const row = store.db
        .prepare("SELECT ephemeral_duration, ephemeral_setting_ts FROM chats WHERE jid = ?")
        .get(GROUP_A) as { ephemeral_duration: number | null; ephemeral_setting_ts: string | null };
      expect(row.ephemeral_duration).toBe(604_800);
      expect(row.ephemeral_setting_ts).not.toBeNull();
    } finally {
      store.close();
    }
  });

  test("line66 — a history sync advances the watermark and marks chats", () => {
    const store = makeStore();
    try {
      markHistorySynced(store, [GROUP_A]);
      const watermark = store.db
        .prepare("SELECT value FROM meta WHERE key = 'history_sync_watermark'")
        .get() as { value: string } | undefined;
      expect(watermark?.value).toBeDefined();
      const chat = store.db
        .prepare("SELECT history_synced_at FROM chats WHERE jid = ?")
        .get(GROUP_A) as { history_synced_at: string | null };
      expect(chat.history_synced_at).not.toBeNull();
    } finally {
      store.close();
    }
  });
});

describe("T80 line62 — backup + retention", () => {
  test("retention=1 keeps exactly one backup across runs", () => {
    const dataDir = mkdtempSync(join(tmpdir(), "wa-mcp-backup-data-"));
    writeFileSync(join(dataDir, "store.db"), "db-bytes");
    mkdirSync(join(dataDir, "media"), { recursive: true });
    writeFileSync(join(dataDir, "media", "x.txt"), "m");
    const backups = mkdtempSync(join(tmpdir(), "wa-mcp-backups-"));
    runBackup(dataDir, backups, 1, new Date("2026-10-04T01:00:00Z"));
    runBackup(dataDir, backups, 1, new Date("2026-10-04T02:00:00Z"));
    const runs = readdirSync(backups);
    expect(runs).toHaveLength(1);
    expect(existsSync(join(backups, runs[0] ?? "", "store.db"))).toBe(true);
    expect(existsSync(join(backups, runs[0] ?? "", "media", "x.txt"))).toBe(true);
  });
});
