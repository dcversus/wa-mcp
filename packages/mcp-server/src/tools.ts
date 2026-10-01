export class ParamError extends Error {}

export interface ToolContext {
  bridgeUrl: string;
  token: string;
  fetchFn?: typeof fetch;
}

export interface ToolResult {
  content: Array<{ type: "text"; text: string }>;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  handler(toolCtx: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
}

function requireString(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new ParamError(`${name} is required`);
  }
  return value;
}

function optionalNumber(args: Record<string, unknown>, name: string): number | undefined {
  const value = args[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ParamError(`${name} must be a number`);
  }
  return value;
}

function textResult(payload: Record<string, unknown>): ToolResult {
  return { content: [{ type: "text", text: JSON.stringify(payload) }] };
}

async function bridgeFetch(
  toolCtx: ToolContext,
  path: string,
  init?: RequestInit,
): Promise<unknown> {
  const fetchFn = toolCtx.fetchFn ?? fetch;
  const headers: Record<string, string> = {
    "content-type": "application/json",
    authorization: `Bearer ${toolCtx.token}`,
  };
  if (init?.headers !== undefined) {
    Object.assign(headers, init.headers);
  }
  const response = await fetchFn(`${toolCtx.bridgeUrl}${path}`, {
    method: init?.method ?? "GET",
    headers,
    ...(init?.body !== undefined ? { body: init.body } : {}),
  });
  const body: unknown = await response.json();
  if (!response.ok) {
    const message =
      body !== null && typeof body === "object" && "error" in body
        ? JSON.stringify((body as { error: unknown }).error)
        : `bridge returned ${response.status}`;
    throw new Error(`bridge request failed: ${message}`);
  }
  return body;
}

function query(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      search.set(key, String(value));
    }
  }
  const encoded = search.toString();
  return encoded.length > 0 ? `?${encoded}` : "";
}

export const TOOLS: ToolDef[] = [
  {
    name: "send_message",
    description:
      "Send a WhatsApp text message. Accepts phone numbers, group JIDs, or any chat jid.",
    inputSchema: {
      type: "object",
      required: ["chat_jid", "text"],
      properties: {
        chat_jid: {
          type: "string",
          description: "Recipient: phone number, group JID, or any chat JID",
        },
        text: { type: "string", description: "Message text" },
      },
    },
    handler: async (toolCtx, args) => {
      const chatJid = requireString(args, "chat_jid");
      const text = requireString(args, "text");
      const payload = (await bridgeFetch(toolCtx, "/api/send", {
        method: "POST",
        body: JSON.stringify({ chat_jid: chatJid, text }),
      })) as { message_id?: string };
      return {
        content: [{ type: "text", text: `message sent: ${payload.message_id ?? "unknown id"}` }],
      };
    },
  },
  {
    name: "list_chats",
    description: "List WhatsApp chats with unread counts and last-message previews.",
    inputSchema: {
      type: "object",
      properties: {
        limit: { type: "number", description: "Max chats to return (1-200, default 50)" },
        archived: { type: "boolean", description: "Show archived chats instead" },
      },
    },
    handler: async (toolCtx, args) => {
      const limit = optionalNumber(args, "limit");
      const archived = args.archived === true ? "true" : undefined;
      const payload = (await bridgeFetch(
        toolCtx,
        `/api/chats${query({ limit, archived })}`,
      )) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "list_messages",
    description: "List messages of one chat, newest first.",
    inputSchema: {
      type: "object",
      required: ["chat_jid"],
      properties: {
        chat_jid: { type: "string" },
        limit: { type: "number" },
        after: { type: "string", description: "ISO instant" },
        before: { type: "string", description: "ISO instant" },
      },
    },
    handler: async (toolCtx, args) => {
      const chatJid = requireString(args, "chat_jid");
      const limit = optionalNumber(args, "limit");
      const after = typeof args.after === "string" ? args.after : undefined;
      const before = typeof args.before === "string" ? args.before : undefined;
      const payload = (await bridgeFetch(
        toolCtx,
        `/api/messages${query({ chat_jid: chatJid, limit, after, before })}`,
      )) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "search_messages",
    description: "Full-text search across all stored WhatsApp messages.",
    inputSchema: {
      type: "object",
      required: ["q"],
      properties: {
        q: { type: "string", description: "Search query (FTS operators AND/OR/quoted phrases)" },
        chat_jid: { type: "string", description: "Restrict to one chat" },
        limit: { type: "number" },
      },
    },
    handler: async (toolCtx, args) => {
      const q = requireString(args, "q");
      const chatJid = typeof args.chat_jid === "string" ? args.chat_jid : undefined;
      const limit = optionalNumber(args, "limit");
      const payload = (await bridgeFetch(
        toolCtx,
        `/api/search${query({ q, chat_jid: chatJid, limit })}`,
      )) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "get_message_context",
    description: "Get the messages immediately before and after one message in its chat.",
    inputSchema: {
      type: "object",
      required: ["message_id"],
      properties: {
        message_id: { type: "string" },
        radius: { type: "number", description: "Rows on each side (default 3)" },
      },
    },
    handler: async (toolCtx, args) => {
      const messageId = requireString(args, "message_id");
      const radius = optionalNumber(args, "radius");
      const payload = (await bridgeFetch(
        toolCtx,
        `/api/context${query({ message_id: messageId, radius })}`,
      )) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "send_media",
    description:
      "Send an image, video, audio, document or sticker. Media comes from base64, a bridge-local path or a URL.",
    inputSchema: {
      type: "object",
      required: ["kind", "chat_jid", "media"],
      properties: {
        kind: { type: "string", description: "image | video | audio | document | sticker" },
        chat_jid: { type: "string" },
        media: {
          type: "object",
          description: "Exactly one of base64, path (bridge media dir) or url",
          properties: {
            base64: { type: "string" },
            path: { type: "string" },
            url: { type: "string" },
          },
        },
        caption: { type: "string" },
        file_name: { type: "string" },
      },
    },
    handler: async (toolCtx, args) => {
      const kind = requireString(args, "kind");
      const chatJid = requireString(args, "chat_jid");
      if (args.media === undefined || typeof args.media !== "object") {
        throw new ParamError("media is required");
      }
      const payload = (await bridgeFetch(toolCtx, "/api/send", {
        method: "POST",
        body: JSON.stringify({
          kind,
          chat_jid: chatJid,
          media: args.media,
          caption: args.caption,
          file_name: args.file_name,
        }),
      })) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "get_chat",
    description: "Get one chat's summary (name, unread count, last message).",
    inputSchema: {
      type: "object",
      required: ["chat_jid"],
      properties: { chat_jid: { type: "string" } },
    },
    handler: async (toolCtx, args) => {
      const chatJid = requireString(args, "chat_jid");
      const payload = (await bridgeFetch(toolCtx, "/api/chats?limit=200")) as {
        chats?: Array<{ jid: string }>;
      };
      const chat = (payload.chats ?? []).find((candidate) => candidate.jid === chatJid);
      if (chat === undefined) {
        return { content: [{ type: "text", text: `chat not found: ${chatJid}` }] };
      }
      return textResult({ chat });
    },
  },
  {
    name: "send_reaction",
    description: "React to a message with an emoji.",
    inputSchema: {
      type: "object",
      required: ["chat_jid", "message_id", "emote"],
      properties: {
        chat_jid: { type: "string" },
        message_id: { type: "string" },
        emote: { type: "string" },
      },
    },
    handler: async (toolCtx, args) => {
      const body = {
        kind: "reaction",
        chat_jid: requireString(args, "chat_jid"),
        message_id: requireString(args, "message_id"),
        emote: requireString(args, "emote"),
      };
      const payload = (await bridgeFetch(toolCtx, "/api/send", {
        method: "POST",
        body: JSON.stringify(body),
      })) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "edit_message",
    description: "Edit a message you sent.",
    inputSchema: {
      type: "object",
      required: ["chat_jid", "message_id", "text"],
      properties: {
        chat_jid: { type: "string" },
        message_id: { type: "string" },
        text: { type: "string" },
      },
    },
    handler: async (toolCtx, args) => {
      const body = {
        kind: "edit",
        chat_jid: requireString(args, "chat_jid"),
        message_id: requireString(args, "message_id"),
        text: requireString(args, "text"),
      };
      const payload = (await bridgeFetch(toolCtx, "/api/send", {
        method: "POST",
        body: JSON.stringify(body),
      })) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "forward_message",
    description: "Forward a stored message to another chat.",
    inputSchema: {
      type: "object",
      required: ["chat_jid", "message_id"],
      properties: {
        chat_jid: { type: "string", description: "Destination chat" },
        message_id: { type: "string", description: "Stored message to forward" },
      },
    },
    handler: async (toolCtx, args) => {
      const body = {
        kind: "forward",
        chat_jid: requireString(args, "chat_jid"),
        message_id: requireString(args, "message_id"),
      };
      const payload = (await bridgeFetch(toolCtx, "/api/send", {
        method: "POST",
        body: JSON.stringify(body),
      })) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "mark_chat_read",
    description: "Mark every unread message of one chat as read.",
    inputSchema: {
      type: "object",
      required: ["chat_jid"],
      properties: { chat_jid: { type: "string" } },
    },
    handler: async (toolCtx, args) => {
      const chatJid = requireString(args, "chat_jid");
      const listed = (await bridgeFetch(
        toolCtx,
        `/api/messages${query({ chat_jid: chatJid, limit: 200 })}`,
      )) as { messages?: Array<{ id?: string; isUnread?: boolean }> };
      const unreadIds = (listed.messages ?? [])
        .filter((message) => message.isUnread === true && message.id !== undefined)
        .map((message) => message.id as string);
      if (unreadIds.length === 0) {
        return { content: [{ type: "text", text: "no unread messages" }] };
      }
      const payload = (await bridgeFetch(toolCtx, "/api/read", {
        method: "POST",
        body: JSON.stringify({ chat_jid: chatJid, message_ids: unreadIds }),
      })) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "set_chat_state",
    description: "Set chat flags: archived, pinned, muted until (ISO instant or null).",
    inputSchema: {
      type: "object",
      required: ["chat_jid"],
      properties: {
        chat_jid: { type: "string" },
        archived: { type: "boolean" },
        pinned: { type: "boolean" },
        muted_until: { type: "string", description: "ISO instant, or null to unmute" },
      },
    },
    handler: async (toolCtx, args) => {
      const body: Record<string, unknown> = { chat_jid: requireString(args, "chat_jid") };
      if (args.archived !== undefined) {
        body.archived = args.archived;
      }
      if (args.pinned !== undefined) {
        body.pinned = args.pinned;
      }
      if (args.muted_until !== undefined) {
        body.muted_until = args.muted_until;
      }
      const payload = (await bridgeFetch(toolCtx, "/api/chat/state", {
        method: "POST",
        body: JSON.stringify(body),
      })) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "list_contacts",
    description: "List or search stored WhatsApp contacts.",
    inputSchema: {
      type: "object",
      properties: {
        query: {
          type: "string",
          description: "Case-insensitive search over name, pushname and jid",
        },
        limit: { type: "number" },
      },
    },
    handler: async (toolCtx, args) => {
      const queryValue = typeof args.query === "string" ? args.query : undefined;
      const limit = optionalNumber(args, "limit");
      const payload = (await bridgeFetch(
        toolCtx,
        `/api/contacts${query({ query: queryValue, limit })}`,
      )) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "set_alias",
    description: "Remember a contact under a short alias that other tools can resolve.",
    inputSchema: {
      type: "object",
      required: ["alias", "jid"],
      properties: {
        alias: { type: "string" },
        jid: { type: "string" },
      },
    },
    handler: async (toolCtx, args) => {
      const body = { alias: requireString(args, "alias"), jid: requireString(args, "jid") };
      const payload = (await bridgeFetch(toolCtx, "/api/alias", {
        method: "POST",
        body: JSON.stringify(body),
      })) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "get_unread_counts",
    description: "Per-chat unread message counts (nonzero only, newest activity first).",
    inputSchema: { type: "object", properties: {} },
    handler: async (toolCtx) => {
      const payload = (await bridgeFetch(toolCtx, "/api/unread")) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "update_profile",
    description: "Update your WhatsApp profile name and/or about status.",
    inputSchema: {
      type: "object",
      properties: {
        name: { type: "string" },
        status: { type: "string", description: "About text" },
      },
    },
    handler: async (toolCtx, args) => {
      const body: Record<string, unknown> = {};
      if (args.name !== undefined) {
        body.name = args.name;
      }
      if (args.status !== undefined) {
        body.status = args.status;
      }
      const payload = (await bridgeFetch(toolCtx, "/api/profile", {
        method: "POST",
        body: JSON.stringify(body),
      })) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "set_privacy",
    description:
      "Set one privacy setting. Keys: readReceipts, online, lastSeen, profilePic, status, groups, calls, messages.",
    inputSchema: {
      type: "object",
      required: ["key", "value"],
      properties: {
        key: {
          type: "string",
          description:
            "readReceipts | online | lastSeen | profilePic | status | groups | calls | messages",
        },
        value: { type: "string", description: "Allowed values depend on the key" },
      },
    },
    handler: async (toolCtx, args) => {
      const key = requireString(args, "key");
      const value = requireString(args, "value");
      const payload = (await bridgeFetch(toolCtx, "/api/privacy", {
        method: "POST",
        body: JSON.stringify({ [key]: value }),
      })) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "block_unblock",
    description: "Block or unblock a contact.",
    inputSchema: {
      type: "object",
      required: ["jid", "block"],
      properties: {
        jid: { type: "string" },
        block: { type: "boolean" },
      },
    },
    handler: async (toolCtx, args) => {
      const body = { jid: requireString(args, "jid"), block: args.block === true };
      const payload = (await bridgeFetch(toolCtx, "/api/block", {
        method: "POST",
        body: JSON.stringify(body),
      })) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "get_blocklist",
    description: "List blocked contacts.",
    inputSchema: { type: "object", properties: {} },
    handler: async (toolCtx) => {
      const payload = (await bridgeFetch(toolCtx, "/api/blocklist")) as Record<string, unknown>;
      return textResult(payload);
    },
  },
];

export function toolByName(name: string): ToolDef | undefined {
  return TOOLS.find((tool) => tool.name === name);
}
