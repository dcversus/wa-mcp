import { expect, test } from "vite-plus/test";
import { TOOLS } from "../src/tools.ts";
import { handleRpcMessage, type ServerContext } from "../src/server.ts";

const calls: Array<{ method: string; path: string; body?: unknown }> = [];

const ctx: ServerContext = {
  tools: TOOLS,
  bridgeUrl: "http://127.0.0.1:1",
  token: "t",
  fetchFn: (async (input: string | URL, init?: RequestInit) => {
    const url = new URL(String(input));
    calls.push({ method: init?.method ?? "GET", path: url.pathname, body: init?.body });
    if (url.pathname === "/api/subs2" && (init?.method ?? "GET") === "POST") {
      return new Response(JSON.stringify({ id: "sub123", inboxPath: "/subs/sub123/inbox.jsonl" }), {
        status: 201,
        headers: { "content-type": "application/json" },
      });
    }
    if (url.pathname === "/api/subs2/sub123" && init?.method === "DELETE") {
      return new Response(JSON.stringify({ ok: true, removed: "sub123" }), { status: 200 });
    }
    throw new Error(`unexpected ${init?.method} ${url.pathname}`);
  }) as unknown as typeof fetch,
};

test("subscribe_events POSTs a subs2 config and returns id + inboxPath", async () => {
  const res = await handleRpcMessage(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: {
        name: "subscribe_events",
        arguments: {
          chat_jid: "120363428874442773@g.us",
          like: "%invoice%",
          mention_only: true,
          prompt: "Triage",
        },
      },
    },
    ctx,
  );
  const result = (res as { result: { content: Array<{ type: string; text: string }> } }).result;
  const text = result.content[0]?.text ?? "";
  expect(text).toContain("sub123");
  expect(text).toContain("inbox.jsonl");
  expect(calls.at(-1)?.method).toBe("POST");
  expect(calls.at(-1)?.path).toBe("/api/subs2");
  expect(JSON.parse(String(calls.at(-1)?.body))).toEqual({
    name: "MCP: 120363428874442773@g.us",
    chats: ["120363428874442773@g.us"],
    filter: { like: "%invoice%", mentionOnly: true },
    prompt: "Triage",
    delivery: { mode: "inbox" },
  });
});

test("subscribe_events all_chats uses the * wildcard and a custom name", async () => {
  await handleRpcMessage(
    {
      jsonrpc: "2.0",
      id: 4,
      method: "tools/call",
      params: { name: "subscribe_events", arguments: { all_chats: true, name: "Everything" } },
    },
    ctx,
  );
  expect(JSON.parse(String(calls.at(-1)?.body))).toEqual({
    name: "Everything",
    chats: ["*"],
    filter: {},
    delivery: { mode: "inbox" },
  });
});

test("unsubscribe_events DELETEs /api/subs2/<id>", async () => {
  const res = await handleRpcMessage(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "unsubscribe_events", arguments: { id: "sub123" } },
    },
    ctx,
  );
  expect(res).toBeTruthy();
  expect(calls.at(-1)?.method).toBe("DELETE");
  expect(calls.at(-1)?.path).toBe("/api/subs2/sub123");
});

test("tools/list contains both with annotations", async () => {
  const res = await handleRpcMessage(
    { jsonrpc: "2.0", id: 3, method: "tools/list", params: {} },
    ctx,
  );
  const tools = (
    res as { result: { tools: Array<{ name: string; annotations?: Record<string, unknown> }> } }
  ).result.tools;
  const sub = tools.find((t) => t.name === "subscribe_events");
  const unsub = tools.find((t) => t.name === "unsubscribe_events");
  expect(sub).toBeTruthy();
  expect(unsub).toBeTruthy();
  expect(sub?.annotations?.readOnlyHint).toBe(false);
  expect(sub?.annotations?.idempotentHint).toBe(false);
  expect(unsub?.annotations?.idempotentHint).toBe(true);
  expect(tools).toHaveLength(74);
});
