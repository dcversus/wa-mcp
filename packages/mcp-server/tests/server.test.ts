import { expect, test } from "vite-plus/test";
import {
  handleRpcLine,
  handleRpcMessage,
  SERVER_INFO,
  type JsonRpcResponse,
} from "../src/server.ts";
import { TOOLS } from "../src/tools.ts";

const ctx = { tools: TOOLS, bridgeUrl: "http://127.0.0.1:8080", token: "secret" };

function makeRequest(id: number | string, method: string, params?: unknown): string {
  return JSON.stringify({ jsonrpc: "2.0", id, method, params });
}

function resultOf(response: JsonRpcResponse | null): Record<string, unknown> {
  if (response === null) throw new Error("expected a response");
  return response.result as Record<string, unknown>;
}

test("initialize returns protocol version, capabilities and server info", async () => {
  const response = await handleRpcLine(
    makeRequest(1, "initialize", { protocolVersion: "2025-06-18" }),
    ctx,
  );
  const result = resultOf(response);
  expect(typeof result.protocolVersion).toBe("string");
  expect(result.capabilities).toEqual({ tools: {} });
  expect(result.serverInfo).toEqual(SERVER_INFO);
  expect(SERVER_INFO.name).toBe("wa-mcp");
  expect(typeof SERVER_INFO.version).toBe("string");
});

test("the initialized notification yields no response", async () => {
  const response = await handleRpcLine(
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    ctx,
  );
  expect(response).toBeNull();
});

test("ping answers an empty result", async () => {
  const response = await handleRpcLine(makeRequest(2, "ping"), ctx);
  expect(resultOf(response)).toEqual({});
  expect(response?.id).toBe(2);
});

test("tools/list returns the registry with names, descriptions and input schemas", async () => {
  const response = await handleRpcLine(makeRequest(3, "tools/list"), ctx);
  const tools = resultOf(response).tools as Array<{
    name: string;
    description: string;
    inputSchema: unknown;
  }>;
  expect(tools.map((tool) => tool.name)).toEqual([
    "send_message",
    "list_chats",
    "list_messages",
    "search_messages",
    "get_message_context",
    "send_media",
    "get_chat",
    "send_reaction",
    "edit_message",
    "forward_message",
    "mark_chat_read",
    "set_chat_state",
    "list_contacts",
    "set_alias",
    "get_unread_counts",
  ]);
  for (const tool of tools) {
    expect(typeof tool.description).toBe("string");
    expect(tool.inputSchema).toMatchObject({ type: "object" });
  }
});

test("tools/call dispatches to the registry handler", async () => {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    calls.push({ url: String(url), init: init ?? {} });
    return new Response(JSON.stringify({ message_id: "M1" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  const toolCtx = { ...ctx, fetchFn };
  const response = await handleRpcLine(
    makeRequest(4, "tools/call", {
      name: "send_message",
      arguments: { chat_jid: "358497773518", text: "hi" },
    }),
    toolCtx,
  );
  const result = resultOf(response);
  expect(calls[0]?.url).toBe("http://127.0.0.1:8080/api/send");
  const headers = calls[0]?.init.headers as Record<string, string>;
  expect(headers.authorization).toBe("Bearer secret");
  const content = result.content as Array<{ type: string; text: string }>;
  expect(content[0]?.type).toBe("text");
  expect(content[0]?.text).toContain("M1");
});

test("an unknown tool is an invalid-params error", async () => {
  const response = await handleRpcLine(makeRequest(5, "tools/call", { name: "teleport" }), ctx);
  if (response === null || response.error === undefined)
    throw new Error("expected an error response");
  expect(response.error.code).toBe(-32602);
  expect(response.error.message).toContain("teleport");
});

test("an unknown method is method-not-found", async () => {
  const response = await handleRpcLine(makeRequest(6, "resources/list"), ctx);
  if (response === null || response.error === undefined)
    throw new Error("expected an error response");
  expect(response.error.code).toBe(-32601);
});

test("unparseable lines produce a parse error with null id", async () => {
  const response = await handleRpcLine("{not json", ctx);
  if (response === null || response.error === undefined)
    throw new Error("expected an error response");
  expect(response.error.code).toBe(-32700);
  expect(response.id).toBeNull();
});

test("wrong jsonrpc version is an invalid request", async () => {
  const response = await handleRpcLine(
    JSON.stringify({ jsonrpc: "1.0", id: 7, method: "ping" }),
    ctx,
  );
  if (response === null || response.error === undefined)
    throw new Error("expected an error response");
  expect(response.error.code).toBe(-32600);
});

test("handleRpcMessage accepts already-parsed objects", async () => {
  const response = await handleRpcMessage({ jsonrpc: "2.0", id: "abc", method: "ping" }, ctx);
  expect(resultOf(response)).toEqual({});
  expect(response?.id).toBe("abc");
});

test("missing required tool arguments surface as invalid params", async () => {
  const fetchFn = (async () => new Response("{}", { status: 200 })) as unknown as typeof fetch;
  const toolCtx = { ...ctx, fetchFn };
  const response = await handleRpcLine(
    makeRequest(8, "tools/call", { name: "send_message", arguments: {} }),
    toolCtx,
  );
  if (response === null || response.error === undefined)
    throw new Error("expected an error response");
  expect(response.error.code).toBe(-32602);
  expect(response.error.message).toContain("chat_jid");
});
