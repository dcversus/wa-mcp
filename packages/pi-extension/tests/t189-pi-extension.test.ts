import {
  appendFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import extension, {
  createExtension,
  createSpoolTailer,
  render,
  subsDirOf,
  type PiLike,
  type SpoolEvent,
} from "../src/index.ts";

const roots: string[] = [];
afterEach(() => {
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

function waHome(): string {
  const root = mkdtempSync(join(tmpdir(), "t189-pi-"));
  roots.push(root);
  mkdirSync(join(root, "subs"), { recursive: true });
  return root;
}

function spool(home: string, subId: string, initial = ""): string {
  const dir = join(home, "subs", subId);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, "session.jsonl");
  writeFileSync(path, initial);
  return path;
}

function event(overrides: Partial<SpoolEvent> = {}): SpoolEvent {
  return {
    ts: "2026-10-09T10:00:00.000Z",
    kind: "message",
    chat: "1203@g.us",
    chatName: "Family",
    from: "358401@s.whatsapp.net",
    fromName: "Mom",
    text: "dinner at 7?",
    media: false,
    id: "M1",
    subId: "abc",
    session: "active",
    ...overrides,
  };
}

const line = (value: unknown): string => `${JSON.stringify(value)}\n`;

function fakePi(): {
  pi: PiLike;
  sent: Array<{ content: unknown; options: unknown }>;
  fire: (name: string, payload?: unknown) => Promise<void>;
} {
  const handlers = new Map<string, Array<(payload: unknown, ctx: unknown) => unknown>>();
  const sent: Array<{ content: unknown; options: unknown }> = [];
  return {
    sent,
    pi: {
      on(name, handler) {
        handlers.set(name, [...(handlers.get(name) ?? []), handler]);
      },
      async sendUserMessage(content, options) {
        sent.push({ content, options });
      },
    },
    async fire(name, payload = { type: name }) {
      for (const handler of handlers.get(name) ?? []) {
        await handler(payload, {});
      }
    },
  };
}

test("T189 — render names the chat and the sender, quotes the text, asks for a reaction", () => {
  expect(render(event())).toBe(
    "[wa-mcp] message from Mom in Family (chat_jid 1203@g.us, message_id M1): dinner at 7? — your subscription asked you to react",
  );
  expect(render(event({ chatName: null, fromName: null, id: undefined }))).toBe(
    "[wa-mcp] message from 358401@s.whatsapp.net in 1203@g.us (chat_jid 1203@g.us): dinner at 7? — your subscription asked you to react",
  );
  expect(render(event({ prompt: "Summarise and draft a reply" }))).toMatch(
    / — your subscription asks: Summarise and draft a reply$/,
  );
  expect(render(event({ text: "", media: true }))).toContain(": [media] — ");
});

test("T189 — render never carries a token or other unknown fields", () => {
  const rendered = render({ ...event(), token: "s3cret" } as SpoolEvent);
  expect(rendered).not.toContain("s3cret");
});

test("T189 — two appended lines become two follow-up injections, once each", async () => {
  const home = waHome();
  const path = spool(home, "abc", line(event({ id: "OLD" })));
  const delivered: string[] = [];
  const tailer = createSpoolTailer({
    subsDir: join(home, "subs"),
    deliver: (text) => {
      delivered.push(text);
    },
    onError: () => undefined,
  });
  tailer.prime();
  appendFileSync(path, line(event({ id: "M1", text: "first" })));
  appendFileSync(path, line(event({ id: "M2", text: "second" })));
  tailer.poll();
  tailer.poll();
  expect(delivered).toHaveLength(2);
  expect(delivered[0]).toContain(": first —");
  expect(delivered[1]).toContain(": second —");
  expect(delivered.join("\n")).not.toContain("OLD");
});

test("T189 — a malformed line is skipped without throwing; good lines still flow", () => {
  const home = waHome();
  const path = spool(home, "abc");
  const delivered: string[] = [];
  const errors: unknown[] = [];
  const tailer = createSpoolTailer({
    subsDir: join(home, "subs"),
    deliver: (text) => {
      delivered.push(text);
    },
    onError: (err) => errors.push(err),
  });
  tailer.prime();
  appendFileSync(path, "{not json\n");
  appendFileSync(path, line({ nope: true }));
  appendFileSync(path, line(event({ text: "ok" })));
  expect(() => tailer.poll()).not.toThrow();
  expect(delivered).toHaveLength(1);
  expect(delivered[0]).toContain(": ok —");
  expect(errors.length).toBeGreaterThan(0);
});

test("T189 — partial lines wait for their newline; rotation restarts the offset", () => {
  const home = waHome();
  const path = spool(home, "abc");
  const delivered: string[] = [];
  const tailer = createSpoolTailer({
    subsDir: join(home, "subs"),
    deliver: (text) => {
      delivered.push(text);
    },
    onError: () => undefined,
  });
  tailer.prime();
  const whole = line(event({ text: "split" }));
  appendFileSync(path, whole.slice(0, 20));
  tailer.poll();
  expect(delivered).toHaveLength(0);
  appendFileSync(path, whole.slice(20));
  tailer.poll();
  expect(delivered).toHaveLength(1);
  renameSync(path, join(home, "subs", "abc", "session.1.jsonl"));
  writeFileSync(path, line(event({ text: "after rotation, a longer line than before" })));
  tailer.poll();
  expect(delivered).toHaveLength(2);
  expect(delivered[1]).toContain("after rotation");
});

test("T189 — sub dirs without a spool are ignored; a spool born later is read from its start", () => {
  const home = waHome();
  mkdirSync(join(home, "subs", "inbox-only"), { recursive: true });
  writeFileSync(join(home, "subs", "inbox-only", "inbox.jsonl"), line(event({ text: "inbox" })));
  const delivered: string[] = [];
  const tailer = createSpoolTailer({
    subsDir: join(home, "subs"),
    deliver: (text) => {
      delivered.push(text);
    },
    onError: () => undefined,
  });
  tailer.prime();
  tailer.poll();
  expect(delivered).toHaveLength(0);
  spool(home, "late", line(event({ text: "born late" })));
  tailer.poll();
  expect(delivered).toEqual([expect.stringContaining("born late")]);
});

test("T189 — a missing subs dir is not an error", () => {
  const errors: unknown[] = [];
  const tailer = createSpoolTailer({
    subsDir: join(tmpdir(), "t189-does-not-exist", "subs"),
    deliver: () => undefined,
    onError: (err) => errors.push(err),
  });
  expect(() => {
    tailer.prime();
    tailer.poll();
  }).not.toThrow();
  expect(errors).toEqual([]);
});

test("T189 — WA_MCP_HOME overrides ~/.wa-mcp", () => {
  expect(subsDirOf({ WA_MCP_HOME: "/x/wa" }, "/home/u")).toBe(join("/x/wa", "subs"));
  expect(subsDirOf({}, "/home/u")).toBe(join("/home/u", ".wa-mcp", "subs"));
});

test("T189 — the pi factory tails on session_start and injects via sendUserMessage followUp", async () => {
  const home = waHome();
  const path = spool(home, "abc", line(event({ text: "before start" })));
  const { pi, sent, fire } = fakePi();
  await createExtension({ env: { WA_MCP_HOME: home }, intervalMs: 10 })(pi);
  await fire("session_start", { type: "session_start", reason: "startup" });
  appendFileSync(path, line(event({ text: "hello pi" })));
  appendFileSync(path, line(event({ text: "again" })));
  await vi.waitFor(() => expect(sent).toHaveLength(2), { timeout: 2000, interval: 10 });
  expect(sent[0]).toEqual({
    content: expect.stringContaining(": hello pi —"),
    options: { deliverAs: "followUp" },
  });
  expect(sent[1]?.content).toContain(": again —");
  await fire("session_shutdown");
  appendFileSync(path, line(event({ text: "after shutdown" })));
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(sent).toHaveLength(2);
});

test("T189 — a rejecting sendUserMessage is logged once to stderr and never crashes", async () => {
  const home = waHome();
  const path = spool(home, "abc");
  const writes: string[] = [];
  const handlers: Array<(payload: unknown, ctx: unknown) => unknown> = [];
  const pi: PiLike = {
    on: (name, handler) => {
      if (name === "session_start") {
        handlers.push(handler);
      }
    },
    sendUserMessage: async () => {
      throw new Error("busy");
    },
  };
  await createExtension({
    env: { WA_MCP_HOME: home },
    intervalMs: 10,
    stderr: (text) => writes.push(text),
  })(pi);
  for (const handler of handlers) {
    await handler({ type: "session_start", reason: "startup" }, {});
  }
  appendFileSync(path, line(event()));
  appendFileSync(path, line(event()));
  await vi.waitFor(() => expect(writes).toHaveLength(1), { timeout: 2000, interval: 10 });
  await new Promise((resolve) => setTimeout(resolve, 60));
  expect(writes).toHaveLength(1);
  expect(writes[0]).toContain("[wa-mcp]");
});

test("T189 — the default export is a pi extension factory", () => {
  expect(typeof extension).toBe("function");
});

test("T189 — zero runtime deps: the source imports only node builtins and never the token", () => {
  const source = readFileSync(join(import.meta.dirname ?? ".", "..", "src", "index.ts"), "utf8");
  const imports = [...source.matchAll(/from "([^"]+)"/g)].map((match) => match[1]);
  expect(imports.length).toBeGreaterThan(0);
  expect(imports.every((spec) => spec?.startsWith("node:"))).toBe(true);
  expect(source).not.toMatch(/token/i);
  const pkg = JSON.parse(
    readFileSync(join(import.meta.dirname ?? ".", "..", "package.json"), "utf8"),
  ) as { dependencies?: object; keywords: string[] };
  expect(pkg.dependencies).toBeUndefined();
  expect(pkg.keywords).toEqual(expect.arrayContaining(["pi-package", "pi-extension"]));
});

test("T189 — events aimed at another agent's session are not injected into pi", () => {
  const home = waHome();
  const path = spool(home, "abc");
  const delivered: string[] = [];
  const tailer = createSpoolTailer({
    subsDir: join(home, "subs"),
    deliver: (text) => {
      delivered.push(text);
    },
    onError: () => undefined,
  });
  tailer.prime();
  appendFileSync(path, line(event({ text: "claude only", session: "claude:b41d09a0" })));
  appendFileSync(path, line(event({ text: "codex only", session: "codex:1234" })));
  appendFileSync(path, line(event({ text: "active", session: "active" })));
  appendFileSync(path, line(event({ text: "pi session", session: "pi:abcd" })));
  appendFileSync(path, line(event({ text: "untargeted", session: undefined })));
  tailer.poll();
  expect(delivered.map((text) => text.split(": ")[1]?.split(" —")[0])).toEqual([
    "active",
    "pi session",
    "untargeted",
  ]);
});
