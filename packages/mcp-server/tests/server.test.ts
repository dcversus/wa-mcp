import { describe, expect, test } from "vite-plus/test";
import {
  handleRpcLine,
  handleRpcMessage,
  SERVER_INFO,
  type JsonRpcResponse,
} from "../src/server.ts";
import { TOOLS } from "../src/tools.ts";

interface RecordedRequest {
  url: string;
  init: RequestInit & { body?: string };
}

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
  // T99: honest capability declarations — resources/listChanged is declared
  // per dispatch; subscribe stays false until the notifications phase
  expect(result.capabilities).toEqual({
    tools: {},
    resources: { subscribe: true, listChanged: true },
    prompts: {},
    logging: {},
    notifications: {},
    experimental: { "claude/channel": {} },
  });
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
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean };
  }>;
  expect(tools.find((tool) => tool.name === "list_chats")?.annotations?.readOnlyHint).toBe(true);
  expect(tools.find((tool) => tool.name === "delete_message")?.annotations?.destructiveHint).toBe(
    true,
  );
  expect(tools.map((tool) => tool.name)).toEqual([
    "get_login_qr",
    "send_message",
    "list_chats",
    "list_messages",
    "search_messages",
    "get_message_context",
    "catch_up",
    "digest_group",
    "fetch_history",
    "send_media",
    "get_chat",
    "get_group_info",
    "send_reaction",
    "edit_message",
    "delete_message",
    "forward_message",
    "mark_chat_read",
    "set_chat_state",
    "list_contacts",
    "add_contact",
    "rename_contact",
    "remove_contact",
    "set_presence",
    "set_alias",
    "get_unread_counts",
    "update_profile",
    "set_privacy",
    "archive_chat",
    "unarchive_chat",
    "mute_chat",
    "unmute_chat",
    "mark_chat_unread",
    "delete_chat",
    "clear_chat",
    "subscribe_events",
    "unsubscribe_events",
    "get_privacy",
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
    "read_document",
    "send_voice_note",
    "get_pairing_code",
    "restrict_sending",
    "autoreply_set",
    "create_template",
    "list_templates",
    "send_template",
    "schedule_message",
    "list_scheduled",
    "export_chat",
    "export_unread_messages",
    "bulk_clear",
    "label_add",
    "label_list",
    "label_assign",
    "label_remove",
    "download_media",
    "view_media",
    "transcribe_voice",
    "newsletter_follow",
    "newsletter_unfollow",
    "newsletter_send",
    "newsletter_list",
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
  const response = await handleRpcLine(makeRequest(6, "nope/nope"), ctx);
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
    "wa://sync-status",
    "wa://config",
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
  function recordingCtx(log: RecordedRequest[], status = 200, payload: unknown = {}) {
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      log.push({ url: String(url), init: init as RequestInit & { body?: string } });
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
    const log: RecordedRequest[] = [];
    await handleRpcLine(
      makeRequest(21, "tools/call", {
        name: "restrict_sending",
        arguments: { action: "add", target: "*@g.us", mode: "block" },
      }),
      recordingCtx(log),
    );
    expect(log[0]?.url).toBe("http://127.0.0.1:8080/api/send-rules");
    expect(JSON.parse(log[0]?.init.body ?? "{}")).toEqual({
      target: "*@g.us",
      mode: "block",
    });
  });

  test("send_template fetches the body, renders locally, sends", async () => {
    const log: RecordedRequest[] = [];
    let call = 0;
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      const entry = { url: String(url), init: init as RequestInit & { body?: string } };
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
    const sent = JSON.parse(log[1]?.init.body ?? "{}");
    expect(sent.text).toBe("hi Vasilisa!");
    const content = resultOf(response).content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain("M9");
  });

  test("send_template with missing vars returns VALIDATION_ERROR and sends nothing", async () => {
    const log: RecordedRequest[] = [];
    let call = 0;
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      call += 1;
      log.push({ url: String(url), init: init as RequestInit & { body?: string } });
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
    const log: RecordedRequest[] = [];
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
    expect(JSON.parse(log[0]?.init.body ?? "{}")).toEqual({
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
    expect(text).toContain("digest_group");
    expect(text).toContain("120363428874442773@g.us");
    expect(text).toContain("120363428874442773@g.us");
  });
});

describe("T88-B — export/bulk MCP tools", () => {
  function rec() {
    const log: RecordedRequest[] = [];
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      log.push({ url: String(url), init: init as RequestInit & { body?: string } });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    return { log, toolCtx: { ...ctx, fetchFn } };
  }

  test("tools/list includes export_chat, export_unread_messages, bulk_clear", async () => {
    const response = await handleRpcLine(makeRequest(50, "tools/list", {}), ctx);
    const names = (resultOf(response).tools as Array<{ name: string }>).map((t) => t.name);
    expect(names).toContain("export_chat");
    expect(names).toContain("export_unread_messages");
    expect(names).toContain("bulk_clear");
  });

  test("export_chat hits /api/export with chat_jid + format", async () => {
    const { log, toolCtx } = rec();
    await handleRpcLine(
      makeRequest(51, "tools/call", {
        name: "export_chat",
        arguments: { chat_jid: "1@g.us", format: "md" },
      }),
      toolCtx,
    );
    expect(log[0]?.url).toBe("http://127.0.0.1:8080/api/export?chat_jid=1%40g.us&format=md");
  });

  test("export_unread_messages hits /api/export?unread=true", async () => {
    const { log, toolCtx } = rec();
    await handleRpcLine(
      makeRequest(52, "tools/call", { name: "export_unread_messages", arguments: {} }),
      toolCtx,
    );
    expect(log[0]?.url).toBe("http://127.0.0.1:8080/api/export?unread=true&format=jsonl");
  });

  test("bulk_clear posts chat_jids to /api/read-bulk", async () => {
    const { log, toolCtx } = rec();
    await handleRpcLine(
      makeRequest(53, "tools/call", {
        name: "bulk_clear",
        arguments: { chat_jids: ["1@g.us", "2@g.us"] },
      }),
      toolCtx,
    );
    expect(log[0]?.url).toBe("http://127.0.0.1:8080/api/read-bulk");
    expect(JSON.parse(log[0]?.init.body ?? "{}")).toEqual({ chat_jids: ["1@g.us", "2@g.us"] });
  });
});

describe("T89-B GAP2 — label MCP tools", () => {
  test("tools/list includes the four label tools", async () => {
    const response = await handleRpcLine(makeRequest(60, "tools/list", {}), ctx);
    const names = (resultOf(response).tools as Array<{ name: string }>).map((t) => t.name);
    for (const expected of ["label_add", "label_list", "label_assign", "label_remove"]) {
      expect(names).toContain(expected);
    }
  });

  test("label_add posts name+color; label_list GETs; label_assign PUTs; label_remove DELETEs", async () => {
    const log: RecordedRequest[] = [];
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      log.push({ url: String(url), init: init as RequestInit & { body?: string } });
      const payload =
        log.length === 2 ? { labels: [{ id: 1, name: "Work", color: "#ff0000" }] } : { ok: true };
      return new Response(JSON.stringify(payload), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const toolCtx = { ...ctx, fetchFn };
    await handleRpcLine(
      makeRequest(61, "tools/call", {
        name: "label_add",
        arguments: { name: "Work", color: "#ff0000" },
      }),
      toolCtx,
    );
    expect(log[0]?.url).toBe("http://127.0.0.1:8080/api/labels");
    expect(JSON.parse(log[0]?.init.body ?? "{}")).toEqual({ name: "Work", color: "#ff0000" });
    await handleRpcLine(
      makeRequest(62, "tools/call", { name: "label_list", arguments: {} }),
      toolCtx,
    );
    expect(log[1]?.url).toBe("http://127.0.0.1:8080/api/labels");
    await handleRpcLine(
      makeRequest(63, "tools/call", {
        name: "label_assign",
        arguments: { chat_jid: "1@g.us", label_id: 1 },
      }),
      toolCtx,
    );
    expect(log[2]?.init.method).toBe("PUT");
    expect(JSON.parse(log[2]?.init.body ?? "{}")).toEqual({ chat_jid: "1@g.us", label_id: 1 });
    await handleRpcLine(
      makeRequest(64, "tools/call", { name: "label_remove", arguments: { id: 1 } }),
      toolCtx,
    );
    expect(log[3]?.init.method).toBe("DELETE");
  });
});

describe("T90-B — media pipeline MCP tools", () => {
  test("tools/list includes download_media, view_media, transcribe_voice", async () => {
    const response = await handleRpcLine(makeRequest(70, "tools/list", {}), ctx);
    const names = (resultOf(response).tools as Array<{ name: string }>).map((t) => t.name);
    for (const expected of ["download_media", "view_media", "transcribe_voice"]) {
      expect(names).toContain(expected);
    }
  });

  test("download_media POSTs the download route", async () => {
    const log: RecordedRequest[] = [];
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      log.push({ url: String(url), init: init as RequestInit & { body?: string } });
      return new Response(JSON.stringify({ path: "/data/media/DL1.jpg", downloaded: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const response = await handleRpcLine(
      makeRequest(71, "tools/call", { name: "download_media", arguments: { message_id: "DL1" } }),
      { ...ctx, fetchFn },
    );
    expect(log[0]?.url).toBe("http://127.0.0.1:8080/api/media/DL1/download");
    expect(log[0]?.init.method).toBe("POST");
    const content = resultOf(response).content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain("/data/media/DL1.jpg");
  });

  test("view_media posts the view verb and surfaces frames", async () => {
    const log: RecordedRequest[] = [];
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      log.push({ url: String(url), init: init as RequestInit & { body?: string } });
      return new Response(
        JSON.stringify({
          mime: "image/jpeg",
          frames: [{ data_base64: Buffer.from("frame").toString("base64") }],
        }),
        { status: 200, headers: { "content-type": "application/json" } },
      );
    }) as unknown as typeof fetch;
    const response = await handleRpcLine(
      makeRequest(72, "tools/call", {
        name: "view_media",
        arguments: { chat_jid: "1@g.us", message_id: "V1" },
      }),
      { ...ctx, fetchFn },
    );
    expect(log[0]?.url).toBe("http://127.0.0.1:8080/api/media/V1/view");
    expect(log[0]?.init.method).toBe("POST");
    const content = resultOf(response).content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain("image/jpeg");
  });

  test("view_media oversized surfaces PAYLOAD_TOO_LARGE", async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({ error: { code: "PAYLOAD_TOO_LARGE", message: "over the cap" } }),
        { status: 413, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    const response = await handleRpcLine(
      makeRequest(73, "tools/call", {
        name: "view_media",
        arguments: { chat_jid: "1@g.us", message_id: "BIG" },
      }),
      { ...ctx, fetchFn },
    );
    const content = resultOf(response).content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain("PAYLOAD_TOO_LARGE");
  });

  test("transcribe_voice posts the transcription route and returns the text", async () => {
    const log: RecordedRequest[] = [];
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      log.push({ url: String(url), init: init as RequestInit & { body?: string } });
      return new Response(JSON.stringify({ text: "transcribed words", engine: "mock" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const response = await handleRpcLine(
      makeRequest(74, "tools/call", {
        name: "transcribe_voice",
        arguments: { chat_jid: "1@g.us", message_id: "T1" },
      }),
      { ...ctx, fetchFn },
    );
    expect(log[0]?.url).toBe("http://127.0.0.1:8080/api/transcribe");
    expect(JSON.parse(log[0]?.init.body ?? "{}")).toEqual({ chat_jid: "1@g.us", message_id: "T1" });
    const content = resultOf(response).content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain("transcribed words");
  });

  test("transcribe_voice surfaces structured errors from the bridge", async () => {
    const fetchFn = (async () =>
      new Response(
        JSON.stringify({ error: { code: "NOT_FOUND", message: "message has no media" } }),
        { status: 404, headers: { "content-type": "application/json" } },
      )) as unknown as typeof fetch;
    const response = await handleRpcLine(
      makeRequest(75, "tools/call", {
        name: "transcribe_voice",
        arguments: { chat_jid: "1@g.us", message_id: "NOPE" },
      }),
      { ...ctx, fetchFn },
    );
    const content = resultOf(response).content as Array<{ type: string; text: string }>;
    expect(content[0]?.text).toContain("NOT_FOUND");
  });
});

describe("T89-D — newsletter MCP tools", () => {
  test("tools/list includes the four newsletter tools", async () => {
    const response = await handleRpcLine(makeRequest(80, "tools/list", {}), ctx);
    const names = (resultOf(response).tools as Array<{ name: string }>).map((t) => t.name);
    for (const expected of [
      "newsletter_follow",
      "newsletter_unfollow",
      "newsletter_send",
      "newsletter_list",
    ]) {
      expect(names).toContain(expected);
    }
  });

  test("newsletter_follow/unfollow hit their routes", async () => {
    const log: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      log.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ ok: true }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const toolCtx = { ...ctx, fetchFn };
    await handleRpcLine(
      makeRequest(81, "tools/call", {
        name: "newsletter_follow",
        arguments: { jid: "1234@newsletter" },
      }),
      toolCtx,
    );
    expect(log[0]?.url).toBe("http://127.0.0.1:8080/api/newsletters/follow");
    expect(
      JSON.parse(typeof log[0]?.init.body === "string" ? (log[0].init.body as string) : "{}"),
    ).toEqual({
      jid: "1234@newsletter",
    });
    await handleRpcLine(
      makeRequest(82, "tools/call", {
        name: "newsletter_unfollow",
        arguments: { jid: "1234@newsletter" },
      }),
      toolCtx,
    );
    expect(log[1]?.url).toBe("http://127.0.0.1:8080/api/newsletters/unfollow");
  });

  test("newsletter_send posts jid+text; newsletter_list GETs", async () => {
    const log: Array<{ url: string; init: RequestInit }> = [];
    const fetchFn = (async (url: string | URL, init?: RequestInit) => {
      log.push({ url: String(url), init: init ?? {} });
      return new Response(JSON.stringify({ message_id: "NL1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }) as unknown as typeof fetch;
    const toolCtx = { ...ctx, fetchFn };
    await handleRpcLine(
      makeRequest(83, "tools/call", {
        name: "newsletter_send",
        arguments: { jid: "1234@newsletter", text: "bulletin" },
      }),
      toolCtx,
    );
    expect(log[0]?.url).toBe("http://127.0.0.1:8080/api/newsletters/send");
    expect(
      JSON.parse(typeof log[0]?.init.body === "string" ? (log[0].init.body as string) : "{}"),
    ).toEqual({
      jid: "1234@newsletter",
      text: "bulletin",
    });
    await handleRpcLine(
      makeRequest(84, "tools/call", { name: "newsletter_list", arguments: {} }),
      toolCtx,
    );
    expect(log[1]?.url).toBe("http://127.0.0.1:8080/api/newsletters");
  });
});

test("T94-A — the serialized tools/list carries complete hint coverage", async () => {
  const response = await handleRpcLine(makeRequest(930, "tools/list"), ctx);
  const tools = resultOf(response).tools as Array<{
    name: string;
    annotations?: { readOnlyHint?: boolean; destructiveHint?: boolean; idempotentHint?: boolean };
  }>;
  const byName = new Map(tools.map((tool) => [tool.name, tool]));

  const READ_ONLY = [
    "get_chat",
    "label_list",
    "export_chat",
    "export_unread_messages",
    "view_media",
    "download_media",
    "fetch_history",
    "get_group_invite",
    "newsletter_list",
    "transcribe_message",
    "transcribe_voice",
  ] as const;
  for (const name of READ_ONLY) {
    const annotations = byName.get(name)?.annotations;
    if (annotations?.readOnlyHint !== true) {
      throw new Error(`T94-A RED: ${name} is read-only but carries no readOnlyHint`);
    }
  }
  // get_pairing_code mints codes against WhatsApp's pairing endpoint and
  // burns the T56 anti-abuse budget — deliberately NOT read-only
  expect(byName.get("get_pairing_code")?.annotations?.readOnlyHint).toBeUndefined();

  const DESTRUCTIVE = [
    "bulk_clear",
    "label_remove",
    "newsletter_unfollow",
    "label_assign",
  ] as const;
  for (const name of DESTRUCTIVE) {
    const annotations = byName.get(name)?.annotations;
    if (annotations?.destructiveHint !== true) {
      throw new Error(`T94-A RED: ${name} mutates account state but carries no destructiveHint`);
    }
  }

  // mutating-but-benign + reversible: idempotent, not destructive
  expect(byName.get("mark_chat_read")?.annotations?.idempotentHint).toBe(true);

  // the stale map entry (no logout tool exists in the registry)
  expect(byName.has("logout")).toBe(false);
  const { TOOL_ANNOTATIONS } = (await import("../src/tools.ts")) as {
    TOOL_ANNOTATIONS: Record<string, unknown>;
  };
  expect(TOOL_ANNOTATIONS).not.toHaveProperty("logout");
});

test("T94-D-H5claude — bridge failures come back as isError results, not protocol errors", async () => {
  const failing = (async () => {
    throw new Error("bridge request failed: bridge returned 500");
  }) as unknown as typeof fetch;
  const response = await handleRpcLine(
    makeRequest(940, "tools/call", { name: "list_chats", arguments: {} }),
    { ...ctx, fetchFn: failing },
  );
  // RED today: the failure surfaced as a JSON-RPC -32603 protocol error
  expect(response?.error).toBeUndefined();
  const result = resultOf(response) as {
    isError?: boolean;
    content: Array<{ text?: string }>;
  };
  expect(result.isError).toBe(true);
  expect(result.content[0]?.text).toContain("500");
});

test("T94-D-H5claude — param errors stay protocol errors", async () => {
  const response = await handleRpcLine(
    makeRequest(941, "tools/call", { name: "nope_not_real", arguments: {} }),
    ctx,
  );
  expect(response?.error?.code).toBe(-32602);
});

test("T99 — resources expose wa://sync-status and wa://config (no token)", async () => {
  const listResponse = await handleRpcLine(makeRequest(970, "resources/list"), ctx);
  const resources = resultOf(listResponse).resources as Array<{ uri: string; name: string }>;
  const uris = resources.map((resource) => resource.uri);
  expect(uris).toContain("wa://sync-status");
  expect(uris).toContain("wa://config");

  const healthFetch = (async (url: string | URL) => {
    if (String(url).endsWith("/health")) {
      return new Response(JSON.stringify({ connected: true, loggedIn: true }), { status: 200 });
    }
    throw new Error(`unexpected url ${String(url)}`);
  }) as unknown as typeof fetch;
  const readSync = await handleRpcLine(
    makeRequest(971, "resources/read", { uri: "wa://sync-status" }),
    { ...ctx, fetchFn: healthFetch },
  );
  const sync = JSON.parse(
    (resultOf(readSync).contents as Array<{ text: string }>)[0]?.text ?? "{}",
  ) as { connected?: boolean };
  expect(sync.connected).toBe(true);

  const readConfig = await handleRpcLine(
    makeRequest(972, "resources/read", { uri: "wa://config" }),
    ctx,
  );
  const configText = (resultOf(readConfig).contents as Array<{ text: string }>)[0]?.text ?? "";
  expect(configText).toContain(ctx.bridgeUrl);
  expect(configText).toContain('"version":"0.1.0"');
  // the token must NEVER appear in the config resource
  expect(configText).not.toContain(ctx.token);
});
