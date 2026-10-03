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
} from "../../src/store/scheduled.ts";

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
