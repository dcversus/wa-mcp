import { describe, expect, test } from "vite-plus/test";
import { TOOLS, toolByName, type ToolContext, type ToolResult } from "../src/tools.ts";

function firstText(result: ToolResult): string {
  const part = result.content[0];
  return part?.type === "text" ? part.text : "";
}

const ctx: ToolContext = { bridgeUrl: "http://bridge.test:8080", token: "tok" };

interface RecordedCall {
  url: string;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

function mockFetch(routes: Record<string, unknown>): {
  fetchFn: typeof fetch;
  calls: Array<RecordedCall>;
} {
  const calls: Array<RecordedCall> = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const key = String(url).replace("http://bridge.test:8080", "");
    calls.push({
      url: String(url),
      method: init?.method,
      body: typeof init?.body === "string" ? init.body : undefined,
      headers: init?.headers as Record<string, string> | undefined,
    });
    const payload = routes[key] ?? {};
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

test("the registry exposes the full launch set", () => {
  expect(TOOLS.map((tool) => tool.name)).toEqual([
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
    "set_presence",
    "set_alias",
    "get_unread_counts",
    "update_profile",
    "set_privacy",
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
  expect(toolByName("send_message")?.name).toBe("send_message");
  expect(toolByName("nope")).toBeUndefined();
});

test("send_message posts to the bridge with the bearer token", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/send": { message_id: "M9" } });
  const tool = toolByName("send_message");
  if (!tool) throw new Error("send_message missing");
  const result = await tool.handler(
    { ...ctx, fetchFn },
    { chat_jid: "358497773518", text: "hello" },
  );
  expect(calls[0]?.url).toBe("http://bridge.test:8080/api/send");
  expect(calls[0]?.method).toBe("POST");
  const headers = calls[0]?.headers ?? {};
  expect(headers.authorization).toBe("Bearer tok");
  expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
    chat_jid: "358497773518",
    text: "hello",
  });
  expect(firstText(result)).toContain("M9");
});

test("T92-B — send_message schema exposes the variant params", () => {
  const tool = toolByName("send_message");
  if (!tool) throw new Error("send_message missing");
  const props = (tool.inputSchema.properties ?? {}) as Record<string, { description?: string }>;
  for (const name of [
    "link_preview",
    "url",
    "status_broadcast",
    "buttons",
    "interactive",
    "list",
  ]) {
    expect(props[name], `missing property: ${name}`).toBeDefined();
  }
  // Business-account caveat must ride the interactive param descriptions
  expect(props.buttons?.description).toContain("Business");
  expect(props.interactive?.description).toContain("Business");
  expect(props.list?.description).toContain("Business");
});

test("T92-B — link_preview + url posts the bridge link_preview kind", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/send": { message_id: "LP1" } });
  const tool = toolByName("send_message");
  if (!tool) throw new Error("send_message missing");
  await tool.handler(
    { ...ctx, fetchFn },
    {
      chat_jid: "358497773518@s.whatsapp.net",
      text: "look",
      link_preview: true,
      url: "https://example.com/x",
    },
  );
  expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
    kind: "link_preview",
    chat_jid: "358497773518@s.whatsapp.net",
    text: "look",
    url: "https://example.com/x",
  });
});

test("T92-B — link_preview without url extracts the first URL from text", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/send": { message_id: "LP2" } });
  const tool = toolByName("send_message");
  if (!tool) throw new Error("send_message missing");
  await tool.handler(
    { ...ctx, fetchFn },
    {
      chat_jid: "358497773518@s.whatsapp.net",
      text: "see https://example.com/y now",
      link_preview: true,
    },
  );
  expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
    kind: "link_preview",
    chat_jid: "358497773518@s.whatsapp.net",
    text: "see https://example.com/y now",
    url: "https://example.com/y",
  });
});

test("T92-B — link_preview with no resolvable URL errors", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/send": { message_id: "LP3" } });
  const tool = toolByName("send_message");
  if (!tool) throw new Error("send_message missing");
  await expect(
    tool.handler(
      { ...ctx, fetchFn },
      { chat_jid: "358497773518@s.whatsapp.net", text: "no link here", link_preview: true },
    ),
  ).rejects.toThrow("url");
  expect(calls).toHaveLength(0);
});

test("T92-B — status_broadcast posts the status-text kind without chat_jid", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/send": { message_id: "SB1" } });
  const tool = toolByName("send_message");
  if (!tool) throw new Error("send_message missing");
  await tool.handler({ ...ctx, fetchFn }, { text: "day one", status_broadcast: true });
  expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ kind: "status-text", text: "day one" });
});

test("T92-B — buttons posts the bridge buttons kind with labels", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/send": { message_id: "BT1" } });
  const tool = toolByName("send_message");
  if (!tool) throw new Error("send_message missing");
  await tool.handler(
    { ...ctx, fetchFn },
    {
      chat_jid: "358497773518@s.whatsapp.net",
      text: "pick",
      buttons: [{ label: "Yes" }, { label: "No" }],
    },
  );
  expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
    kind: "buttons",
    chat_jid: "358497773518@s.whatsapp.net",
    text: "pick",
    buttons: ["Yes", "No"],
  });
});

test("T92-B — interactive folds title/description/footer into the buttons kind", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/send": { message_id: "IN1" } });
  const tool = toolByName("send_message");
  if (!tool) throw new Error("send_message missing");
  await tool.handler(
    { ...ctx, fetchFn },
    {
      chat_jid: "358497773518@s.whatsapp.net",
      interactive: {
        title: "Appointment",
        description: "Confirm your slot",
        footer: "Reply within 24h",
        buttons: [{ label: "Confirm" }, { label: "Reschedule" }],
      },
    },
  );
  expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
    kind: "buttons",
    chat_jid: "358497773518@s.whatsapp.net",
    text: "Appointment\nConfirm your slot",
    caption: "Reply within 24h",
    buttons: ["Confirm", "Reschedule"],
  });
});

test("T92-B — list posts the bridge list kind with row ids", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/send": { message_id: "LS1" } });
  const tool = toolByName("send_message");
  if (!tool) throw new Error("send_message missing");
  await tool.handler(
    { ...ctx, fetchFn },
    {
      chat_jid: "358497773518@s.whatsapp.net",
      list: {
        title: "Menu",
        description: "Pick a section",
        sections: [
          { title: "Food", rows: [{ title: "Pizza", description: "Large" }] },
          { title: "Drinks", rows: [{ title: "Water" }] },
        ],
      },
    },
  );
  expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
    kind: "list",
    chat_jid: "358497773518@s.whatsapp.net",
    text: "Menu\nPick a section",
    sections: [
      { title: "Food", rows: [{ title: "Pizza", row_id: "r0-0", description: "Large" }] },
      { title: "Drinks", rows: [{ title: "Water", row_id: "r1-0" }] },
    ],
  });
});

test("T92-B — combining two variants is rejected", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/send": { message_id: "X1" } });
  const tool = toolByName("send_message");
  if (!tool) throw new Error("send_message missing");
  await expect(
    tool.handler(
      { ...ctx, fetchFn },
      { chat_jid: "a@s.whatsapp.net", text: "x", status_broadcast: true, link_preview: true },
    ),
  ).rejects.toThrow("only one");
  expect(calls).toHaveLength(0);
});

test("T93-B — catch_up hits GET /api/catch-up with since", async () => {
  const { fetchFn, calls } = mockFetch({
    "/api/catch-up?since=2026-05-01T00:00:00Z": { activeChats: [], questions: [] },
  });
  const tool = toolByName("catch_up");
  if (!tool) throw new Error("catch_up missing");
  await tool.handler({ ...ctx, fetchFn }, { since: "2026-05-01T00:00:00Z" });
  expect(calls[0]?.url).toBe("http://bridge.test:8080/api/catch-up?since=2026-05-01T00%3A00%3A00Z");
  expect(calls[0]?.method).toBe("GET");
});

test("T93-B — digest_group hits GET /api/digest with chat_jid and since", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/digest": { message_count: 3 } });
  const tool = toolByName("digest_group");
  if (!tool) throw new Error("digest_group missing");
  await tool.handler(
    { ...ctx, fetchFn },
    { chat_jid: "120363428874442773@g.us", since: "2026-05-01T00:00:00Z" },
  );
  expect(calls[0]?.method).toBe("GET");
  const parsed = new URL(calls[0]?.url ?? "");
  expect(parsed.pathname).toBe("/api/digest");
  expect(parsed.searchParams.get("chat_jid")).toBe("120363428874442773@g.us");
  expect(parsed.searchParams.get("since")).toBe("2026-05-01T00:00:00Z");
});

test("T93-B — fetch_history posts chat_jid and optional count", async () => {
  const { fetchFn, calls } = mockFetch({
    "/api/fetch-history": { requested: true, request_id: "R1" },
  });
  const tool = toolByName("fetch_history");
  if (!tool) throw new Error("fetch_history missing");
  const result = await tool.handler(
    { ...ctx, fetchFn },
    { chat_jid: "358497773518@s.whatsapp.net", count: 50 },
  );
  expect(calls[0]?.method).toBe("POST");
  expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
    chat_jid: "358497773518@s.whatsapp.net",
    count: 50,
  });
  expect(firstText(result)).toContain("R1");
  // count omitted — the bridge defaults to 25
  await tool.handler({ ...ctx, fetchFn }, { chat_jid: "358497773518@s.whatsapp.net" });
  expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
    chat_jid: "358497773518@s.whatsapp.net",
  });
});

test("T93-B — search_messages takes query (q stays a legacy alias)", async () => {
  const tool = toolByName("search_messages");
  if (!tool) throw new Error("search_messages missing");
  const props = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
  expect(props.query).toBeDefined();
  const required = (tool.inputSchema.required ?? []) as string[];
  expect(required).toContain("query");
  const { fetchFn, calls } = mockFetch({ "/api/search": { results: [] } });
  await tool.handler({ ...ctx, fetchFn }, { query: "release plan" });
  const parsed = new URL(calls[0]?.url ?? "");
  expect(parsed.pathname).toBe("/api/search");
  expect(parsed.searchParams.get("q")).toBe("release plan");
  // legacy q still reaches the bridge
  await tool.handler({ ...ctx, fetchFn }, { q: "legacy" });
  const legacy = new URL(calls[1]?.url ?? "");
  expect(legacy.searchParams.get("q")).toBe("legacy");
});

test("T94-B — send_message schema exposes location/contact/poll params", () => {
  const tool = toolByName("send_message");
  if (!tool) throw new Error("send_message missing");
  const props = (tool.inputSchema.properties ?? {}) as Record<string, unknown>;
  for (const name of ["location", "contact", "poll"]) {
    expect(props[name], `missing property: ${name}`).toBeDefined();
  }
});

test("T94-B — location posts the bridge location kind", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/send": { message_id: "LOC1" } });
  const tool = toolByName("send_message");
  if (!tool) throw new Error("send_message missing");
  await tool.handler(
    { ...ctx, fetchFn },
    {
      chat_jid: "358497773518@s.whatsapp.net",
      location: { latitude: 60.17, longitude: 24.94, label: "office" },
    },
  );
  expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
    kind: "location",
    chat_jid: "358497773518@s.whatsapp.net",
    latitude: 60.17,
    longitude: 24.94,
    label: "office",
  });
});

test("T94-B — contact posts the bridge contact kind with a vcard-backed body", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/send": { message_id: "CT1" } });
  const tool = toolByName("send_message");
  if (!tool) throw new Error("send_message missing");
  await tool.handler(
    { ...ctx, fetchFn },
    {
      chat_jid: "358497773518@s.whatsapp.net",
      contact: { name: "Ada", phones: ["+358497773518", "+15550100"] },
    },
  );
  expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
    kind: "contact",
    chat_jid: "358497773518@s.whatsapp.net",
    contact_name: "Ada",
    phones: ["+358497773518", "+15550100"],
  });
});

test("T94-B — poll posts the bridge poll kind (selectableCount optional)", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/send": { message_id: "PL1" } });
  const tool = toolByName("send_message");
  if (!tool) throw new Error("send_message missing");
  await tool.handler(
    { ...ctx, fetchFn },
    {
      chat_jid: "120363428874442773@g.us",
      poll: { question: "Lunch?", options: ["Pizza", "Salad"] },
    },
  );
  expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
    kind: "poll",
    chat_jid: "120363428874442773@g.us",
    poll_name: "Lunch?",
    options: ["Pizza", "Salad"],
  });
  await tool.handler(
    { ...ctx, fetchFn },
    {
      chat_jid: "120363428874442773@g.us",
      poll: { question: "Pick", options: ["A", "B"], selectableCount: 1 },
    },
  );
  expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
    kind: "poll",
    chat_jid: "120363428874442773@g.us",
    poll_name: "Pick",
    options: ["A", "B"],
    selectable_count: 1,
  });
});

test("T94-B — bridge validation errors pass through structured", async () => {
  const failingFetch = (async () =>
    new Response(
      JSON.stringify({
        error: {
          code: "VALIDATION_ERROR",
          message: "options must have between 2 and 12 unique entries",
        },
      }),
      { status: 400, headers: { "content-type": "application/json" } },
    )) as unknown as typeof fetch;
  const tool = toolByName("send_message");
  if (!tool) throw new Error("send_message missing");
  await expect(
    tool.handler(
      { ...ctx, fetchFn: failingFetch },
      {
        chat_jid: "120363428874442773@g.us",
        poll: { question: "Bad", options: ["only-one"] },
      },
    ),
  ).rejects.toThrow("options must have between 2 and 12 unique entries");
});

test("T94-B — combining location with poll is rejected", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/send": { message_id: "X" } });
  const tool = toolByName("send_message");
  if (!tool) throw new Error("send_message missing");
  await expect(
    tool.handler(
      { ...ctx, fetchFn },
      {
        chat_jid: "a@s.whatsapp.net",
        location: { latitude: 1, longitude: 2 },
        poll: { question: "q", options: ["a", "b"] },
      },
    ),
  ).rejects.toThrow("only one");
  expect(calls).toHaveLength(0);
});

test("T94-B — set_presence posts the bridge presence route", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/presence": { ok: true } });
  const tool = toolByName("set_presence");
  if (!tool) throw new Error("set_presence missing");
  await tool.handler(
    { ...ctx, fetchFn },
    { chat_jid: "358497773518@s.whatsapp.net", presence: "composing" },
  );
  expect(calls[0]?.method).toBe("POST");
  expect(calls[0]?.url).toBe("http://bridge.test:8080/api/presence");
  expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
    chat_jid: "358497773518@s.whatsapp.net",
    presence: "composing",
  });
});

test("T94-D-H1claude — reply_to_message_id and mentions reach the bridge body", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/send": { message_id: "RP1" } });
  const tool = toolByName("send_message");
  if (!tool) throw new Error("send_message missing");
  await tool.handler(
    { ...ctx, fetchFn },
    {
      chat_jid: "358497773518@s.whatsapp.net",
      text: "look up",
      reply_to_message_id: "MID9",
      mentions: ["358400000001@s.whatsapp.net", "358400000002@s.whatsapp.net"],
    },
  );
  // review CLAUDE H1: the bridge validates and wires quoted context +
  // mentionedJid, but the tool never forwarded them
  expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
    chat_jid: "358497773518@s.whatsapp.net",
    text: "look up",
    reply_to_message_id: "MID9",
    mentions: ["358400000001@s.whatsapp.net", "358400000002@s.whatsapp.net"],
  });
});

test("T94-D-H4claude — list_messages and list_chats pass offset through", async () => {
  const { fetchFn, calls } = mockFetch({
    "/api/messages?chat_jid=a%40s.whatsapp.net&limit=25&offset=40": {
      messages: [],
      meta: { nextOffset: 65 },
    },
    "/api/chats?limit=50&offset=25": { chats: [] },
  });
  const messages = toolByName("list_messages");
  if (!messages) throw new Error("list_messages missing");
  await messages.handler(
    { ...ctx, fetchFn },
    { chat_jid: "a@s.whatsapp.net", limit: 25, offset: 40 },
  );
  expect(calls[0]?.url).toBe(
    "http://bridge.test:8080/api/messages?chat_jid=a%40s.whatsapp.net&limit=25&offset=40",
  );
  const chats = toolByName("list_chats");
  if (!chats) throw new Error("list_chats missing");
  await chats.handler({ ...ctx, fetchFn }, { limit: 50, offset: 25 });
  expect(calls[1]?.url).toBe("http://bridge.test:8080/api/chats?limit=50&offset=25");
});

test("T94-D-H3claude — get_chat merges group participants; get_group_info reads meta", async () => {
  const { fetchFn, calls } = mockFetch({
    "/api/chats?limit=200": {
      chats: [{ jid: "120363428874442773@g.us", name: "Test Group", unreadCount: 0 }],
    },
    "/api/group/info?jid=120363428874442773%40g.us": {
      id: "120363428874442773@g.us",
      subject: "Test Group",
      desc: "a group",
      participants: [
        { id: "358497773518@s.whatsapp.net", admin: "admin" },
        { id: "358400000077@s.whatsapp.net", admin: null },
      ],
    },
  });
  const chat = toolByName("get_chat");
  if (!chat) throw new Error("get_chat missing");
  const merged = await chat.handler({ ...ctx, fetchFn }, { chat_jid: "120363428874442773@g.us" });
  // review CLAUDE H3 / GOAL 124: group chats expose their roster
  expect(firstText(merged)).toContain("358400000077@s.whatsapp.net");
  const parsed = JSON.parse(firstText(merged)) as {
    chat: { jid: string };
    participants: Array<{ id: string; admin: string | null }>;
  };
  expect(parsed.chat.jid).toBe("120363428874442773@g.us");
  expect(parsed.participants).toHaveLength(2);

  const info = toolByName("get_group_info");
  if (!info) throw new Error("get_group_info missing");
  const infoResult = await info.handler(
    { ...ctx, fetchFn },
    { chat_jid: "120363428874442773@g.us" },
  );
  expect(calls[1]?.url).toBe(
    "http://bridge.test:8080/api/group/info?jid=120363428874442773%40g.us",
  );
  const infoBody = JSON.parse(firstText(infoResult)) as {
    subject: string;
    participants: Array<{ admin: string | null }>;
  };
  expect(infoBody.subject).toBe("Test Group");
  expect(infoBody.participants[0]?.admin).toBe("admin");
  expect((info.inputSchema.properties ?? {}) as unknown).toBeDefined();
});

test("T97c — get_chat with_photo merges the profile picture URL", async () => {
  const { fetchFn, calls } = mockFetch({
    "/api/chats?limit=200": {
      chats: [{ jid: "358497773518@s.whatsapp.net", name: "V", unreadCount: 0 }],
    },
    "/api/picture-url": { url: "https://pps.example/v.jpg" },
  });
  const tool = toolByName("get_chat");
  if (!tool) throw new Error("get_chat missing");
  const result = await tool.handler(
    { ...ctx, fetchFn },
    { chat_jid: "358497773518@s.whatsapp.net", with_photo: true },
  );
  expect(calls[1]?.url).toBe("http://bridge.test:8080/api/picture-url");
  expect(calls[1]?.method).toBe("POST");
  expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({ jid: "358497773518@s.whatsapp.net" });
  const parsed = JSON.parse(firstText(result)) as { pictureUrl?: string };
  expect(parsed.pictureUrl).toBe("https://pps.example/v.jpg");
  // default: no photo lookup
  await tool.handler({ ...ctx, fetchFn }, { chat_jid: "358497773518@s.whatsapp.net" });
  expect(calls).toHaveLength(3);
});

test("list_chats fetches the chat list and returns json text", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/chats?limit=50": { chats: [{ jid: "a@g.us" }] } });
  const tool = toolByName("list_chats");
  if (!tool) throw new Error("list_chats missing");
  const result = await tool.handler({ ...ctx, fetchFn }, { limit: 50 });
  expect(calls[0]?.url).toBe("http://bridge.test:8080/api/chats?limit=50");
  expect(calls[0]?.method).toBe("GET");
  expect(JSON.parse(firstText(result) || "{}")).toEqual({ chats: [{ jid: "a@g.us" }] });
});

test("list_messages and search_messages pass their filters through", async () => {
  const { fetchFn, calls } = mockFetch({
    "/api/messages?chat_jid=g%40us&limit=10": { messages: [] },
    "/api/search?q=pizza&limit=25": { messages: [] },
  });
  const toolCtx = { ...ctx, fetchFn };
  const list = toolByName("list_messages");
  if (!list) throw new Error("list_messages missing");
  await list.handler(toolCtx, { chat_jid: "g@us", limit: 10 });
  const search = toolByName("search_messages");
  if (!search) throw new Error("search_messages missing");
  await search.handler(toolCtx, { q: "pizza", limit: 25 });
  expect(calls.map((call) => call.url.replace("http://bridge.test:8080", ""))).toEqual([
    "/api/messages?chat_jid=g%40us&limit=10",
    "/api/search?q=pizza&limit=25",
  ]);
});

test("get_message_context fetches the adjacent window", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/context?message_id=M1&radius=2": { messages: [] } });
  const tool = toolByName("get_message_context");
  if (!tool) throw new Error("get_message_context missing");
  await tool.handler({ ...ctx, fetchFn }, { message_id: "M1", radius: 2 });
  expect(calls[0]?.url).toBe("http://bridge.test:8080/api/context?message_id=M1&radius=2");
});

test("send_media posts the media body to /api/send", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/send": { message_id: "MM1" } });
  const tool = toolByName("send_media");
  if (!tool) throw new Error("send_media missing");
  const result = await tool.handler(
    { ...ctx, fetchFn },
    {
      kind: "image",
      chat_jid: "358497773518",
      media: { base64: "aGk=" },
      caption: "cap",
      file_name: "x.png",
    },
  );
  const body = JSON.parse(calls[0]?.body ?? "{}") as Record<string, unknown>;
  expect(body.kind).toBe("image");
  expect(body.chat_jid).toBe("358497773518");
  expect(body.media).toEqual({ base64: "aGk=" });
  expect(body.caption).toBe("cap");
  expect(body.file_name).toBe("x.png");
  expect(firstText(result)).toContain("MM1");
});

test("get_chat finds one chat from the chat list", async () => {
  const { fetchFn, calls } = mockFetch({
    "/api/chats?limit=200": { chats: [{ jid: "120363428874442773@g.us", name: "Test" }] },
  });
  const tool = toolByName("get_chat");
  if (!tool) throw new Error("get_chat missing");
  const result = await tool.handler({ ...ctx, fetchFn }, { chat_jid: "120363428874442773@g.us" });
  expect(calls[0]?.url).toBe("http://bridge.test:8080/api/chats?limit=200");
  expect(firstText(result)).toContain("Test");
  const missing = await tool.handler({ ...ctx, fetchFn }, { chat_jid: "nope@g.us" });
  expect(firstText(missing)).toContain("not found");
});

test("reaction, edit and forward route their kinds", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/send": { message_id: "K1" } });
  const toolCtx = { ...ctx, fetchFn };
  const reaction = toolByName("send_reaction");
  if (!reaction) throw new Error("send_reaction missing");
  await reaction.handler(toolCtx, { chat_jid: "g", message_id: "T1", emote: "👍" });
  const edit = toolByName("edit_message");
  if (!edit) throw new Error("edit_message missing");
  await edit.handler(toolCtx, { chat_jid: "g", message_id: "T1", text: "v2" });
  const forward = toolByName("forward_message");
  if (!forward) throw new Error("forward_message missing");
  await forward.handler(toolCtx, { chat_jid: "g", message_id: "T1" });
  const bodies = calls.map((call) => JSON.parse(call.body ?? "{}") as Record<string, unknown>);
  expect(bodies[0]).toEqual({ kind: "reaction", chat_jid: "g", message_id: "T1", emote: "👍" });
  expect(bodies[1]).toEqual({ kind: "edit", chat_jid: "g", message_id: "T1", text: "v2" });
  expect(bodies[2]).toEqual({ kind: "forward", chat_jid: "g", message_id: "T1" });
});

test("mark_chat_read collects unread ids then posts them", async () => {
  const { fetchFn, calls } = mockFetch({
    "/api/messages?chat_jid=g&limit=200": {
      messages: [
        { id: "U1", isUnread: true },
        { id: "OLD", isUnread: false },
      ],
    },
    "/api/read": { read: 1 },
  });
  const tool = toolByName("mark_chat_read");
  if (!tool) throw new Error("mark_chat_read missing");
  await tool.handler({ ...ctx, fetchFn }, { chat_jid: "g" });
  expect(calls[1]?.url).toBe("http://bridge.test:8080/api/read");
  expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({ chat_jid: "g", message_ids: ["U1"] });
});

test("set_chat_state posts its flags", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/chat/state": { ok: true } });
  const tool = toolByName("set_chat_state");
  if (!tool) throw new Error("set_chat_state missing");
  await tool.handler(
    { ...ctx, fetchFn },
    { chat_jid: "g", archived: true, muted_until: "2026-10-03T00:00:00.000Z" },
  );
  expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
    chat_jid: "g",
    archived: true,
    muted_until: "2026-10-03T00:00:00.000Z",
  });
});

test("list_contacts, set_alias and get_unread_counts call their endpoints", async () => {
  const { fetchFn, calls } = mockFetch({
    "/api/contacts?query=jo": { contacts: [{ jid: "x", name: "John" }] },
    "/api/alias": { ok: true },
    "/api/unread": { unread: [{ chatJid: "g", unreadCount: 2 }] },
  });
  const toolCtx = { ...ctx, fetchFn };
  const contacts = toolByName("list_contacts");
  if (!contacts) throw new Error("list_contacts missing");
  const contactResult = await contacts.handler(toolCtx, { query: "jo" });
  expect(firstText(contactResult)).toContain("John");
  const alias = toolByName("set_alias");
  if (!alias) throw new Error("set_alias missing");
  await alias.handler(toolCtx, { alias: "me", jid: "358497773518@s.whatsapp.net" });
  expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
    alias: "me",
    jid: "358497773518@s.whatsapp.net",
  });
  const unread = toolByName("get_unread_counts");
  if (!unread) throw new Error("get_unread_counts missing");
  const unreadResult = await unread.handler(toolCtx, {});
  expect(firstText(unreadResult)).toContain("unreadCount");
  expect(calls.map((call) => call.url.replace("http://bridge.test:8080", ""))).toEqual([
    "/api/contacts?query=jo",
    "/api/alias",
    "/api/unread",
  ]);
});

test("update_profile posts name and status", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/profile": { ok: true } });
  const tool = toolByName("update_profile");
  if (!tool) throw new Error("update_profile missing");
  await tool.handler({ ...ctx, fetchFn }, { name: "New Name", status: "about" });
  expect(calls[0]?.url).toBe("http://bridge.test:8080/api/profile");
  expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ name: "New Name", status: "about" });
});

test("set_privacy posts the key-value patch", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/privacy": { applied: [] } });
  const tool = toolByName("set_privacy");
  if (!tool) throw new Error("set_privacy missing");
  await tool.handler({ ...ctx, fetchFn }, { key: "readReceipts", value: "none" });
  expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ readReceipts: "none" });
});

test("block_unblock posts the action and get_blocklist reads the list", async () => {
  const { fetchFn, calls } = mockFetch({
    "/api/block": { ok: true },
    "/api/blocklist": { blocklist: ["999@s.whatsapp.net"] },
  });
  const toolCtx = { ...ctx, fetchFn };
  const block = toolByName("block_unblock");
  if (!block) throw new Error("block_unblock missing");
  await block.handler(toolCtx, { jid: "999@s.whatsapp.net", block: true });
  expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ jid: "999@s.whatsapp.net", block: true });
  const list = toolByName("get_blocklist");
  if (!list) throw new Error("get_blocklist missing");
  const result = await list.handler(toolCtx, {});
  expect(firstText(result)).toContain("999@s.whatsapp.net");
});

test("get_media triggers the download and returns metadata", async () => {
  const { fetchFn, calls } = mockFetch({
    "/api/media/M1": { path: "/data/media/M1.png", mime: "image/png", size: 16 },
  });
  const tool = toolByName("get_media");
  if (!tool) throw new Error("get_media missing");
  const result = await tool.handler({ ...ctx, fetchFn }, { message_id: "M1" });
  expect(calls[0]?.url).toBe("http://bridge.test:8080/api/media/M1");
  expect(calls[0]?.method).toBe("POST");
  expect(firstText(result)).toContain("M1.png");
  expect(firstText(result)).toContain("image/png");
});

test("notification rule tools hit their endpoints", async () => {
  const { fetchFn, calls } = mockFetch({
    "/api/notifications": { rules: [] },
    "/api/notifications/7": { ok: true },
  });
  const toolCtx = { ...ctx, fetchFn };
  const list = toolByName("list_notification_rules");
  if (!list) throw new Error("list_notification_rules missing");
  await list.handler(toolCtx, {});
  const add = toolByName("add_notification_rule");
  if (!add) throw new Error("add_notification_rule missing");
  await add.handler(toolCtx, { title: "ping", chat_jid: "g@g.us", unread_only: true });
  const remove = toolByName("delete_notification_rule");
  if (!remove) throw new Error("delete_notification_rule missing");
  await remove.handler(toolCtx, { id: 7 });
  expect(
    calls.map((call) => [call.method, call.url.replace("http://bridge.test:8080", "")]),
  ).toEqual([
    ["GET", "/api/notifications"],
    ["POST", "/api/notifications"],
    ["DELETE", "/api/notifications/7"],
  ]);
  expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({
    title: "ping",
    chat_jid: "g@g.us",
    unread_only: true,
  });
});

test("group tools drive their endpoints", async () => {
  const { fetchFn, calls } = mockFetch({
    "/api/group/create": { group: { id: "G1@g.us" } },
    "/api/group/participants": { results: [] },
    "/api/group/meta": { ok: true },
    "/api/group/leave": { ok: true },
    "/api/group/invite/g%40us": { invite_code: "CODE9" },
  });
  const toolCtx = { ...ctx, fetchFn };
  const create = toolByName("create_group");
  if (!create) throw new Error("create_group missing");
  await create.handler(toolCtx, {
    subject: "Test Group",
    participants: ["358401111111@s.whatsapp.net"],
  });
  const participants = toolByName("update_group_participants");
  if (!participants) throw new Error("update_group_participants missing");
  await participants.handler(toolCtx, { group_jid: "g@g.us", jids: ["x"], action: "promote" });
  const meta = toolByName("update_group_meta");
  if (!meta) throw new Error("update_group_meta missing");
  await meta.handler(toolCtx, { group_jid: "g@g.us", subject: "S", description: "D" });
  const leave = toolByName("leave_group");
  if (!leave) throw new Error("leave_group missing");
  await leave.handler(toolCtx, { group_jid: "g@g.us" });
  const invite = toolByName("get_group_invite");
  if (!invite) throw new Error("get_group_invite missing");
  const inviteResult = await invite.handler(toolCtx, { group_jid: "g@us" });
  const bodies = calls.map((call) => (call.body === undefined ? null : JSON.parse(call.body)));
  expect(bodies[0]).toEqual({
    subject: "Test Group",
    participants: ["358401111111@s.whatsapp.net"],
  });
  expect(bodies[1]).toEqual({ group_jid: "g@g.us", jids: ["x"], action: "promote" });
  expect(bodies[2]).toEqual({ group_jid: "g@g.us", subject: "S", description: "D" });
  expect(bodies[3]).toEqual({ group_jid: "g@g.us" });
  expect(calls[4]?.url).toBe("http://bridge.test:8080/api/group/invite/g%40us");
  expect(firstText(inviteResult)).toContain("CODE9");
});

test("transcribe_message and send_voice_note hit their endpoints", async () => {
  const { fetchFn, calls } = mockFetch({
    "/api/transcribe": { text: "mock transcript", engine: "mock" },
    "/api/tts": { message_id: "V1" },
  });
  const toolCtx = { ...ctx, fetchFn };
  const transcribe = toolByName("transcribe_message");
  if (!transcribe) throw new Error("transcribe_message missing");
  const transcript = await transcribe.handler(toolCtx, { message_id: "M1" });
  expect(calls[0]?.url).toBe("http://bridge.test:8080/api/transcribe");
  expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ message_id: "M1" });
  expect(firstText(transcript)).toContain("mock transcript");
  const voice = toolByName("send_voice_note");
  if (!voice) throw new Error("send_voice_note missing");
  await voice.handler(toolCtx, { text: "say hi", chat_jid: "g@g.us" });
  expect(calls[1]?.url).toBe("http://bridge.test:8080/api/tts");
  expect(JSON.parse(calls[1]?.body ?? "{}")).toEqual({ text: "say hi", chat_jid: "g@g.us" });
});

test("get_pairing_code posts the phone to the bridge", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/pairing-code": { code: "ABCD-1234" } });
  const tool = toolByName("get_pairing_code");
  if (!tool) throw new Error("get_pairing_code missing");
  const result = await tool.handler({ ...ctx, fetchFn }, { phone: "+358 497 773 518" });
  expect(calls[0]?.url).toBe("http://bridge.test:8080/api/pairing-code");
  expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({ phone: "+358 497 773 518" });
  expect(firstText(result)).toContain("ABCD-1234");
});

test("T62: delete_message tool POSTs /api/delete with the bearer token", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/delete": { deleted: true } });
  const tool = toolByName("delete_message");
  if (!tool) throw new Error("delete_message missing");
  const result = await tool.handler(
    { ...ctx, fetchFn },
    { chat_jid: "351930017568@s.whatsapp.net", message_id: "TARGET1" },
  );
  expect(calls[0]?.url).toBe("http://bridge.test:8080/api/delete");
  expect(calls[0]?.method).toBe("POST");
  expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
    chat_jid: "351930017568@s.whatsapp.net",
    message_id: "TARGET1",
  });
  expect(firstText(result)).toContain("deleted");
});

describe("T94-C1 — export tools read raw text (NDJSON/MD/TXT), not JSON", () => {
  function textFetch(payload: string, status = 200): { fetchFn: typeof fetch } {
    const fetchFn = (async () =>
      new Response(payload, {
        status,
        headers: { "content-type": "application/x-ndjson" },
      })) as unknown as typeof fetch;
    return { fetchFn };
  }

  test("export_chat passes multi-line NDJSON through unmodified", async () => {
    const ndjson = '{"id":"M1","content":"hello"}\n{"id":"M2","content":"hi"}\n';
    const { fetchFn } = textFetch(ndjson);
    const tool = toolByName("export_chat");
    if (!tool) throw new Error("export_chat missing");
    const result = await tool.handler(
      { ...ctx, fetchFn },
      { chat_jid: "358497773518@s.whatsapp.net", format: "jsonl" },
    );
    // RED today: bridgeFetch JSON-parses the NDJSON and throws
    // "Unexpected token …" / double-encodes whatever survives
    expect(firstText(result)).toBe(ndjson);
  });

  test("export_unread_messages passes markdown through unmodified", async () => {
    const markdown = "# Unread\n\n- **Ada:** hello\n";
    const { fetchFn } = textFetch(markdown);
    const tool = toolByName("export_unread_messages");
    if (!tool) throw new Error("export_unread_messages missing");
    const result = await tool.handler({ ...ctx, fetchFn }, { format: "md" });
    expect(firstText(result)).toBe(markdown);
  });

  test("oversized exports are cut WITH a truncation marker", async () => {
    const big = `${"x".repeat(6000)}\n`;
    const { fetchFn } = textFetch(big);
    const tool = toolByName("export_chat");
    if (!tool) throw new Error("export_chat missing");
    const result = await tool.handler(
      { ...ctx, fetchFn },
      { chat_jid: "a@s.whatsapp.net", format: "txt" },
    );
    const text = firstText(result);
    expect(text.length).toBeLessThan(6000);
    expect(text).toContain("truncated");
  });

  test("error bodies still surface as failures", async () => {
    const fetchFn = (async () =>
      new Response(JSON.stringify({ error: { code: "NOT_FOUND", message: "no such chat" } }), {
        status: 404,
        headers: { "content-type": "application/json" },
      })) as unknown as typeof fetch;
    const tool = toolByName("export_chat");
    if (!tool) throw new Error("export_chat missing");
    await expect(
      tool.handler({ ...ctx, fetchFn }, { chat_jid: "gone@s.whatsapp.net" }),
    ).rejects.toThrow("no such chat");
  });
});

test("T94-D-H5claude — bridgeFetch arms an abort timeout", async () => {
  let seenSignal: unknown;
  const fetchFn = (async (_url: string | URL, init?: RequestInit) => {
    seenSignal = init?.signal;
    return new Response(JSON.stringify({ chats: [] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  const tool = toolByName("list_chats");
  if (!tool) throw new Error("list_chats missing");
  await tool.handler({ ...ctx, fetchFn }, {});
  expect(seenSignal).toBeInstanceOf(AbortSignal);
});

test("T94-D-H5claude — non-JSON 5xx keeps the HTTP status in the message", async () => {
  const fetchFn = (async () =>
    new Response("<html>502 Bad Gateway</html>", { status: 502 })) as unknown as typeof fetch;
  const tool = toolByName("list_chats");
  if (!tool) throw new Error("list_chats missing");
  await expect(tool.handler({ ...ctx, fetchFn }, {})).rejects.toThrow("HTTP 502");
});

test("T94-D-H5claude — an unreachable bridge names the remedy", async () => {
  const fetchFn = (async () => {
    throw new TypeError("fetch failed");
  }) as unknown as typeof fetch;
  const tool = toolByName("list_chats");
  if (!tool) throw new Error("list_chats missing");
  await expect(tool.handler({ ...ctx, fetchFn }, {})).rejects.toThrow("wa-mcp status");
});

test("T99 — get_privacy reads the engine privacy settings", async () => {
  const { fetchFn, calls } = mockFetch({
    "/api/privacy": { privacy: { lastSeen: "all", online: "match_last_seen" } },
  });
  const tool = toolByName("get_privacy");
  if (!tool) throw new Error("get_privacy missing");
  const result = await tool.handler({ ...ctx, fetchFn }, {});
  expect(calls[0]?.method).toBe("GET");
  expect(firstText(result)).toContain("lastSeen");
});
