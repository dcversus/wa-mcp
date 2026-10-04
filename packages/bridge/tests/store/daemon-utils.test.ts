import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { proto } from "baileys";
import type { WAMessage } from "baileys";
import { openStore } from "../../src/store/schema.ts";
import { storeMessage } from "../../src/store/messages.ts";
import { listMessages } from "../../src/store/queries.ts";
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
    const row = store.db
      .prepare("SELECT status, last_error FROM scheduled_messages")
      .get() as { status: string; last_error?: string | null };
    expect(row.status).toBe("failed");
    expect(row.last_error ?? "").toContain("SEND_BLOCKED");
  } finally {
    store.close();
  }
});
