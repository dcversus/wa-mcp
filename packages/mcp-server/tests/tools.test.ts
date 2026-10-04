import { expect, test } from "vite-plus/test";
import { TOOLS, toolByName, type ToolContext } from "../src/tools.ts";

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
    "export_chat",
    "export_unread_messages",
    "bulk_clear",
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
  expect(result.content[0]?.text).toContain("M9");
});

test("list_chats fetches the chat list and returns json text", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/chats?limit=50": { chats: [{ jid: "a@g.us" }] } });
  const tool = toolByName("list_chats");
  if (!tool) throw new Error("list_chats missing");
  const result = await tool.handler({ ...ctx, fetchFn }, { limit: 50 });
  expect(calls[0]?.url).toBe("http://bridge.test:8080/api/chats?limit=50");
  expect(calls[0]?.method).toBe("GET");
  expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({ chats: [{ jid: "a@g.us" }] });
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
  expect(result.content[0]?.text).toContain("MM1");
});

test("get_chat finds one chat from the chat list", async () => {
  const { fetchFn, calls } = mockFetch({
    "/api/chats?limit=200": { chats: [{ jid: "120363428874442773@g.us", name: "Test" }] },
  });
  const tool = toolByName("get_chat");
  if (!tool) throw new Error("get_chat missing");
  const result = await tool.handler({ ...ctx, fetchFn }, { chat_jid: "120363428874442773@g.us" });
  expect(calls[0]?.url).toBe("http://bridge.test:8080/api/chats?limit=200");
  expect(result.content[0]?.text).toContain("Test");
  const missing = await tool.handler({ ...ctx, fetchFn }, { chat_jid: "nope@g.us" });
  expect(missing.content[0]?.text).toContain("not found");
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
  expect(contactResult.content[0]?.text).toContain("John");
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
  expect(unreadResult.content[0]?.text).toContain("unreadCount");
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
  expect(result.content[0]?.text).toContain("999@s.whatsapp.net");
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
  expect(result.content[0]?.text).toContain("M1.png");
  expect(result.content[0]?.text).toContain("image/png");
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
  expect(inviteResult.content[0]?.text).toContain("CODE9");
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
  expect(transcript.content[0]?.text).toContain("mock transcript");
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
  expect(result.content[0]?.text).toContain("ABCD-1234");
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
  expect(result.content[0]?.text).toContain("deleted");
});
