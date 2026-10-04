export class ParamError extends Error {}

export interface ToolContext {
  bridgeUrl: string;
  token: string;
  fetchFn?: typeof fetch;
}

export interface ToolResult {
  content: Array<
    { type: "text"; text: string } | { type: "image"; data: string; mimeType: string }
  >;
}

export interface ToolAnnotations {
  readOnlyHint?: boolean;
  destructiveHint?: boolean;
  idempotentHint?: boolean;
  openWorldHint?: boolean;
}

export interface ToolDef {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
  annotations?: ToolAnnotations;
  handler(toolCtx: ToolContext, args: Record<string, unknown>): Promise<ToolResult>;
}

/** T87 line118: every tool is closed-world; helpers classify reads,
 * destructive ops and idempotent status calls. */
export function annotate(tool: Omit<ToolDef, "annotations">, hints: ToolAnnotations): ToolDef {
  return { ...tool, annotations: { openWorldHint: false, ...hints } };
}

function requireString(args: Record<string, unknown>, name: string): string {
  const value = args[name];
  if (typeof value !== "string" || value.length === 0) {
    throw new ParamError(`${name} is required`);
  }
  return value;
}

function requireNumber(args: Record<string, unknown>, name: string): number {
  const value = args[name];
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new ParamError(`${name} is required as a number`);
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

function optionalString(args: Record<string, unknown>, name: string): string | undefined {
  const value = args[name];
  if (value === undefined) {
    return undefined;
  }
  if (typeof value !== "string" || value.length === 0) {
    throw new ParamError(`${name} must be a non-empty string`);
  }
  return value;
}

function requireObject(value: unknown, name: string): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new ParamError(`${name} must be an object`);
  }
  return value as Record<string, unknown>;
}

/** T92-B: buttons accept {label} objects (schema shape) or bare strings. */
function requireLabels(value: unknown, name: string): string[] {
  if (!Array.isArray(value) || value.length === 0) {
    throw new ParamError(`${name} must be a non-empty array of labels`);
  }
  return value.map((entry, index) => {
    if (typeof entry === "string" && entry.length > 0) {
      return entry;
    }
    if (entry !== null && typeof entry === "object" && !Array.isArray(entry)) {
      const label = (entry as { label?: unknown }).label;
      if (typeof label === "string" && label.length > 0) {
        return label;
      }
    }
    throw new ParamError(`${name}[${index}] must carry a label`);
  });
}

function firstUrlIn(text: string): string | undefined {
  const match = /https?:\/\/[^\s<>"')\]]+/.exec(text);
  return match?.[0];
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
  annotate(
    {
      name: "get_login_qr",
      description:
        "Get the current WhatsApp login QR code + pairing instructions. Returns NOT_PAIRING once connected.",
      inputSchema: { type: "object", properties: {} },
      handler: async (toolCtx) => {
        const health = (await bridgeFetch(toolCtx, "/health")) as {
          status?: string;
          loggedIn?: boolean;
        };
        if (health.status === "connected" || health.loggedIn === true) {
          return {
            content: [
              {
                type: "text",
                text: "NOT_PAIRING: the daemon is already connected — no QR is needed.",
              },
            ],
          };
        }
        const qr = (await bridgeFetch(toolCtx, "/api/qr")) as {
          qr?: string | null;
          pairingBlocked?: boolean;
        };
        if (qr.pairingBlocked === true) {
          return {
            content: [
              {
                type: "text",
                text: "PAIRING_BLOCKED: pairing attempts exhausted — restart the daemon or call POST /api/pair/resume.",
              },
            ],
          };
        }
        if (typeof qr.qr !== "string" || qr.qr.length === 0) {
          return {
            content: [{ type: "text", text: "NO_QR: no QR available yet" }],
          };
        }
        return {
          content: [
            {
              type: "text",
              text:
                "Scan this QR with WhatsApp (Settings > Linked devices > Link a device):\n\n" +
                qr.qr +
                "\n\nOr open the daemon web UI pairing page to scan the rendered image.",
            },
          ],
        };
      },
    },
    { readOnlyHint: true },
  ),
  {
    name: "send_message",
    description:
      "Send a WhatsApp message: plain text, link card, status broadcast, buttons or a list.",
    inputSchema: {
      type: "object",
      required: ["text"],
      properties: {
        chat_jid: {
          type: "string",
          description:
            "Recipient: phone number, group JID, or any chat JID (required unless status_broadcast is true)",
        },
        text: { type: "string", description: "Message text" },
        link_preview: {
          type: "boolean",
          description:
            "Send text as a link card — the bridge forces an engine link preview; pair with url or embed a URL in text",
        },
        url: {
          type: "string",
          description:
            "URL to preview when link_preview is true (defaults to the first URL in text)",
        },
        status_broadcast: {
          type: "boolean",
          description:
            "Post the text to your status (status@broadcast) instead of a chat — chat_jid not required",
        },
        buttons: {
          type: "array",
          description:
            "Quick-reply buttons under the text. Renders for WhatsApp Business accounts only.",
          items: {
            type: "object",
            required: ["label"],
            properties: { label: { type: "string", description: "Button label" } },
          },
        },
        interactive: {
          type: "object",
          description:
            "Rich button message (title, body, footer). Renders for WhatsApp Business accounts only.",
          properties: {
            title: { type: "string", description: "Message title (content text)" },
            description: { type: "string", description: "Body appended under the title" },
            footer: { type: "string", description: "Footer line above the buttons" },
            buttons: {
              type: "array",
              items: {
                type: "object",
                required: ["label"],
                properties: { label: { type: "string" } },
              },
            },
          },
        },
        list: {
          type: "object",
          description:
            "List message with sections and rows. Renders for WhatsApp Business accounts only.",
          properties: {
            title: { type: "string", description: "List title" },
            description: { type: "string", description: "List subtitle" },
            sections: {
              type: "array",
              items: {
                type: "object",
                required: ["title", "rows"],
                properties: {
                  title: { type: "string", description: "Section title" },
                  rows: {
                    type: "array",
                    items: {
                      type: "object",
                      required: ["title"],
                      properties: {
                        title: { type: "string", description: "Row title" },
                        description: { type: "string", description: "Row subtitle" },
                      },
                    },
                  },
                },
              },
            },
          },
        },
      },
    },
    handler: async (toolCtx, args) => {
      const linkPreview = args.link_preview === true;
      const statusBroadcast = args.status_broadcast === true;
      const hasButtons = args.buttons !== undefined;
      const hasInteractive = args.interactive !== undefined;
      const hasList = args.list !== undefined;
      const variants = [linkPreview, statusBroadcast, hasButtons, hasInteractive, hasList].filter(
        (set) => set,
      ).length;
      if (variants > 1) {
        throw new ParamError(
          "pass only one of link_preview, status_broadcast, buttons, interactive, list",
        );
      }

      // T92-B: the bridge kinds are status-text / link_preview / buttons / list
      // (plain text stays the un-kinded {chat_jid, text} body the bridge defaults)
      let body: Record<string, unknown>;
      if (statusBroadcast) {
        body = { kind: "status-text", text: requireString(args, "text") };
      } else {
        const chatJid = requireString(args, "chat_jid");
        if (linkPreview) {
          const text = requireString(args, "text");
          const explicit =
            typeof args.url === "string" && args.url.length > 0 ? args.url : undefined;
          const url = explicit ?? firstUrlIn(text);
          if (url === undefined) {
            throw new ParamError(
              "link_preview needs a url — pass url or include a URL in the text",
            );
          }
          body = { kind: "link_preview", chat_jid: chatJid, text, url };
        } else if (hasInteractive) {
          const spec = requireObject(args.interactive, "interactive");
          const labels = requireLabels(spec.buttons, "interactive.buttons");
          const title = requireString(spec, "title");
          const description = optionalString(spec, "description");
          body = {
            kind: "buttons",
            chat_jid: chatJid,
            text: description === undefined ? title : `${title}\n${description}`,
            buttons: labels,
            ...(optionalString(spec, "footer") !== undefined
              ? { caption: optionalString(spec, "footer") }
              : {}),
          };
        } else if (hasButtons) {
          body = {
            kind: "buttons",
            chat_jid: chatJid,
            text: requireString(args, "text"),
            buttons: requireLabels(args.buttons, "buttons"),
          };
        } else if (hasList) {
          const spec = requireObject(args.list, "list");
          const title = requireString(spec, "title");
          const description = optionalString(spec, "description");
          const rawSections = Array.isArray(spec.sections) ? spec.sections : [];
          if (rawSections.length === 0) {
            throw new ParamError("list.sections is required with at least one section");
          }
          const sections = rawSections.map((section, sectionIndex) => {
            const s = requireObject(section, `list.sections[${sectionIndex}]`);
            const sectionTitle = requireString(s, "title");
            const rawRows = Array.isArray(s.rows) ? s.rows : [];
            if (rawRows.length === 0) {
              throw new ParamError(`list.sections[${sectionIndex}].rows needs at least one row`);
            }
            const rows = rawRows.map((row, rowIndex) => {
              const r = requireObject(row, `list.sections[${sectionIndex}].rows[${rowIndex}]`);
              const rowTitle = requireString(r, "title");
              const rowDescription = optionalString(r, "description");
              return {
                title: rowTitle,
                row_id: `r${sectionIndex}-${rowIndex}`,
                ...(rowDescription !== undefined ? { description: rowDescription } : {}),
              };
            });
            return { title: sectionTitle, rows };
          });
          body = {
            kind: "list",
            chat_jid: chatJid,
            text: description === undefined ? title : `${title}\n${description}`,
            sections,
          };
        } else {
          body = { chat_jid: chatJid, text: requireString(args, "text") };
        }
      }
      const payload = (await bridgeFetch(toolCtx, "/api/send", {
        method: "POST",
        body: JSON.stringify(body),
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
      required: ["query"],
      properties: {
        query: {
          type: "string",
          description: "Search query (FTS operators AND/OR/quoted phrases); legacy alias: q",
        },
        chat_jid: { type: "string", description: "Restrict to one chat" },
        limit: { type: "number" },
      },
    },
    handler: async (toolCtx, args) => {
      const q =
        typeof args.query === "string" && args.query.length > 0
          ? args.query
          : requireString(args, "q");
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
    name: "catch_up",
    description:
      "Catch-up digest across all chats since a date: active chats, message counts, questions and media.",
    inputSchema: {
      type: "object",
      required: ["since"],
      properties: {
        since: { type: "string", description: "ISO timestamp to catch up from" },
      },
    },
    handler: async (toolCtx, args) => {
      const since = requireString(args, "since");
      const payload = (await bridgeFetch(toolCtx, `/api/catch-up${query({ since })}`)) as Record<
        string,
        unknown
      >;
      return textResult(payload);
    },
  },
  {
    name: "digest_group",
    description:
      "Summarize one chat since a date: message counts, top participants, open questions and media.",
    inputSchema: {
      type: "object",
      required: ["chat_jid", "since"],
      properties: {
        chat_jid: { type: "string", description: "Chat or group JID" },
        since: { type: "string", description: "ISO timestamp to summarize from" },
      },
    },
    handler: async (toolCtx, args) => {
      const chatJid = requireString(args, "chat_jid");
      const since = requireString(args, "since");
      const payload = (await bridgeFetch(
        toolCtx,
        `/api/digest${query({ chat_jid: chatJid, since })}`,
      )) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "fetch_history",
    description:
      "Ask WhatsApp to sync older messages for one chat; they arrive asynchronously into the store.",
    inputSchema: {
      type: "object",
      required: ["chat_jid"],
      properties: {
        chat_jid: { type: "string", description: "Chat JID to backfill" },
        count: { type: "number", description: "Approximate message count (default 25)" },
      },
    },
    handler: async (toolCtx, args) => {
      const chatJid = requireString(args, "chat_jid");
      const count = optionalNumber(args, "count");
      const payload = (await bridgeFetch(toolCtx, "/api/fetch-history", {
        method: "POST",
        body: JSON.stringify({
          chat_jid: chatJid,
          ...(count !== undefined ? { count } : {}),
        }),
      })) as Record<string, unknown>;
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
    name: "delete_message",
    description: "Delete a message for everyone (WhatsApp revoke). The local row is tombstoned.",
    inputSchema: {
      type: "object",
      required: ["chat_jid", "message_id"],
      properties: {
        chat_jid: { type: "string", description: "Chat containing the message" },
        message_id: { type: "string", description: "Message id to delete" },
      },
    },
    handler: async (toolCtx, args) => {
      const chatJid = requireString(args, "chat_jid");
      const messageId = requireString(args, "message_id");
      const payload = (await bridgeFetch(toolCtx, "/api/delete", {
        method: "POST",
        body: JSON.stringify({ chat_jid: chatJid, message_id: messageId }),
      })) as { deleted?: boolean };
      return {
        content: [{ type: "text", text: payload.deleted ? "message deleted" : "delete failed" }],
      };
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
      const body: Record<string, unknown> = {
        kind: "forward",
        chat_jid: requireString(args, "chat_jid"),
      };
      // T85 line96: batch mode — ids[] forwards every id in one call
      if (Array.isArray(args.ids)) {
        body.ids = args.ids;
      } else {
        body.message_id = requireString(args, "message_id");
      }
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
  {
    name: "get_media",
    description:
      "Download the media of a stored message (image/video/audio/document/sticker) and return its local file metadata.",
    inputSchema: {
      type: "object",
      required: ["message_id"],
      properties: { message_id: { type: "string" } },
    },
    handler: async (toolCtx, args) => {
      const messageId = requireString(args, "message_id");
      const payload = (await bridgeFetch(toolCtx, `/api/media/${encodeURIComponent(messageId)}`, {
        method: "POST",
      })) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "list_notification_rules",
    description: "List configured notification rules.",
    inputSchema: { type: "object", properties: {} },
    handler: async (toolCtx) => {
      const payload = (await bridgeFetch(toolCtx, "/api/notifications")) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "add_notification_rule",
    description:
      "Add a notification rule. Matchers: chat_jid, from_jid, unread_only. Templates substitute {{chat}}, {{sender}}, {{text}}.",
    inputSchema: {
      type: "object",
      required: ["title"],
      properties: {
        title: { type: "string", description: "Title template" },
        body: { type: "string", description: "Body template" },
        chat_jid: { type: "string", description: "Only messages in this chat" },
        from_jid: { type: "string", description: "Only messages from this sender" },
        unread_only: { type: "boolean", description: "Skip your own outgoing messages" },
      },
    },
    handler: async (toolCtx, args) => {
      const body: Record<string, unknown> = { title: requireString(args, "title") };
      if (args.body !== undefined) {
        body.body = args.body;
      }
      if (args.chat_jid !== undefined) {
        body.chat_jid = args.chat_jid;
      }
      if (args.from_jid !== undefined) {
        body.from_jid = args.from_jid;
      }
      if (args.unread_only !== undefined) {
        body.unread_only = args.unread_only;
      }
      const payload = (await bridgeFetch(toolCtx, "/api/notifications", {
        method: "POST",
        body: JSON.stringify(body),
      })) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "delete_notification_rule",
    description: "Delete a notification rule by id.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "number" } },
    },
    handler: async (toolCtx, args) => {
      const id = optionalNumber(args, "id");
      if (id === undefined) {
        throw new ParamError("id is required");
      }
      const payload = (await bridgeFetch(toolCtx, `/api/notifications/${id}`, {
        method: "DELETE",
      })) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "create_group",
    description: "Create a WhatsApp group with a subject and initial participants.",
    inputSchema: {
      type: "object",
      required: ["subject", "participants"],
      properties: {
        subject: { type: "string" },
        participants: {
          type: "array",
          items: { type: "string" },
          description: "Phone numbers or jids",
        },
      },
    },
    handler: async (toolCtx, args) => {
      const body = {
        subject: requireString(args, "subject"),
        participants: args.participants as string[],
      };
      if (!Array.isArray(body.participants)) {
        throw new ParamError("participants must be an array");
      }
      const payload = (await bridgeFetch(toolCtx, "/api/group/create", {
        method: "POST",
        body: JSON.stringify(body),
      })) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "update_group_participants",
    description: "Add, remove, promote or demote group participants.",
    inputSchema: {
      type: "object",
      required: ["group_jid", "jids", "action"],
      properties: {
        group_jid: { type: "string" },
        jids: { type: "array", items: { type: "string" } },
        action: { type: "string", description: "add | remove | promote | demote" },
      },
    },
    handler: async (toolCtx, args) => {
      const body = {
        group_jid: requireString(args, "group_jid"),
        jids: args.jids as string[],
        action: requireString(args, "action"),
      };
      if (!Array.isArray(body.jids)) {
        throw new ParamError("jids must be an array");
      }
      const payload = (await bridgeFetch(toolCtx, "/api/group/participants", {
        method: "POST",
        body: JSON.stringify(body),
      })) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "update_group_meta",
    description: "Update a group's subject and/or description.",
    inputSchema: {
      type: "object",
      required: ["group_jid"],
      properties: {
        group_jid: { type: "string" },
        subject: { type: "string" },
        description: { type: "string" },
      },
    },
    handler: async (toolCtx, args) => {
      const body: Record<string, unknown> = { group_jid: requireString(args, "group_jid") };
      if (args.subject !== undefined) {
        body.subject = args.subject;
      }
      if (args.description !== undefined) {
        body.description = args.description;
      }
      const payload = (await bridgeFetch(toolCtx, "/api/group/meta", {
        method: "POST",
        body: JSON.stringify(body),
      })) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "leave_group",
    description: "Leave a group.",
    inputSchema: {
      type: "object",
      required: ["group_jid"],
      properties: { group_jid: { type: "string" } },
    },
    handler: async (toolCtx, args) => {
      const body = { group_jid: requireString(args, "group_jid") };
      const payload = (await bridgeFetch(toolCtx, "/api/group/leave", {
        method: "POST",
        body: JSON.stringify(body),
      })) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "get_group_invite",
    description: "Get a group's invite code.",
    inputSchema: {
      type: "object",
      required: ["group_jid"],
      properties: { group_jid: { type: "string" } },
    },
    handler: async (toolCtx, args) => {
      const groupJid = requireString(args, "group_jid");
      const payload = (await bridgeFetch(
        toolCtx,
        `/api/group/invite/${encodeURIComponent(groupJid)}`,
      )) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "transcribe_message",
    description: "Transcribe a voice note or audio message to text (mock engine by default).",
    inputSchema: {
      type: "object",
      required: ["message_id"],
      properties: { message_id: { type: "string" } },
    },
    handler: async (toolCtx, args) => {
      const body = { message_id: requireString(args, "message_id") };
      const payload = (await bridgeFetch(toolCtx, "/api/transcribe", {
        method: "POST",
        body: JSON.stringify(body),
      })) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "send_voice_note",
    description:
      "Synthesize text to speech (mock engine) and send it as a push-to-talk voice note.",
    inputSchema: {
      type: "object",
      required: ["text", "chat_jid"],
      properties: {
        text: { type: "string" },
        chat_jid: { type: "string" },
      },
    },
    handler: async (toolCtx, args) => {
      const body = { text: requireString(args, "text"), chat_jid: requireString(args, "chat_jid") };
      const payload = (await bridgeFetch(toolCtx, "/api/tts", {
        method: "POST",
        body: JSON.stringify(body),
      })) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "get_pairing_code",
    description: "Request a pairing code to link a device (bridge must be in qr/connecting state).",
    inputSchema: {
      type: "object",
      required: ["phone"],
      properties: {
        phone: { type: "string", description: "Phone number, 8-15 digits after stripping" },
      },
    },
    handler: async (toolCtx, args) => {
      const body = { phone: requireString(args, "phone") };
      const payload = (await bridgeFetch(toolCtx, "/api/pairing-code", {
        method: "POST",
        body: JSON.stringify(body),
      })) as Record<string, unknown>;
      return textResult(payload);
    },
  },
  {
    name: "restrict_sending",
    description:
      "Manage per-target send rules (T82). action=add requires target + mode (block|allow, optional expires_at ISO); action=list lists rules; action=remove requires id.",
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["add", "list", "remove"] },
        target: { type: "string", description: "JID pattern; trailing * matches any suffix" },
        mode: { type: "string", enum: ["block", "allow"] },
        expires_at: { type: "string", description: "ISO timestamp after which the rule lapses" },
        id: { type: "number", description: "Rule id (action=remove)" },
      },
    },
    handler: async (toolCtx, args) => {
      const action = requireString(args, "action");
      if (action === "add") {
        const target = requireString(args, "target");
        const mode = requireString(args, "mode");
        const body: Record<string, unknown> = { target, mode };
        if (typeof args.expires_at === "string") body.expires_at = args.expires_at;
        await bridgeFetch(toolCtx, "/api/send-rules", {
          method: "POST",
          body: JSON.stringify(body),
        });
        return { content: [{ type: "text", text: `send rule added for ${target} (${mode})` }] };
      }
      if (action === "list") {
        const rules = (await bridgeFetch(toolCtx, "/api/send-rules")) as { rules?: unknown };
        return {
          content: [{ type: "text", text: JSON.stringify(rules, null, 2) }],
        };
      }
      const id = requireNumber(args, "id");
      await bridgeFetch(toolCtx, `/api/send-rules/${id}`, { method: "DELETE" });
      return { content: [{ type: "text", text: `send rule ${id} removed` }] };
    },
  },
  {
    name: "autoreply_set",
    description:
      "Manage autoreply rules. action=add requires match (regex) + reply; list lists; remove/toggle require id (toggle also uses enabled).",
    inputSchema: {
      type: "object",
      required: ["action"],
      properties: {
        action: { type: "string", enum: ["add", "list", "remove", "toggle"] },
        match: { type: "string", description: "Regex matched case-insensitively" },
        reply: { type: "string" },
        id: { type: "number" },
        enabled: { type: "boolean" },
      },
    },
    handler: async (toolCtx, args) => {
      const action = requireString(args, "action");
      if (action === "list") {
        const rules = (await bridgeFetch(toolCtx, "/api/autoreply-rules")) as { rules?: unknown };
        return { content: [{ type: "text", text: JSON.stringify(rules, null, 2) }] };
      }
      const body: Record<string, unknown> = { action };
      if (action === "add") {
        body.match = requireString(args, "match");
        body.reply = requireString(args, "reply");
      } else {
        body.id = requireNumber(args, "id");
        if (action === "toggle") {
          body.enabled = args.enabled === true;
        }
      }
      await bridgeFetch(toolCtx, "/api/autoreply-rules", {
        method: "POST",
        body: JSON.stringify(body),
      });
      return { content: [{ type: "text", text: `autoreply rule ${action} done` }] };
    },
  },
  {
    name: "create_template",
    description: "Create or update a message template with {{var}} placeholders.",
    inputSchema: {
      type: "object",
      required: ["name", "body"],
      properties: {
        name: { type: "string" },
        body: { type: "string", description: "Template body; {{var}} placeholders allowed" },
      },
    },
    handler: async (toolCtx, args) => {
      const name = requireString(args, "name");
      const body = requireString(args, "body");
      await bridgeFetch(toolCtx, "/api/templates", {
        method: "POST",
        body: JSON.stringify({ name, body }),
      });
      return { content: [{ type: "text", text: `template ${name} saved` }] };
    },
  },
  {
    name: "list_templates",
    description: "List saved message templates.",
    inputSchema: { type: "object", properties: {} },
    handler: async (toolCtx) => {
      const templates = (await bridgeFetch(toolCtx, "/api/templates")) as { templates?: unknown };
      return { content: [{ type: "text", text: JSON.stringify(templates, null, 2) }] };
    },
  },
  {
    name: "send_template",
    description:
      "Render a saved template for a chat and send it. Missing variables are reported without sending.",
    inputSchema: {
      type: "object",
      required: ["chat_jid", "name"],
      properties: {
        chat_jid: { type: "string" },
        name: { type: "string", description: "Template name" },
        vars: { type: "object", description: 'Placeholder values, e.g. { "name": "V" }' },
      },
    },
    handler: async (toolCtx, args) => {
      const chatJid = requireString(args, "chat_jid");
      const name = requireString(args, "name");
      const vars = (args.vars ?? {}) as Record<string, unknown>;
      const payload = (await bridgeFetch(toolCtx, "/api/templates")) as {
        templates?: Array<{ name: string; body: string }>;
      };
      const template = payload.templates?.find((entry) => entry.name === name);
      if (template === undefined) {
        return {
          content: [{ type: "text", text: `NOT_FOUND: template ${name} does not exist` }],
        };
      }
      const missing: string[] = [];
      const text = template.body.replace(/\{\{(\w+)\}\}/g, (_match, varName: string) => {
        const value = vars[varName];
        if (typeof value !== "string") {
          missing.push(varName);
          return `{{${varName}}}`;
        }
        return value;
      });
      if (missing.length > 0) {
        return {
          content: [
            {
              type: "text",
              text: `VALIDATION_ERROR: missing variables: ${missing.join(", ")} — supply vars and retry`,
            },
          ],
        };
      }
      const sent = (await bridgeFetch(toolCtx, "/api/send", {
        method: "POST",
        body: JSON.stringify({ chat_jid: chatJid, text }),
      })) as { message_id?: string };
      return {
        content: [{ type: "text", text: `template sent: ${sent.message_id ?? "unknown id"}` }],
      };
    },
  },
  {
    name: "schedule_message",
    description: "Schedule a text message for later delivery (daemon scheduler tick).",
    inputSchema: {
      type: "object",
      required: ["chat_jid", "text", "send_at"],
      properties: {
        chat_jid: { type: "string" },
        text: { type: "string" },
        send_at: { type: "string", description: "ISO timestamp" },
      },
    },
    handler: async (toolCtx, args) => {
      const chatJid = requireString(args, "chat_jid");
      const text = requireString(args, "text");
      const sendAt = requireString(args, "send_at");
      const payload = (await bridgeFetch(toolCtx, "/api/scheduled", {
        method: "POST",
        body: JSON.stringify({ chat_jid: chatJid, text, send_at: sendAt }),
      })) as { id?: number };
      return {
        content: [{ type: "text", text: `scheduled #${payload.id ?? "?"} for ${sendAt}` }],
      };
    },
  },
  {
    name: "list_scheduled",
    description: "List scheduled messages, optionally by status (pending|sent|failed|cancelled).",
    inputSchema: {
      type: "object",
      properties: { status: { type: "string", enum: ["pending", "sent", "failed", "cancelled"] } },
    },
    handler: async (toolCtx, args) => {
      const status = args.status;
      const suffix = typeof status === "string" ? `?status=${encodeURIComponent(status)}` : "";
      const rows = (await bridgeFetch(toolCtx, `/api/scheduled${suffix}`)) as {
        scheduled?: unknown;
      };
      return { content: [{ type: "text", text: JSON.stringify(rows, null, 2) }] };
    },
  },
  {
    name: "export_chat",
    description:
      "Export one chat's messages as jsonl, markdown or plain text (media referenced by type only).",
    inputSchema: {
      type: "object",
      required: ["chat_jid"],
      properties: {
        chat_jid: { type: "string" },
        format: { type: "string", enum: ["jsonl", "md", "txt"] },
      },
    },
    handler: async (toolCtx, args) => {
      const chatJid = requireString(args, "chat_jid");
      const format = typeof args.format === "string" ? args.format : "jsonl";
      const payload = (await bridgeFetch(
        toolCtx,
        `/api/export?chat_jid=${encodeURIComponent(chatJid)}&format=${encodeURIComponent(format)}`,
      )) as unknown;
      return { content: [{ type: "text", text: JSON.stringify(payload).slice(0, 4000) }] };
    },
  },
  {
    name: "export_unread_messages",
    description: "Export every unread message across chats as JSONL with chat attribution.",
    inputSchema: {
      type: "object",
      properties: { format: { type: "string", enum: ["jsonl", "md", "txt"] } },
    },
    handler: async (toolCtx, args) => {
      const format = typeof args.format === "string" ? args.format : "jsonl";
      const payload = (await bridgeFetch(
        toolCtx,
        `/api/export?unread=true&format=${encodeURIComponent(format)}`,
      )) as unknown;
      return { content: [{ type: "text", text: JSON.stringify(payload).slice(0, 4000) }] };
    },
  },
  {
    name: "bulk_clear",
    description: "Clear the unread markers on multiple chats at once.",
    inputSchema: {
      type: "object",
      required: ["chat_jids"],
      properties: {
        chat_jids: { type: "array", items: { type: "string" } },
      },
    },
    handler: async (toolCtx, args) => {
      const chatJids = Array.isArray(args.chat_jids) ? args.chat_jids : [];
      await bridgeFetch(toolCtx, "/api/read-bulk", {
        method: "POST",
        body: JSON.stringify({ chat_jids: chatJids }),
      });
      return { content: [{ type: "text", text: `cleared ${chatJids.length} chats` }] };
    },
  },
  {
    name: "label_add",
    description: "Create a label (name + color) in the daemon's label registry.",
    inputSchema: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string" },
        color: { type: "string", description: "Hex color, default #000000" },
      },
    },
    handler: async (toolCtx, args) => {
      const name = requireString(args, "name");
      const color = typeof args.color === "string" ? args.color : "#000000";
      const payload = (await bridgeFetch(toolCtx, "/api/labels", {
        method: "POST",
        body: JSON.stringify({ name, color }),
      })) as { id?: number };
      return { content: [{ type: "text", text: `label created: id ${payload.id ?? "?"}` }] };
    },
  },
  {
    name: "label_list",
    description:
      "List labels — all registry labels, or (with chat_jid) the labels carried by one chat.",
    inputSchema: {
      type: "object",
      properties: { chat_jid: { type: "string", description: "Scope to one chat's labels" } },
    },
    handler: async (toolCtx, args) => {
      const chatJid = typeof args.chat_jid === "string" ? args.chat_jid : undefined;
      const suffix = chatJid !== undefined ? `?chat_jid=${encodeURIComponent(chatJid)}` : "";
      const payload = (await bridgeFetch(toolCtx, `/api/labels${suffix}`)) as { labels?: unknown };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    },
  },
  {
    name: "label_assign",
    description: "Attach a label to a chat.",
    inputSchema: {
      type: "object",
      required: ["chat_jid", "label_id"],
      properties: {
        chat_jid: { type: "string" },
        label_id: { type: "number" },
      },
    },
    handler: async (toolCtx, args) => {
      const chatJid = requireString(args, "chat_jid");
      const labelId = requireNumber(args, "label_id");
      await bridgeFetch(toolCtx, "/api/labels", {
        method: "PUT",
        body: JSON.stringify({ chat_jid: chatJid, label_id: labelId }),
      });
      return { content: [{ type: "text", text: `label ${labelId} assigned to ${chatJid}` }] };
    },
  },
  {
    name: "label_remove",
    description: "Delete a label from the registry (and every chat carrying it).",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "number" } },
    },
    handler: async (toolCtx, args) => {
      const id = requireNumber(args, "id");
      await bridgeFetch(toolCtx, `/api/labels/${id}`, { method: "DELETE" });
      return { content: [{ type: "text", text: `label ${id} removed` }] };
    },
  },
  {
    name: "download_media",
    description:
      "Force-download a media message (if not already stored) and return the local file path.",
    inputSchema: {
      type: "object",
      required: ["message_id"],
      properties: { message_id: { type: "string" } },
    },
    handler: async (toolCtx, args) => {
      const messageId = requireString(args, "message_id");
      const payload = (await bridgeFetch(
        toolCtx,
        `/api/media/${encodeURIComponent(messageId)}/download`,
        { method: "POST", body: JSON.stringify({}) },
      )) as { path?: string; downloaded?: boolean; error?: { code: string; message: string } };
      if (payload.path === undefined) {
        return {
          content: [
            { type: "text", text: `NOT_FOUND: ${payload.error?.message ?? "message not found"}` },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: payload.downloaded
              ? `downloaded to ${payload.path}`
              : `already stored at ${payload.path}`,
          },
        ],
      };
    },
  },
  {
    name: "view_media",
    description:
      "Return media content to the model: images as base64 (size-capped), videos sampled to <=8 frames via ffmpeg.",
    inputSchema: {
      type: "object",
      required: ["chat_jid", "message_id"],
      properties: {
        chat_jid: { type: "string" },
        message_id: { type: "string" },
      },
    },
    handler: async (toolCtx, args) => {
      const chatJid = requireString(args, "chat_jid");
      const messageId = requireString(args, "message_id");
      let payload: {
        mime?: string;
        frames?: Array<{ data_base64: string }>;
        error?: { code: string; message: string };
      };
      try {
        payload = (await bridgeFetch(toolCtx, `/api/media/${encodeURIComponent(messageId)}/view`, {
          method: "POST",
          body: JSON.stringify({ chat_jid: chatJid, message_id: messageId }),
        })) as typeof payload;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: message }] };
      }
      if (payload.frames === undefined) {
        return {
          content: [
            {
              type: "text",
              text: `${payload.error?.code ?? "NOT_FOUND"}: ${payload.error?.message ?? "view failed"}`,
            },
          ],
        };
      }
      const content: ToolResult["content"] = [
        { type: "text", text: `${payload.mime} (${payload.frames.length} frame(s))` },
      ];
      for (const frame of payload.frames) {
        content.push({
          type: "image",
          data: frame.data_base64,
          mimeType: payload.mime ?? "image/jpeg",
        });
      }
      return { content };
    },
  },
  {
    name: "transcribe_voice",
    description:
      "Transcribe a voice note. Engines: WA_TRANSCRIBE_ENGINE=mock (default) | openai (any OpenAI-compatible endpoint). Live engines only with owner go-ahead.",
    inputSchema: {
      type: "object",
      required: ["chat_jid", "message_id"],
      properties: {
        chat_jid: { type: "string" },
        message_id: { type: "string" },
      },
    },
    handler: async (toolCtx, args) => {
      const chatJid = requireString(args, "chat_jid");
      const messageId = requireString(args, "message_id");
      let payload: {
        text?: string;
        engine?: string;
        cached?: boolean;
        error?: { code: string; message: string };
      };
      try {
        payload = (await bridgeFetch(toolCtx, "/api/transcribe", {
          method: "POST",
          body: JSON.stringify({ chat_jid: chatJid, message_id: messageId }),
        })) as typeof payload;
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err);
        return { content: [{ type: "text", text: message }] };
      }
      if (payload.text === undefined) {
        return {
          content: [
            {
              type: "text",
              text: `${payload.error?.code ?? "TRANSCRIBE_FAILED"}: ${payload.error?.message ?? "failed"}`,
            },
          ],
        };
      }
      return {
        content: [
          {
            type: "text",
            text: `[${payload.engine ?? "?"}${payload.cached ? ", cached" : ""}] ${payload.text}`,
          },
        ],
      };
    },
  },
  {
    name: "newsletter_follow",
    description: "Follow a WhatsApp newsletter channel.",
    inputSchema: {
      type: "object",
      required: ["jid"],
      properties: { jid: { type: "string", description: "Newsletter JID" } },
    },
    handler: async (toolCtx, args) => {
      const jid = requireString(args, "jid");
      await bridgeFetch(toolCtx, "/api/newsletters/follow", {
        method: "POST",
        body: JSON.stringify({ jid }),
      });
      return { content: [{ type: "text", text: `followed ${jid}` }] };
    },
  },
  {
    name: "newsletter_unfollow",
    description: "Unfollow a WhatsApp newsletter channel.",
    inputSchema: {
      type: "object",
      required: ["jid"],
      properties: { jid: { type: "string" } },
    },
    handler: async (toolCtx, args) => {
      const jid = requireString(args, "jid");
      await bridgeFetch(toolCtx, "/api/newsletters/unfollow", {
        method: "POST",
        body: JSON.stringify({ jid }),
      });
      return { content: [{ type: "text", text: `unfollowed ${jid}` }] };
    },
  },
  {
    name: "newsletter_send",
    description: "Send a text bulletin to a newsletter channel you own.",
    inputSchema: {
      type: "object",
      required: ["jid", "text"],
      properties: {
        jid: { type: "string", description: "Newsletter JID" },
        text: { type: "string" },
      },
    },
    handler: async (toolCtx, args) => {
      const jid = requireString(args, "jid");
      const text = requireString(args, "text");
      const payload = (await bridgeFetch(toolCtx, "/api/newsletters/send", {
        method: "POST",
        body: JSON.stringify({ jid, text }),
      })) as { message_id?: string };
      return {
        content: [{ type: "text", text: `newsletter sent: ${payload.message_id ?? "unknown id"}` }],
      };
    },
  },
  {
    name: "newsletter_list",
    description: "List followed newsletters from the daemon registry.",
    inputSchema: { type: "object", properties: {} },
    handler: async (toolCtx) => {
      const payload = (await bridgeFetch(toolCtx, "/api/newsletters")) as { newsletters?: unknown };
      return { content: [{ type: "text", text: JSON.stringify(payload, null, 2) }] };
    },
  },
  {
    name: "get_contact",
    description: "Get one contact's detail by JID (name, pushname, business name, phone).",
    inputSchema: {
      type: "object",
      required: ["jid"],
      properties: {
        jid: { type: "string" },
        with_photo: { type: "boolean", description: "Resolve the avatar URL too" },
      },
    },
    handler: async (toolCtx, args) => {
      const withPhoto = args.with_photo === true ? "?with_photo=true" : "";
      const jid = requireString(args, "jid");
      const payload = (await bridgeFetch(
        toolCtx,
        `/api/contacts/${encodeURIComponent(jid)}${withPhoto}`,
      )) as {
        contact?: unknown;
        error?: { code: string; message: string };
      };
      if (payload.contact === undefined) {
        return {
          content: [{ type: "text", text: `NOT_FOUND: ${payload.error?.message ?? "contact"}` }],
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(payload.contact, null, 2) }] };
    },
  },
  {
    name: "get_picture_url",
    description: "Fetch a chat/contact profile picture URL (preview size).",
    inputSchema: {
      type: "object",
      required: ["jid"],
      properties: { jid: { type: "string" } },
    },
    handler: async (toolCtx, args) => {
      const jid = requireString(args, "jid");
      const payload = (await bridgeFetch(toolCtx, "/api/picture-url", {
        method: "POST",
        body: JSON.stringify({ jid }),
      })) as { url?: string; error?: { code: string } };
      if (payload.url === undefined) {
        return { content: [{ type: "text", text: `NOT_FOUND: no profile picture for ${jid}` }] };
      }
      return { content: [{ type: "text", text: payload.url }] };
    },
  },
  {
    name: "get_poll_votes",
    description: "Poll results: question + per-option vote counts and voter lists.",
    inputSchema: {
      type: "object",
      required: ["chat_jid", "message_id"],
      properties: {
        chat_jid: { type: "string" },
        message_id: { type: "string" },
      },
    },
    handler: async (toolCtx, args) => {
      const chatJid = requireString(args, "chat_jid");
      const messageId = requireString(args, "message_id");
      const payload = (await bridgeFetch(
        toolCtx,
        `/api/poll-votes?message_id=${encodeURIComponent(messageId)}&chat_jid=${encodeURIComponent(chatJid)}`,
      )) as { poll?: unknown; error?: { code: string; message: string } };
      if (payload.poll === undefined) {
        return {
          content: [{ type: "text", text: `NOT_FOUND: ${payload.error?.message ?? "poll"}` }],
        };
      }
      return { content: [{ type: "text", text: JSON.stringify(payload.poll, null, 2) }] };
    },
  },
  {
    name: "cancel_scheduled",
    description: "Cancel a pending scheduled message.",
    inputSchema: {
      type: "object",
      required: ["id"],
      properties: { id: { type: "number" } },
    },
    handler: async (toolCtx, args) => {
      const id = requireNumber(args, "id");
      await bridgeFetch(toolCtx, `/api/scheduled/${id}`, { method: "DELETE" });
      return { content: [{ type: "text", text: `scheduled message ${id} cancelled` }] };
    },
  },
];

export function toolByName(name: string): ToolDef | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

/** T87 line118: name-keyed hints merged into tools/list responses. */
export const TOOL_ANNOTATIONS: Record<string, ToolAnnotations> = {
  get_login_qr: { readOnlyHint: true },
  list_chats: { readOnlyHint: true },
  list_messages: { readOnlyHint: true },
  get_message_context: { readOnlyHint: true },
  catch_up: { readOnlyHint: true },
  digest_group: { readOnlyHint: true },
  search_messages: { readOnlyHint: true },
  list_contacts: { readOnlyHint: true },
  get_contact: { readOnlyHint: true },
  get_picture_url: { readOnlyHint: true },
  get_poll_votes: { readOnlyHint: true },
  list_templates: { readOnlyHint: true },
  list_scheduled: { readOnlyHint: true },
  list_notification_rules: { readOnlyHint: true },
  get_blocklist: { readOnlyHint: true },
  get_unread_counts: { readOnlyHint: true, idempotentHint: true },
  get_media: { readOnlyHint: true },
  delete_message: { destructiveHint: true },
  logout: { destructiveHint: true },
  leave_group: { destructiveHint: true },
  block_unblock: { destructiveHint: true },
  cancel_scheduled: { destructiveHint: true },
  delete_notification_rule: { destructiveHint: true },
  restrict_sending: { destructiveHint: true, idempotentHint: true },
  autoreply_set: { destructiveHint: true, idempotentHint: true },
};

export function toolsWithAnnotations(): ToolDef[] {
  return TOOLS.map((tool) => ({
    ...tool,
    annotations: { openWorldHint: false, ...TOOL_ANNOTATIONS[tool.name] },
  }));
}
