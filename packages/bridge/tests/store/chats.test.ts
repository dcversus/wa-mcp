import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openStore, type Store } from "../../src/store/schema.ts";
import { storeMessage } from "../../src/store/messages.ts";
import {
  getUnreadCounts,
  markAllRead,
  markChatRead,
  setChatArchived,
  setChatMuted,
  setChatPinned,
} from "../../src/store/chats.ts";

const GROUP_A = "120363428874442773@g.us";
const GROUP_B = "120363999999999999@g.us";

function makeStore(): Store {
  return openStore(mkdtempSync(join(tmpdir(), "wa-mcp-chats-")));
}

function seed(store: Store, id: string, chatJid: string, timestamp: number, text: string): void {
  storeMessage(store, {
    key: { remoteJid: chatJid, fromMe: false, id, participant: "358401112222@s.whatsapp.net" },
    message: { conversation: text },
    messageTimestamp: timestamp,
    pushName: "Vasilisa",
  } as never);
}

test("chat flags persist", () => {
  const store = makeStore();
  try {
    seed(store, "A1", GROUP_A, 1000, "hello");
    setChatArchived(store, GROUP_A, true);
    setChatPinned(store, GROUP_A, true);
    setChatMuted(store, GROUP_A, "2026-10-03T12:00:00.000Z");
    const row = store.db
      .prepare("SELECT archived, pinned, muted_until FROM chats WHERE jid = ?")
      .get(GROUP_A) as {
      archived: number;
      pinned: number;
      muted_until: string;
    };
    expect(row.archived).toBe(1);
    expect(row.pinned).toBe(1);
    expect(row.muted_until).toBe("2026-10-03T12:00:00.000Z");
    setChatArchived(store, GROUP_A, false);
    setChatMuted(store, GROUP_A, null);
    const after = store.db
      .prepare("SELECT archived, muted_until FROM chats WHERE jid = ?")
      .get(GROUP_A) as {
      archived: number;
      muted_until: string | null;
    };
    expect(after.archived).toBe(0);
    expect(after.muted_until).toBeNull();
  } finally {
    store.close();
  }
});

test("markChatRead zeroes unread and writes a read_state row", () => {
  const store = makeStore();
  try {
    seed(store, "A1", GROUP_A, 1000, "one");
    seed(store, "A2", GROUP_A, 2000, "two");
    markChatRead(store, GROUP_A);
    const unread = store.db
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE chat_jid = ? AND is_unread = 1")
      .get(GROUP_A) as {
      n: number;
    };
    expect(unread.n).toBe(0);
    const state = store.db.prepare("SELECT * FROM read_state WHERE chat_jid = ?").get(GROUP_A) as {
      last_read_message_id: string;
      unread_count: number;
    };
    expect(state.last_read_message_id).toBe("A2");
    expect(state.unread_count).toBe(0);
    expect(getUnreadCounts(store)).toEqual([]);
  } finally {
    store.close();
  }
});

test("markAllRead clears every chat", () => {
  const store = makeStore();
  try {
    seed(store, "A1", GROUP_A, 1000, "a");
    seed(store, "B1", GROUP_B, 2000, "b");
    markAllRead(store);
    const unread = store.db
      .prepare("SELECT COUNT(*) AS n FROM messages WHERE is_unread = 1")
      .get() as { n: number };
    expect(unread.n).toBe(0);
    const states = store.db.prepare("SELECT chat_jid FROM read_state ORDER BY chat_jid").all();
    expect(states).toHaveLength(2);
  } finally {
    store.close();
  }
});

test("getUnreadCounts reports per-chat nonzero counts", () => {
  const store = makeStore();
  try {
    seed(store, "A1", GROUP_A, 1000, "one");
    seed(store, "A2", GROUP_A, 2000, "two");
    seed(store, "B1", GROUP_B, 3000, "three");
    expect(getUnreadCounts(store)).toEqual([
      { chatJid: GROUP_B, unreadCount: 1 },
      { chatJid: GROUP_A, unreadCount: 2 },
    ]);
    markChatRead(store, GROUP_A);
    expect(getUnreadCounts(store)).toEqual([{ chatJid: GROUP_B, unreadCount: 1 }]);
  } finally {
    store.close();
  }
});

test("getUnreadCounts ignores from-me messages", () => {
  const store = makeStore();
  try {
    storeMessage(store, {
      key: { remoteJid: GROUP_A, fromMe: true, id: "M1" },
      message: { conversation: "mine" },
      messageTimestamp: 1000,
    } as never);
    expect(getUnreadCounts(store)).toEqual([]);
  } finally {
    store.close();
  }
});
