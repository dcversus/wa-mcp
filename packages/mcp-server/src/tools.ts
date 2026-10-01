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
];

export function toolByName(name: string): ToolDef | undefined {
  return TOOLS.find((tool) => tool.name === name);
}
