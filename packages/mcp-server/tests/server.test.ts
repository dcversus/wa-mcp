import { describe, expect, test } from "vite-plus/test";
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
  expect(result.capabilities).toEqual({ tools: {}, resources: {} });
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
    "delete_message",
    "forward_message",
    "mark_chat_read",
    "set_chat_state",
    "list_contacts",
    "set_alias",
    "get_unread_counts",
    "update_profile",
    "set_privacy",
    "block_unblock",
    "get_blocklist",
    "get_media",
    "list_notification_rules",
    "add_notification_rule",
    "delete_notification_rule",
    "create_group",
    "update_group_participants",
    "update_group_meta",
    "leave_group",
    "get_group_invite",
    "transcribe_message",
    "send_voice_note",
    "get_pairing_code",
    "restrict_sending",
    "autoreply_set",
    "create_template",
    "list_templates",
    "send_template",
    "schedule_message",
    "list_scheduled",
    "get_contact",
    "get_picture_url",
    "get_poll_votes",
    "cancel_scheduled",
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
  const response = await handleRpcLine(makeRequest(6, "prompts/list"), ctx);
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

test("resources/list exposes the wa resources", async () => {
  const response = await handleRpcLine(makeRequest(10, "resources/list"), ctx);
  const resources = resultOf(response).resources as Array<{ uri: string; name: string }>;
  expect(resources.map((resource) => resource.uri)).toEqual([
    "wa://chats",
    "wa://unread",
    "wa://health",
  ]);
});

test("resources/read fetches each resource over the bridge api", async () => {
  const calls: Array<string> = [];
  const fetchFn = (async (url: string | URL) => {
    calls.push(String(url));
    const payload = String(url).endsWith("/api/unread")
      ? { unread: [] }
      : String(url).endsWith("/health")
        ? { status: "connected" }
        : { chats: [] };
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  const toolCtx = { ...ctx, fetchFn };
  const chats = await handleRpcLine(
    makeRequest(11, "resources/read", { uri: "wa://chats" }),
    toolCtx,
  );
  expect(calls[0]).toBe("http://127.0.0.1:8080/api/chats");
  const chatsContent =
    (resultOf(chats)?.contents as Array<{ text: string }> | undefined)?.[0]?.text ?? "{}";
  expect(JSON.parse(chatsContent)).toEqual({ chats: [] });
  const unread = await handleRpcLine(
    makeRequest(12, "resources/read", { uri: "wa://unread" }),
    toolCtx,
  );
  expect(calls[1]).toBe("http://127.0.0.1:8080/api/unread");
  const unreadContent =
    (resultOf(unread)?.contents as Array<{ text: string }> | undefined)?.[0]?.text ?? "{}";
  expect(JSON.parse(unreadContent)).toEqual({ unread: [] });
  const health = await handleRpcLine(
    makeRequest(13, "resources/read", { uri: "wa://health" }),
    toolCtx,
  );
  expect(calls[2]).toBe("http://127.0.0.1:8080/health");
  const healthContent =
    (resultOf(health)?.contents as Array<{ text: string }> | undefined)?.[0]?.text ?? "{}";
  expect(JSON.parse(healthContent)).toEqual({ status: "connected" });
  const unknown = await handleRpcLine(
    makeRequest(14, "resources/read", { uri: "wa://nope" }),
    toolCtx,
  );
  if (unknown?.error === undefined) throw new Error("expected an error response");
  expect(unknown.error.code).toBe(-32602);
});

describe("T82-B — daemon utility tools", () => {
  function recordingCtx(
    log: Array<{ url: string; init: RequestInit }>,
    status = 200,
    payload: unknown = {},
  ) {
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      log.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify(payload), {
        status,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    return { ...ctx, fetchFn };
  }

  test("tools/list includes the seven new utility tools", async () => {
    const response = await handleRpcLine(makeRequest(20, "tools/list", {}), ctx);
    const result = resultOf(response);
    const names = (result.tools as Array<{ name: string }>).map((tool) => tool.name);
    for (const expected of [
      "restrict_sending",
      "create_template",
      "list_templates",
      "send_template",
      "schedule_message",
      "list_scheduled",
      "cancel_scheduled",
    ]) {
      expect(names).toContain(expected);
    }
  });

  test("restrict_sending add posts to /api/send-rules", async () => {
    const log: Array<{ url: string; init: RequestInit }> = [];
    await handleRpcLine(
      makeRequest(21, "tools/call", {
        name: "restrict_sending",
        arguments: { action: "add", target: "*@g.us", mode: "block" },
      }),
      recordingCtx(log),
    );
    expect(log[0]?.url).toBe("http://127.0.0.1:8080/api/send-rules");
    expect(JSON.parse(String(log[0]?.init.body))).toEqual({
      target: "*@g.us",
      mode: "block",
    });
  });

  test("send_template fetches the body, renders locally, sends", async () => {
    const log: Array<{ url: string; init: RequestInit }> = [];
    let call = 0;
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      const entry = { url: String(url), init: init ?? {} };
      log.push(entry);
      call += 1;
      const payload =
        call === 1
          ? { templates: [{ name: "greeting", body: "hi {{name}}!" }] }
          : { message_id: "M9" };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const response = await handleRpcLine(
      makeRequest(22, "tools/call", {
        name: "send_template",
        arguments: {
          chat_jid: "358497773518@s.whatsapp.net",
          name: "greeting",
          vars: { name: "Vasilisa" },
        },
      }),
      { ...ctx, fetchFn },
    );
    expect(log[0]?.url).toBe("http://127.0.0.1:8080/api/templates");
    expect(log[1]?.url).toBe("http://127.0.0.1:8080/api/send");
    const sent = JSON.parse(String(log[1]?.init.body));
    expect(sent.text).toBe("hi Vasilisa!");
    const content = resultOf(response).content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain("M9");
  });

  test("send_template with missing vars returns VALIDATION_ERROR and sends nothing", async () => {
    const log: Array<{ url: string; init: RequestInit }> = [];
    let call = 0;
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      call += 1;
      log.push({ url: String(url), init: init ?? {} });
      const payload =
        call === 1 ? { templates: [{ name: "greeting", body: "hi {{name}}, {{event}}!" }] } : {};
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const response = await handleRpcLine(
      makeRequest(25, "tools/call", {
        name: "send_template",
        arguments: {
          chat_jid: "358497773518@s.whatsapp.net",
          name: "greeting",
          vars: { name: "Vasilisa" },
        },
      }),
      { ...ctx, fetchFn },
    );
    expect(log).toHaveLength(1); // only the template fetch — nothing was sent
    const content = resultOf(response).content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain("VALIDATION_ERROR");
    expect(content[0]?.text).toContain("event");
  });

  test("schedule_message posts to /api/scheduled; cancel_scheduled deletes", async () => {
    const log: Array<{ url: string; init: RequestInit }> = [];
    await handleRpcLine(
      makeRequest(23, "tools/call", {
        name: "schedule_message",
        arguments: {
          chat_jid: "358497773518@s.whatsapp.net",
          text: "standup",
          send_at: "2026-10-04T09:00:00Z",
        },
      }),
      recordingCtx(log),
    );
    expect(log[0]?.url).toBe("http://127.0.0.1:8080/api/scheduled");
    expect(JSON.parse(String(log[0]?.init.body))).toEqual({
      chat_jid: "358497773518@s.whatsapp.net",
      text: "standup",
      send_at: "2026-10-04T09:00:00Z",
    });
    await handleRpcLine(
      makeRequest(24, "tools/call", { name: "cancel_scheduled", arguments: { id: 7 } }),
      recordingCtx(log),
    );
    expect(log[1]?.url).toBe("http://127.0.0.1:8080/api/scheduled/7");
    expect(log[1]?.init.method).toBe("DELETE");
  });
});

describe("T86 — MCP prompts capability", () => {
  test("prompts/list returns the three guided workflows", async () => {
    const response = await handleRpcLine(makeRequest(30, "prompts/list", {}), ctx);
    const result = resultOf(response);
    const names = (result.prompts as Array<{ name: string }>).map((p) => p.name);
    expect(names).toEqual(["group-digest", "catch-up", "action-items"]);
  });

  test("prompts/get renders a guided workflow with a pre-filled tool call", async () => {
    const response = await handleRpcLine(
      makeRequest(31, "prompts/get", {
        name: "group-digest",
        arguments: { group: "120363428874442773@g.us", since: "2026-10-01" },
      }),
      ctx,
    );
    const result = resultOf(response);
    const text = (result.messages as Array<{ content: { text: string } }>)[0]?.content.text;
    expect(text).toContain("group-digest");
    expect(text).toContain("digest_group");
    expect(text).toContain("120363428874442773@g.us");
  });
});
