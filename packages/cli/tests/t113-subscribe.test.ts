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
      fetchFn: (async (input: RequestInfo | URL, init?: RequestInit) =>
        handler(String(input), init)) as unknown as typeof fetch,
      print: (line: string) => printed.push(line),
    },
  };
}

test("subscribe --chat prints id and inbox path", async () => {
  const { deps, printed } = mkDeps((url) => {
    if (url.endsWith("/api/subscriptions")) {
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
    if (url.endsWith("/api/subscriptions/abc123") && init?.method === "DELETE") {
      return new Response(null, { status: 204 });
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
