import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { proto } from "baileys";
import type { WAMessage } from "baileys";
import { openStore } from "../../src/store/schema.ts";
import { storeMessage, upsertChatMeta } from "../../src/store/messages.ts";
import { listMessages, listChats } from "../../src/store/queries.ts";
import {
  addSendRule,
  evaluateSendRules,
  listSendRules,
  removeSendRule,
} from "../../src/store/send-rules.ts";
import {
  renderTemplate,
  upsertTemplate,
  listTemplates,
  getTemplate,
} from "../../src/store/templates.ts";
import {
  scheduleMessage,
  dueScheduled,
  markScheduled,
  listScheduled,
  cancelScheduled,
  processDue,
} from "../../src/store/scheduled.ts";
import {
  addAutoreplyRule,
  evaluateAutoreply,
  listAutoreplyRules,
  removeAutoreplyRule,
  toggleAutoreplyRule,
} from "../../src/store/autoreply.ts";

const GROUP = "120363428874442773@g.us";

function makeStore() {
  return openStore(mkdtempSync(join(tmpdir(), "wa-mcp-t82-")));
}

describe("T82 line91 — restrict_sending", () => {
  test("a blocking rule SEND_BLOCKs the target; others pass; expiry respected", () => {
    const store = makeStore();
    try {
      addSendRule(store, { target: GROUP, mode: "block" });
      const blocked = evaluateSendRules(store, GROUP);
      expect(blocked.allowed).toBe(false);
      expect(blocked.rule?.mode).toBe("block");
      const other = evaluateSendRules(store, "358497773518@s.whatsapp.net");
      expect(other.allowed).toBe(true);
      // expiry: expired rules are ignored
      removeSendRule(store, 1);
      addSendRule(store, {
        target: GROUP,
        mode: "block",
        expiresAt: new Date(Date.now() - 1000).toISOString(),
      });
      expect(evaluateSendRules(store, GROUP).allowed).toBe(true);
      expect(listSendRules(store)).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});

describe("T82 line89 — templates", () => {
  test("render substitutes vars; unknown vars are reported", () => {
    const store = makeStore();
    try {
      upsertTemplate(store, { name: "greeting", body: "hi {{name}}, {{event}} soon?" });
      expect(getTemplate(store, "greeting")?.body).toContain("{{name}}");
      expect(listTemplates(store)).toHaveLength(1);
      const rendered = renderTemplate("hi {{name}}, {{event}} soon?", { name: "Vasilisa" });
      expect(rendered.text).toBe("hi Vasilisa, {{event}} soon?");
      expect(rendered.missing).toEqual(["event"]);
      expect(renderTemplate("no vars", {})).toEqual({ text: "no vars", missing: [] });
    } finally {
      store.close();
    }
  });
});

describe("T82 line88 — scheduler", () => {
  test("a due message is picked, marked sent; cancel wins before due", () => {
    const store = makeStore();
    try {
      const id = scheduleMessage(store, {
        chatJid: GROUP,
        payload: "due now",
        sendAt: new Date(Date.now() - 1000).toISOString(),
      });
      let sent: Array<{ chatJid: string; payload: string }> = [];
      const due = dueScheduled(store, new Date());
      expect(due).toHaveLength(1);
      markScheduled(store, id, "sent", "MSGID1");
      sent = [];
      void sent;
      expect(listScheduled(store, "sent")).toHaveLength(1);
      const future = scheduleMessage(store, {
        chatJid: GROUP,
        payload: "later",
        sendAt: new Date(Date.now() + 60_000).toISOString(),
      });
      expect(dueScheduled(store, new Date())).toHaveLength(0);
      cancelScheduled(store, future);
      expect(listScheduled(store, "cancelled")).toHaveLength(1);
    } finally {
      store.close();
    }
  });

  test("a sent scheduled text lands in the messages store via the caller", () => {
    const store = makeStore();
    try {
      const msg: WAMessage = {
        key: { remoteJid: GROUP, fromMe: true, id: "SCHED1" },
        message: { conversation: "scheduled body" },
        messageTimestamp: Math.floor(Date.now() / 1000),
      } as unknown as WAMessage;
      storeMessage(store, msg);
      const list = listMessages(store, { chatJid: GROUP });
      expect(list[0]?.content).toBe("scheduled body");
      void proto;
    } finally {
      store.close();
    }
  });
});

describe("T84-B — line93 autoreply store + line98 scheduled media", () => {
  test("line93 — evaluateAutoreply matches, cools down per chat, skips disabled", () => {
    const store = makeStore();
    try {
      addAutoreplyRule(store, { match: "hello", reply: "hi there!" });
      const now = Date.now();
      expect(evaluateAutoreply(store, GROUP, "hello there", now)).toBe("hi there!");
      expect(evaluateAutoreply(store, GROUP, "hello again", now + 1000)).toBeNull();
      expect(evaluateAutoreply(store, "358497773518@s.whatsapp.net", "hello", now)).toBe(
        "hi there!",
      );
      toggleAutoreplyRule(store, 1, false);
      expect(evaluateAutoreply(store, "358400000001@g.us", "hello", now)).toBeNull();
    } finally {
      store.close();
    }
  });

  test("line93 — remove works and non-matching text returns null", () => {
    const store = makeStore();
    try {
      addAutoreplyRule(store, { match: "hello", reply: "hi" });
      expect(evaluateAutoreply(store, GROUP, "goodbye", Date.now())).toBeNull();
      removeAutoreplyRule(store, 1);
      expect(listAutoreplyRules(store)).toHaveLength(0);
    } finally {
      store.close();
    }
  });

  test("line98 — scheduled media payloads round-trip and processDue routes them", async () => {
    const store = makeStore();
    try {
      scheduleMessage(store, {
        chatJid: GROUP,
        payload: { kind: "image", url: "https://cdn.example/pic.jpg", caption: "look" },
        sendAt: new Date(Date.now() - 1000).toISOString(),
      });
      const sent: Array<{ chatJid: string; payload: unknown }> = [];
      await processDue(store, new Date(), async (chatJid, payload) => {
        sent.push({ chatJid, payload });
        return "MSGID9";
      });
      expect(sent).toEqual([
        {
          chatJid: GROUP,
          payload: { kind: "image", url: "https://cdn.example/pic.jpg", caption: "look" },
        },
      ]);
      expect(listScheduled(store, "sent")[0]?.sent_message_id).toBe("MSGID9");
      scheduleMessage(store, {
        chatJid: GROUP,
        payload: { kind: "image", url: "https://cdn.example/2.jpg" },
        sendAt: new Date(Date.now() - 2000).toISOString(),
      });
      await processDue(store, new Date(), async () => {
        throw new Error("send exploded");
      });
      expect(listScheduled(store, "failed").length).toBeGreaterThan(0);
    } finally {
      store.close();
    }
  });
});

test("T94-D-H3 — processDue marks failed rows with the structured reason", async () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-due-reason-")));
  try {
    scheduleMessage(store, {
      chatJid: "358497773518@s.whatsapp.net",
      payload: "blocked text",
      sendAt: new Date(Date.now() - 1000).toISOString(),
    });
    await processDue(store, new Date(), async () => {
      throw new Error("SEND_BLOCKED: sending to X is blocked by rule #1 (X)");
    });
    // CODEX H3: a refusal reason must survive on the row — "failed" alone
    // hides whether it was the rules, the budget or the engine
    const row = store.db.prepare("SELECT status, last_error FROM scheduled_messages").get() as {
      status: string;
      last_error?: string | null;
    };
    expect(row.status).toBe("failed");
    expect(row.last_error ?? "").toContain("SEND_BLOCKED");
  } finally {
    store.close();
  }
});

describe("T94-D-M6 — scheduler timezone normalization", () => {
  test("scheduleMessage normalizes offsets to UTC ISO (string-compare then works)", () => {
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-m6-")));
    try {
      // RED today: the +03:00 offset stored verbatim fires 3h late under the
      // lexical due comparison
      const id = scheduleMessage(store, {
        chatJid: "358497773518@s.whatsapp.net",
        payload: "tz text",
        sendAt: "2026-12-01T09:00:00+03:00",
      });
      const row = store.db
        .prepare("SELECT send_at FROM scheduled_messages WHERE id = ?")
        .get(id) as { send_at: string };
      expect(row.send_at).toBe("2026-12-01T06:00:00.000Z");
    } finally {
      store.close();
    }
  });

  test("a non-ISO send_at is refused", () => {
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-m6b-")));
    try {
      expect(() =>
        scheduleMessage(store, {
          chatJid: "358497773518@s.whatsapp.net",
          payload: "x",
          sendAt: "tomorrow",
        }),
      ).toThrow("send_at");
    } finally {
      store.close();
    }
  });

  test("an offset-expressed row comes due at the right wall clock", async () => {
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-m6c-")));
    try {
      scheduleMessage(store, {
        chatJid: "358497773518@s.whatsapp.net",
        payload: "tz due",
        sendAt: "2026-12-01T09:00:00+03:00",
      });
      const sent: string[] = [];
      // 06:00 UTC == 09:00 +03:00 — string-compare would need 09:00 UTC
      await processDue(store, new Date("2026-12-01T06:00:01.000Z"), async (chatJid) => {
        sent.push(chatJid);
        return "M6ID";
      });
      expect(sent).toHaveLength(1);
    } finally {
      store.close();
    }
  });
});

describe("T94-F M3 — transient scheduled failures retry, bounded", () => {
  test("RATE_LIMITED keeps the row pending with the attempt recorded", async () => {
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-m3r-")));
    try {
      scheduleMessage(store, {
        chatJid: "358497773518@s.whatsapp.net",
        payload: "retry me",
        sendAt: new Date(Date.now() - 1000).toISOString(),
      });
      await processDue(store, new Date(), async () => {
        throw new Error("RATE_LIMITED: sending too fast");
      });
      const row = store.db
        .prepare("SELECT status, attempts, last_error FROM scheduled_messages")
        .get() as { status: string; attempts: number; last_error?: string | null };
      // RUNTIME review M3: a transient refusal must not kill the message
      expect(row.status).toBe("pending");
      expect(row.attempts).toBe(1);
      expect(row.last_error ?? "").toContain("RATE_LIMITED");
    } finally {
      store.close();
    }
  });

  test("after the attempt bound the row fails permanently", async () => {
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-m3r2-")));
    try {
      scheduleMessage(store, {
        chatJid: "358497773518@s.whatsapp.net",
        payload: "never lands",
        sendAt: new Date(Date.now() - 1000).toISOString(),
      });
      const failing = async () => {
        throw new Error("RATE_LIMITED: sending too fast");
      };
      for (let i = 0; i < 5; i += 1) {
        await processDue(store, new Date(), failing);
      }
      const row = store.db.prepare("SELECT status, attempts FROM scheduled_messages").get() as {
        status: string;
        attempts: number;
      };
      expect(row.status).toBe("pending");
      expect(row.attempts).toBe(5);
      await processDue(store, new Date(), failing);
      const done = store.db.prepare("SELECT status, attempts FROM scheduled_messages").get() as {
        status: string;
        attempts: number;
      };
      expect(done.status).toBe("failed");
      expect(done.attempts).toBe(5);
    } finally {
      store.close();
    }
  });

  test("permanent refusals fail immediately (no retry)", async () => {
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-m3r3-")));
    try {
      scheduleMessage(store, {
        chatJid: "358497773518@s.whatsapp.net",
        payload: "blocked",
        sendAt: new Date(Date.now() - 1000).toISOString(),
      });
      await processDue(store, new Date(), async () => {
        throw new Error("SEND_BLOCKED: blocked by rule #1");
      });
      const row = store.db.prepare("SELECT status FROM scheduled_messages").get() as {
        status: string;
      };
      expect(row.status).toBe("failed");
    } finally {
      store.close();
    }
  });
});

test("T94-F M4 — a chat row with a NULL timestamp still updates from messages", () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-m4chat-")));
  try {
    // history-sync name rows carry no timestamp — CODEX M4: the UPSERT guard
    // `excluded.last_message_ts > chats.last_message_ts` is NULL-false, so
    // those rows never learned their first message
    upsertChatMeta(store, { id: "358497773518@s.whatsapp.net", name: "Synced Name" });
    storeMessage(store, {
      key: { remoteJid: "358497773518@s.whatsapp.net", fromMe: false, id: "FIRST1" },
      message: { conversation: "first!" },
      messageTimestamp: 1_760_000_000,
      pushName: "V",
    } as never);
    const row = store.db
      .prepare("SELECT name, last_message_text, last_message_ts FROM chats WHERE jid = ?")
      .get("358497773518@s.whatsapp.net") as {
      name: string | null;
      last_message_text: string | null;
      last_message_ts: string | null;
    };
    expect(row.name).toBe("Synced Name"); // the name survives (COALESCE)
    expect(row.last_message_text).toBe("first!");
    expect(row.last_message_ts).not.toBeNull();
  } finally {
    store.close();
  }
});

describe("T94-F M9 — manual-unread is readable; backups run", () => {
  test("a manually-unread chat shows unread even with zero unread messages", () => {
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-m9-")));
    try {
      store.db
        .prepare("INSERT INTO chats (jid, name, manual_unread) VALUES (?, ?, 1)")
        .run("358497773518@s.whatsapp.net", "Manual");
      // RUNTIME review M9: chats.manual_unread was WRITE-ONLY — listChats
      // and getUnreadCounts ignored it
      const chats = listChats(store);
      const manual = chats.find((chat) => chat.jid === "358497773518@s.whatsapp.net");
      expect(manual?.unreadCount ?? 0).toBeGreaterThan(0);
    } finally {
      store.close();
    }
  });

  test("bin.ts wires the nightly backup", () => {
    const source = readFileSync(new URL("../../src/bin.ts", import.meta.url), "utf8");
    expect(source).toContain("runBackup(");
    expect(source).toContain("backups");
  });
});
