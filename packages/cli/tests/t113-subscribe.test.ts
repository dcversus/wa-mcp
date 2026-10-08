import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { drainInbox, runSubscribe, runUnsubscribe } from "../src/subscribe.ts";

function mkDeps(handler: (url: string, init?: RequestInit) => Response) {
  const printed: string[] = [];
  return {
    printed,
    deps: {
      fetchFn: (async (input: string | URL, init?: RequestInit) =>
        handler(String(input), init)) as unknown as typeof fetch,
      print: (line: string) => printed.push(line),
    },
  };
}

test("subscribe --chat creates a subs2 inbox subscription and prints id and inbox path", async () => {
  let sent: unknown;
  const { deps, printed } = mkDeps((url, init) => {
    if (url.endsWith("/api/subs2") && init?.method === "POST") {
      sent = JSON.parse(init.body as string);
      return new Response(JSON.stringify({ id: "abc123", inboxPath: "/subs/abc123/inbox.jsonl" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    throw new Error(`unexpected ${url}`);
  });
  const exit = await runSubscribe(deps, {
    baseUrl: "http://127.0.0.1:8080",
    token: "t",
    chat: "120363428874442773@g.us",
    all: false,
    kind: "message",
  });
  expect(exit).toBe(0);
  expect(printed.join("\n")).toContain("abc123");
  expect(printed.join("\n")).toContain("inbox.jsonl");
  expect(sent).toEqual({
    name: "CLI: 120363428874442773@g.us",
    chats: ["120363428874442773@g.us"],
    filter: {},
    delivery: { mode: "inbox" },
  });
});

test("--all with --chat is rejected (exit 1)", async () => {
  const { deps } = mkDeps(() => {
    throw new Error("fetch must not be called");
  });
  const exit = await runSubscribe(deps, {
    baseUrl: "http://127.0.0.1:8080",
    token: "t",
    chat: "120363428874442773@g.us",
    all: true,
    kind: undefined,
  });
  expect(exit).toBe(1);
});

test("unsubscribe DELETEs and reports", async () => {
  const { deps, printed } = mkDeps((url, init) => {
    if (url.endsWith("/api/subs2/abc123") && init?.method === "DELETE") {
      return Response.json({ ok: true, removed: "abc123" });
    }
    throw new Error(`unexpected ${url}`);
  });
  const exit = await runUnsubscribe(deps, {
    baseUrl: "http://127.0.0.1:8080",
    token: "t",
    id: "abc123",
  });
  expect(exit).toBe(0);
  expect(printed.join("\n")).toContain("abc123");
});

test("inbox drain exits 2 with summary, advances cursor; second run exits 0", () => {
  const dir = mkdtempSync(join(tmpdir(), "t113-"));
  try {
    const inbox = join(dir, "inbox.jsonl");
    const state = join(dir, "cursor");
    writeFileSync(
      inbox,
      [
        JSON.stringify({ chat: "120363428874442773@g.us", text: "first message" }),
        JSON.stringify({ chat: "120363428874442773@g.us", text: "second message" }),
      ].join("\n") + "\n",
    );
    const first = drainInbox(inbox, state);
    expect(first.exit).toBe(2);
    expect(first.summary).toBe("2 new: 120363428874442773@g.us: first message");
    expect(Number(readFileSync(state, "utf8"))).toBeGreaterThan(0);
    const second = drainInbox(inbox, state);
    expect(second.exit).toBe(0);
    expect(second.summary).toBe("inbox: 0 new");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("T148 F5 — draining a missing inbox exits non-zero with the path", () => {
  const result = drainInbox("/nonexistent/inbox.jsonl", "/nonexistent/cursor");
  expect(result.exit).not.toBe(0);
  expect(result.summary).toBe("no such inbox: /nonexistent/inbox.jsonl");
});

test("drain after rotation (file size < cursor) resets and reports new lines", () => {
  const dir = mkdtempSync(join(tmpdir(), "t113-"));
  try {
    const inbox = join(dir, "inbox.jsonl");
    const state = join(dir, "cursor");
    writeFileSync(inbox, "x".repeat(400) + "\n");
    drainInbox(inbox, state);
    writeFileSync(
      inbox,
      JSON.stringify({ chat: "120363428874442773@g.us", text: "after rotation" }) + "\n",
    );
    const result = drainInbox(inbox, state);
    expect(result.exit).toBe(2);
    expect(result.summary).toBe("1 new: 120363428874442773@g.us: after rotation");
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("subscribe rejects an unknown kind filter with the known kinds listed", async () => {
  let called = false;
  const { deps, printed } = mkDeps((url) => {
    called = true;
    void url;
    return new Response("{}", { status: 201 });
  });
  const exit = await runSubscribe(deps, {
    baseUrl: "http://127.0.0.1:8080",
    token: "t",
    chat: "12345@s.whatsapp.net",
    all: false,
    kind: "bogus",
  });
  expect(exit).toBe(1);
  expect(called).toBe(false);
  expect(printed.join("\n")).toContain("message");
  expect(printed.join("\n")).toContain("reaction");
});

test("subscribe reads the bridge token from --data-dir (not the default dir)", async () => {
  const { main } = await import("../src/bin.ts");
  const dir = mkdtempSync(join(tmpdir(), "t113-datadir-"));
  writeFileSync(join(dir, "token"), "dir-token\n");
  const errors: string[] = [];
  const origErr = console.error;
  console.error = (line: unknown) => errors.push(String(line));
  try {
    await main([
      "subscribe",
      "--chat",
      "12345@s.whatsapp.net",
      "--data-dir",
      dir,
      "--bridge-url",
      "http://127.0.0.1:1",
    ]).catch(() => undefined);
  } finally {
    console.error = origErr;
  }
  expect(errors.some((line) => line.includes("no bridge token"))).toBe(false);
  rmSync(dir, { recursive: true, force: true });
});

test("subscribe --kind reaction is rejected as not-yet-dispatched", async () => {
  const { deps, printed } = mkDeps(() => new Response("{}", { status: 201 }));
  const exit = await runSubscribe(deps, {
    baseUrl: "http://127.0.0.1:8080",
    token: "t",
    chat: "12345@s.whatsapp.net",
    all: false,
    kind: "reaction",
  });
  expect(exit).toBe(1);
  expect(printed.join("\n")).toContain("not implemented");
});

test("subscribe with --data-dir sends THAT dir's token to the bridge", async () => {
  const { main } = await import("../src/bin.ts");
  const dir = mkdtempSync(join(tmpdir(), "t113-datadir2-"));
  writeFileSync(join(dir, "token"), "dir-token-xyz\n");
  const seen: Array<{ auth?: string; url: string }> = [];
  const server = await new Promise<import("node:http").Server>((resolve) => {
    const srv = createServer((req, res) => {
      seen.push({ auth: req.headers.authorization, url: String(req.url) });
      res.writeHead(201, { "content-type": "application/json" });
      res.end(JSON.stringify({ id: "probe", inboxPath: "/tmp/x" }));
    });
    srv.listen(0, "127.0.0.1", () => resolve(srv));
  });
  const port = (server.address() as { port: number }).port;
  try {
    await main([
      "subscribe",
      "--chat",
      "12345@s.whatsapp.net",
      "--data-dir",
      dir,
      "--bridge-url",
      `http://127.0.0.1:${port}`,
    ]);
    expect(seen.length).toBeGreaterThan(0);
    expect(seen[0]?.auth).toBe("Bearer dir-token-xyz");
    expect(process.exitCode ?? 0).toBe(0);
    process.exitCode = 0;
  } finally {
    server.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
