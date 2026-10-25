import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { expect, test } from "vite-plus/test";
import type { SubscriptionConfig } from "@wa-mcp/shared";
import { openStore } from "../src/store/schema.ts";
import { createSubscriptionConfig } from "../src/store/subscription-configs.ts";
import {
  createSubsDispatcher,
  extractMentions,
  likeToRegExp,
  matchesConfig,
  type InboundMessage,
} from "../src/subs-dispatch.ts";

const GROUP = "120363428874442773@g.us";
const ME = "358497773518@s.whatsapp.net";
const ME_LID = "55600000009854@lid";

function config(overrides: Partial<SubscriptionConfig> = {}): SubscriptionConfig {
  return {
    id: "sub1",
    name: "Team",
    chats: [GROUP],
    filter: {},
    delivery: { mode: "inbox" },
    enabled: true,
    created: "2026-10-01T00:00:00.000Z",
    ...overrides,
  };
}

function message(overrides: Partial<InboundMessage> = {}): InboundMessage {
  return {
    chatJid: GROUP,
    rawChatJid: GROUP,
    fromJid: "358400000002@s.whatsapp.net",
    chatName: "Team chat",
    fromName: "Dana",
    id: "3EB0",
    text: "Invoice #42 is overdue",
    media: false,
    mentionedJids: [],
    backlogTsMs: null,
    ...overrides,
  };
}

test.each([
  ["%invoice%", "Invoice #42 is overdue", true],
  ["%INVOICE%", "invoice", true],
  ["invoice", "the invoice is late", true],
  ["invoice%", "Invoice #42", true],
  ["invoice%", "an invoice", false],
  ["%#4_ is%", "Invoice #42 is overdue", true],
  ["%#4_ is%", "Invoice #4 is overdue", false],
  ["%счёт%", "Новый СЧЁТ пришёл", true],
  ["%a.b%", "a.b", true],
  ["%a.b%", "axb", false],
  ["%100\\%%", "we are 100% sure", true],
  ["%100\\%%", "we are 1000 sure", false],
  ["%(x)%", "f(x) = 1", true],
  ["%", "", true],
])("T180 B like — %s against %j → %s", (pattern, text, expected) => {
  expect(likeToRegExp(pattern).test(text)).toBe(expected);
});

test("T180 B match — chat membership, all-chats wildcard and the raw @lid jid", () => {
  expect(matchesConfig(config(), message(), [])).toBe(true);
  expect(matchesConfig(config(), message({ chatJid: "1@g.us", rawChatJid: "1@g.us" }), [])).toBe(
    false,
  );
  expect(matchesConfig(config({ chats: ["*"] }), message({ chatJid: "1@g.us" }), [])).toBe(true);
  expect(
    matchesConfig(
      config({ chats: ["999555000111@lid"] }),
      message({ chatJid: "358400000001@s.whatsapp.net", rawChatJid: "999555000111@lid" }),
      [],
    ),
  ).toBe(true);
});

test("T180 B match — like filter applies to the message text", () => {
  expect(matchesConfig(config({ filter: { like: "%overdue%" } }), message(), [])).toBe(true);
  expect(matchesConfig(config({ filter: { like: "%paid%" } }), message(), [])).toBe(false);
});

test("T180 B match — mentionOnly needs one of our own jids among the mentions", () => {
  const mentionOnly = config({ filter: { mentionOnly: true } });
  expect(matchesConfig(mentionOnly, message(), [ME, ME_LID])).toBe(false);
  expect(
    matchesConfig(mentionOnly, message({ mentionedJids: ["111@s.whatsapp.net"] }), [ME, ME_LID]),
  ).toBe(false);
  expect(matchesConfig(mentionOnly, message({ mentionedJids: [ME_LID] }), [ME, ME_LID])).toBe(true);
  expect(
    matchesConfig(mentionOnly, message({ mentionedJids: ["358497773518:7@s.whatsapp.net"] }), [ME]),
  ).toBe(true);
  expect(matchesConfig(mentionOnly, message({ mentionedJids: [ME] }), [])).toBe(false);
});

test("T180 B match — disabled configs and pre-creation backlog are skipped", () => {
  expect(matchesConfig(config({ enabled: false }), message(), [])).toBe(false);
  expect(
    matchesConfig(config(), message({ backlogTsMs: Date.parse("2026-09-30T00:00:00Z") }), []),
  ).toBe(false);
  expect(
    matchesConfig(config(), message({ backlogTsMs: Date.parse("2026-10-02T00:00:00Z") }), []),
  ).toBe(true);
});

test("T180 B mentions — collected from any content's contextInfo", () => {
  expect(
    extractMentions({
      extendedTextMessage: { text: "hi @me", contextInfo: { mentionedJid: [ME_LID] } },
    }),
  ).toEqual([ME_LID]);
  expect(extractMentions({ imageMessage: { contextInfo: { mentionedJid: [ME, 7] } } })).toEqual([
    ME,
  ]);
  expect(extractMentions({ conversation: "plain" })).toEqual([]);
  expect(extractMentions(null)).toEqual([]);
});

function harness(spawnImpl?: (command: string, args: string[], options: unknown) => EventEmitter) {
  const dataDir = mkdtempSync(join(tmpdir(), "t180-"));
  const store = openStore(dataDir);
  const spawned: Array<{ command: string; args: string[]; options: Record<string, unknown> }> = [];
  const logged: Array<{ obj: unknown; msg?: string }> = [];
  const dispatcher = createSubsDispatcher({
    store,
    subscriptionsDir: dataDir,
    ownJids: () => [ME, ME_LID],
    now: () => new Date("2026-10-08T10:00:00.000Z"),
    spawnFn: ((command: string, args: string[], options: Record<string, unknown>) => {
      spawned.push({ command, args, options });
      const child =
        spawnImpl?.(command, args, options) ?? Object.assign(new EventEmitter(), { unref() {} });
      return Object.assign(child, { unref: () => {} });
    }) as never,
    logger: {
      error: (obj, msg) => logged.push({ obj, msg }),
      warn: (obj, msg) => logged.push({ obj, msg }),
    },
  });
  const lines = (id: string, file: string): Array<Record<string, unknown>> => {
    try {
      return readFileSync(join(dataDir, "subs", id, file), "utf8")
        .trim()
        .split("\n")
        .filter((line) => line.length > 0)
        .map((line) => JSON.parse(line) as Record<string, unknown>);
    } catch {
      return [];
    }
  };
  const cleanup = () => {
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  };
  return { store, dispatcher, spawned, logged, lines, cleanup };
}

const BASE_INPUT = {
  name: "Team",
  chats: [GROUP],
  filter: {},
  enabled: true,
};

test("T180 B inbox — matching message is appended with prompt and subId stamped", () => {
  const h = harness();
  try {
    const sub = createSubscriptionConfig(h.store, {
      ...BASE_INPUT,
      prompt: "Triage invoices",
      delivery: { mode: "inbox" },
    });
    h.dispatcher.invalidate();
    expect(h.dispatcher.dispatch(message())).toBe(1);
    expect(h.lines(sub.id, "inbox.jsonl")).toEqual([
      {
        ts: "2026-10-08T10:00:00.000Z",
        kind: "message",
        chat: GROUP,
        chatName: "Team chat",
        from: "358400000002@s.whatsapp.net",
        fromName: "Dana",
        fromMe: false,
        id: "3EB0",
        text: "Invoice #42 is overdue",
        media: false,
        subId: sub.id,
        prompt: "Triage invoices",
      },
    ]);
  } finally {
    h.cleanup();
  }
});

test.skipIf(process.platform === "win32")(
  "T180 B no match / disabled → nothing written, nothing spawned",
  () => {
    const h = harness();
    try {
      const off = createSubscriptionConfig(h.store, {
        ...BASE_INPUT,
        enabled: false,
        delivery: { mode: "spawn", agent: { command: "claude" } },
      });
      const other = createSubscriptionConfig(h.store, {
        ...BASE_INPUT,
        chats: ["1@g.us"],
        delivery: { mode: "inbox" },
      });
      h.dispatcher.invalidate();
      expect(h.dispatcher.dispatch(message())).toBe(0);
      expect(h.spawned).toEqual([]);
      expect(h.lines(off.id, "inbox.jsonl")).toEqual([]);
      expect(h.lines(other.id, "inbox.jsonl")).toEqual([]);
    } finally {
      h.cleanup();
    }
  },
);

test("T180 B session — appended to the per-sub spool with the target session", () => {
  const h = harness();
  try {
    const picked = createSubscriptionConfig(h.store, {
      ...BASE_INPUT,
      delivery: { mode: "session", session: "claude:b41d09a0" },
    });
    const any = createSubscriptionConfig(h.store, {
      ...BASE_INPUT,
      delivery: { mode: "session" },
    });
    h.dispatcher.invalidate();
    expect(h.dispatcher.dispatch(message())).toBe(2);
    expect(h.lines(picked.id, "session.jsonl")).toEqual([
      expect.objectContaining({
        subId: picked.id,
        session: "claude:b41d09a0",
        text: "Invoice #42 is overdue",
      }),
    ]);
    expect(h.lines(any.id, "session.jsonl")).toEqual([
      expect.objectContaining({ subId: any.id, session: "active" }),
    ]);
    expect(h.lines(picked.id, "inbox.jsonl")).toEqual([]);
  } finally {
    h.cleanup();
  }
});

test("T180 B spawn — detached, stdio ignored, env carries WAMCP_EVENT/WAMCP_SUB/WAMCP_PROMPT + agent env", () => {
  const h = harness();
  try {
    const sub = createSubscriptionConfig(h.store, {
      ...BASE_INPUT,
      prompt: "Reply politely",
      delivery: {
        mode: "spawn",
        agent: {
          command: "/usr/local/bin/claude",
          args: ["-p", "--model", "opus"],
          env: { FOO: "bar" },
        },
      },
    });
    h.dispatcher.invalidate();
    expect(h.dispatcher.dispatch(message())).toBe(1);
    expect(h.spawned).toHaveLength(1);
    const call = h.spawned[0];
    expect(call?.command).toBe("/usr/local/bin/claude");
    expect(call?.args).toEqual(["-p", "--model", "opus"]);
    expect(call?.options).toMatchObject({ detached: true, stdio: "ignore" });
    const env = call?.options.env as Record<string, string>;
    expect(env.FOO).toBe("bar");
    expect(env.WAMCP_SUB).toBe(sub.id);
    expect(env.WAMCP_PROMPT).toBe("Reply politely");
    expect(JSON.parse(env.WAMCP_EVENT ?? "{}")).toMatchObject({
      subId: sub.id,
      text: "Invoice #42 is overdue",
      prompt: "Reply politely",
    });
    expect(env.PATH).toBe(process.env.PATH);
  } finally {
    h.cleanup();
  }
});

test("T180 B spawn — spawn errors and non-zero exits are logged, never thrown", () => {
  const children: EventEmitter[] = [];
  const h = harness(() => {
    const child = new EventEmitter();
    children.push(child);
    return child;
  });
  try {
    createSubscriptionConfig(h.store, {
      ...BASE_INPUT,
      delivery: { mode: "spawn", agent: { command: "missing-agent" } },
    });
    h.dispatcher.invalidate();
    h.dispatcher.dispatch(message());
    children[0]?.emit("error", new Error("spawn missing-agent ENOENT"));
    h.dispatcher.dispatch(message());
    children[1]?.emit("exit", 3);
    h.dispatcher.dispatch(message());
    children[2]?.emit("exit", 0);
    expect(h.logged.map((entry) => entry.msg)).toEqual([
      "subscription spawn failed",
      "subscription agent exited non-zero",
    ]);
  } finally {
    h.cleanup();
  }
});

test("T180 B spawn — a throwing spawnFn is logged and other deliveries continue", () => {
  const h = harness(() => {
    throw new Error("EACCES");
  });
  try {
    createSubscriptionConfig(h.store, {
      ...BASE_INPUT,
      delivery: { mode: "spawn", agent: { command: "x" } },
    });
    const inbox = createSubscriptionConfig(h.store, { ...BASE_INPUT, delivery: { mode: "inbox" } });
    h.dispatcher.invalidate();
    expect(h.dispatcher.dispatch(message())).toBe(2);
    expect(h.logged.map((entry) => entry.msg)).toEqual(["subscription spawn failed"]);
    expect(h.lines(inbox.id, "inbox.jsonl")).toHaveLength(1);
  } finally {
    h.cleanup();
  }
});

test("T180 B cache — configs are cached until invalidate()", () => {
  const h = harness();
  try {
    expect(h.dispatcher.dispatch(message())).toBe(0);
    createSubscriptionConfig(h.store, { ...BASE_INPUT, delivery: { mode: "inbox" } });
    expect(h.dispatcher.dispatch(message())).toBe(0);
    h.dispatcher.invalidate();
    expect(h.dispatcher.dispatch(message())).toBe(1);
  } finally {
    h.cleanup();
  }
});

test.skipIf(process.platform === "win32")(
  "T180 B prepare — inbox/session configs get their empty file up front; spawn gets none",
  () => {
    const h = harness();
    try {
      const inbox = createSubscriptionConfig(h.store, {
        ...BASE_INPUT,
        delivery: { mode: "inbox" },
      });
      const session = createSubscriptionConfig(h.store, {
        ...BASE_INPUT,
        delivery: { mode: "session" },
      });
      const spawned = createSubscriptionConfig(h.store, {
        ...BASE_INPUT,
        delivery: { mode: "spawn", agent: { command: "x" } },
      });
      expect(h.dispatcher.prepare(inbox)).toMatch(/subs\/[a-f0-9]{12}\/inbox\.jsonl$/);
      expect(h.dispatcher.prepare(session)).toMatch(/session\.jsonl$/);
      expect(h.dispatcher.prepare(spawned)).toBeNull();
      expect(h.lines(inbox.id, "inbox.jsonl")).toEqual([]);
      expect(readFileSync(h.dispatcher.prepare(inbox) as string, "utf8")).toBe("");
    } finally {
      h.cleanup();
    }
  },
);
