import {
  toolsWithAnnotations,
  toolByName,
  ParamError,
  type ToolContext,
  type ToolDef,
} from "./tools.ts";

export interface JsonRpcError {
  code: number;
  message: string;
  data?: unknown;
}

export interface JsonRpcResponse {
  jsonrpc: "2.0";
  id: string | number | null;
  result?: unknown;
  error?: JsonRpcError;
}

export interface McpSession {
  subscriptions: Set<string>;
  agent?: string;
}

export interface ServerContext {
  tools: ToolDef[];
  bridgeUrl: string;
  token: string;
  fetchFn?: typeof fetch;
  session?: McpSession;
  agent?: string;
  clientAgent?: string;
  /** subscription ids adopted by THIS stdio process (via subscribe_events
   * tool calls) — channel frames are only forwarded for these */
  channelSubs?: Set<string>;
}

const CLIENT_AGENTS: Array<[RegExp, string]> = [
  [/^claude[-\s]?code/i, "claude-code"],
  [/^claude/i, "claude-desktop"],
  [/codex/i, "codex"],
  [/grok/i, "grok"],
  [/antigravity/i, "antigravity"],
  [/^pi(?:$|[-\s])/i, "pi"],
];

export function agentFromClientName(name: string): string {
  const known = CLIENT_AGENTS.find(([pattern]) => pattern.test(name.trim()));
  if (known !== undefined) {
    return known[1];
  }
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
}

function learnClient(ctx: ServerContext, params: unknown): void {
  const name = (params as { clientInfo?: { name?: unknown } } | undefined)?.clientInfo?.name;
  if (typeof name !== "string" || name.trim().length === 0) {
    return;
  }
  const agent = agentFromClientName(name);
  if (agent.length === 0) {
    return;
  }
  ctx.clientAgent = agent;
  if (ctx.session !== undefined) {
    ctx.session.agent = agent;
  }
}

function toolContext(ctx: ServerContext): ToolContext {
  const agent = ctx.agent ?? ctx.session?.agent ?? ctx.clientAgent;
  return {
    bridgeUrl: ctx.bridgeUrl,
    token: ctx.token,
    fetchFn: ctx.fetchFn,
    ...(agent === undefined ? {} : { agent }),
  };
}

export interface WaResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export const WA_RESOURCES: WaResource[] = [
  {
    uri: "wa://sync-status",
    name: "Sync status",
    description: "Live connection and sync state (connected, loggedIn, reconnects, contactsWarm)",
    mimeType: "application/json",
  },
  {
    uri: "wa://config",
    name: "Configuration",
    description:
      "Non-secret server configuration (bridge URL, version, transport) — never the token",
    mimeType: "application/json",
  },
  {
    uri: "wa://chats",
    name: "Chats",
    description: "WhatsApp chat list with unread counts and previews",
    mimeType: "application/json",
  },
  {
    uri: "wa://unread",
    name: "Unread counts",
    description: "Per-chat unread message counts",
    mimeType: "application/json",
  },
  {
    uri: "wa://health",
    name: "Bridge health",
    description: "Bridge connection status",
    mimeType: "application/json",
  },
];

function resourcePath(uri: string): string | null {
  if (uri === "wa://chats") {
    return "/api/chats";
  }
  if (uri === "wa://unread") {
    return "/api/unread";
  }
  if (uri === "wa://health" || uri === "wa://sync-status") {
    return "/health";
  }
  return null;
}

async function readResource(toolCtx: ToolContext, uri: string): Promise<Record<string, unknown>> {
  let payload: Record<string, unknown>;
  if (uri === "wa://config") {
    payload = {
      bridge_url: toolCtx.bridgeUrl,
      version: SERVER_INFO.version,
      transport: "http",
      auth: "bearer token (redacted)",
      tools: TOOLS.length,
    };
  } else {
    const path = resourcePath(uri);
    if (path === null) {
      throw new ParamError(`unknown resource: ${uri}`);
    }
    payload = (await bridgeFetchResource(toolCtx, path)) as Record<string, unknown>;
  }
  return {
    contents: [{ uri, mimeType: "application/json", text: JSON.stringify(payload) }],
  };
}

async function bridgeFetchResource(toolCtx: ToolContext, path: string): Promise<unknown> {
  const fetchFn = toolCtx.fetchFn ?? fetch;
  const response = await fetchFn(`${toolCtx.bridgeUrl}${path}`, {
    method: "GET",
    headers: { authorization: `Bearer ${toolCtx.token}` },
  });
  return response.json();
}

export const SERVER_INFO = { name: "wa-mcp", version: "0.1.0" } as const;
export const PROTOCOL_VERSION = "2025-06-18";

const PARSE_ERROR = -32700;
const INVALID_REQUEST = -32600;
const METHOD_NOT_FOUND = -32601;
const INVALID_PARAMS = -32602;
const INTERNAL_ERROR = -32603;

interface IncomingRequest {
  jsonrpc?: unknown;
  id?: unknown;
  method?: unknown;
  params?: unknown;
}

function errorResponse(id: string | number | null, code: number, message: string): JsonRpcResponse {
  return { jsonrpc: "2.0", id, error: { code, message } };
}

function validId(id: unknown): string | number | null {
  return typeof id === "string" || typeof id === "number" ? id : null;
}

async function dispatchToolCall(
  ctx: ServerContext,
  toolCtx: ToolContext,
  registry: ToolDef[],
  params: unknown,
): Promise<Record<string, unknown>> {
  if (params === null || typeof params !== "object") {
    throw new ParamError("tools/call requires {name, arguments}");
  }
  const { name, arguments: args } = params as { name?: unknown; arguments?: unknown };
  if (typeof name !== "string") {
    throw new ParamError("tools/call requires a tool name");
  }
  const tool = registry.find((candidate) => candidate.name === name);
  if (tool === undefined) {
    throw new ParamError(`unknown tool: ${name}`);
  }
  // T94-D-H5claude: tool-EXECUTION failures ride result.isError (the model
  // reads the message and recovers) — only argument problems stay protocol
  // errors. One hung call can no longer wedge the stdio session either,
  // because bridgeFetch arms its own abort timeout.
  try {
    if (args === undefined || args === null) {
      return toolResultToPayload(trackChannelSub(tool.name, await tool.handler(toolCtx, {}), ctx));
    }
    if (typeof args !== "object" || Array.isArray(args)) {
      throw new ParamError("arguments must be an object");
    }
    return toolResultToPayload(
      trackChannelSub(tool.name, await tool.handler(toolCtx, args as Record<string, unknown>), ctx),
    );
  } catch (err) {
    if (err instanceof ParamError) {
      throw err;
    }
    return {
      content: [
        {
          type: "text",
          text: `tool failed: ${err instanceof Error ? err.message : String(err)}`,
        },
      ],
      isError: true,
    };
  }
}

function toolResultToPayload(result: import("./tools.ts").ToolResult): Record<string, unknown> {
  return result.isError === true
    ? { content: result.content, isError: true }
    : { content: result.content };
}

type PromptGetParams = { name?: string; arguments?: Record<string, string> };

/** subscribe_events/unsubscribe_events results update the process-local
 * channel-adoption set, so notifications/claude/channel frames only reach
 * the session that created the subscription. */
function trackChannelSub(
  toolName: string,
  result: import("./tools.ts").ToolResult,
  ctx: ServerContext,
): import("./tools.ts").ToolResult {
  const set = ctx.channelSubs;
  if (set === undefined || result.isError === true) {
    return result;
  }
  const text = result.content.find((part) => part.type === "text")?.text;
  if (typeof text !== "string") {
    return result;
  }
  try {
    const payload = JSON.parse(text) as { id?: unknown };
    if (toolName === "subscribe_events" && typeof payload.id === "string") {
      set.add(payload.id);
    } else if (toolName === "unsubscribe_events" && typeof payload.id === "string") {
      set.delete(payload.id);
    }
  } catch {
    // non-JSON result — nothing to track
  }
  return result;
}

export async function handleRpcMessage(
  message: unknown,
  ctx: ServerContext,
): Promise<JsonRpcResponse | null> {
  if (message === null || typeof message !== "object" || Array.isArray(message)) {
    return errorResponse(null, INVALID_REQUEST, "request must be a JSON-RPC 2.0 object");
  }
  const request = message as IncomingRequest;
  if (request.jsonrpc !== "2.0") {
    return errorResponse(validId(request.id), INVALID_REQUEST, "jsonrpc must be exactly '2.0'");
  }
  if (typeof request.method !== "string") {
    return errorResponse(validId(request.id), INVALID_REQUEST, "method is required");
  }
  if (request.method === "notifications/initialized") {
    return null;
  }
  if (request.id === undefined) {
    return null;
  }
  const id = validId(request.id);
  const run = async (): Promise<Record<string, unknown>> => {
    switch (request.method) {
      case "initialize":
        learnClient(ctx, (request as { params?: unknown }).params);
        return {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: {
            tools: {},
            resources: { subscribe: true, listChanged: true },
            prompts: {},
            logging: {},
            notifications: {},
          },
          serverInfo: SERVER_INFO,
        };
      case "prompts/list":
        return {
          prompts: [
            {
              name: "group-digest",
              description:
                "Summarize a group's activity since a date (counts, top participants, open questions).",
              arguments: [
                { name: "group", description: "Group JID", required: true },
                { name: "since", description: "ISO date to summarize from", required: true },
              ],
            },
            {
              name: "catch-up",
              description:
                "Catch-up digest across all chats since a date (active chats, questions aimed at you, media).",
              arguments: [
                { name: "since", description: "ISO date to catch up from", required: true },
              ],
            },
            {
              name: "action-items",
              description: "Extract open questions and asks from one chat.",
              arguments: [
                { name: "chat", description: "Chat JID", required: true },
                { name: "since", description: "ISO date to scan from" },
              ],
            },
          ],
        };
      case "prompts/get": {
        const promptParams = (request as { params?: PromptGetParams }).params;
        const promptName = String(promptParams?.name ?? "");
        const promptArgs = promptParams?.arguments ?? {};
        if (promptName === "group-digest") {
          const group = String(promptArgs.group ?? "");
          const since = String(promptArgs.since ?? "");
          return {
            description: `Summarize ${group} since ${since}`,
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text:
                    `Use the digest_group tool (group=${group}, since=${since}) to summarize this group: ` +
                    "message counts, top participants by volume, open questions and media/poll counts. " +
                    "Present the result as a short markdown briefing.",
                },
              },
            ],
          };
        }
        if (promptName === "catch-up") {
          const since = String(promptArgs.since ?? "");
          return {
            description: `Catch-up digest since ${since}`,
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text:
                    `Use the catch_up tool (since=${since}) to list active chats, questions directed at me ` +
                    "and media counts. Highlight anything that looks urgent or unanswered.",
                },
              },
            ],
          };
        }
        if (promptName === "action-items") {
          const chat = String(promptArgs.chat ?? "");
          const since = String(promptArgs.since ?? "");
          return {
            description: `Action items in ${chat}`,
            messages: [
              {
                role: "user",
                content: {
                  type: "text",
                  text:
                    `Use search_messages on chat ${chat}` +
                    (since ? ` (since=${since})` : "") +
                    " to find open questions and requests, then list each as an action item with its sender and date.",
                },
              },
            ],
          };
        }
        throw new MethodNotFoundError(promptName || "(empty)");
      }
      case "ping":
        return {};
      case "tools/list":
        return {
          tools: toolsWithAnnotations().map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
            annotations: tool.annotations,
          })),
        };
      case "tools/call":
        return dispatchToolCall(ctx, toolContext(ctx), ctx.tools, request.params);
      case "resources/list":
        return { resources: WA_RESOURCES };
      case "resources/subscribe":
      case "resources/unsubscribe": {
        const params = request.params as { uri?: unknown } | undefined;
        const uri = typeof params?.uri === "string" ? params.uri : undefined;
        if (uri === undefined) {
          throw new ParamError("uri is required");
        }
        if (!WA_RESOURCES.some((resource) => resource.uri === uri)) {
          throw new ParamError(`unknown resource: ${uri}`);
        }
        ctx.session?.subscriptions[request.method === "resources/subscribe" ? "add" : "delete"](
          uri,
        );
        return {};
      }
      case "resources/read": {
        const params = request.params as { uri?: unknown } | undefined;
        const uri = typeof params?.uri === "string" ? params.uri : undefined;
        if (uri === undefined) {
          throw new ParamError("uri is required");
        }
        return readResource(toolContext(ctx), uri);
      }
      default:
        throw new MethodNotFoundError(String(request.method));
    }
  };
  return run()
    .then((result) => ({ jsonrpc: "2.0", id, result }) as JsonRpcResponse)
    .catch((err: unknown) => {
      if (err instanceof MethodNotFoundError) {
        return errorResponse(id, METHOD_NOT_FOUND, err.message);
      }
      if (err instanceof ParamError) {
        return errorResponse(id, INVALID_PARAMS, err.message);
      }
      return errorResponse(
        id,
        INTERNAL_ERROR,
        err instanceof Error ? err.message : "internal error",
      );
    });
}

export class MethodNotFoundError extends Error {
  constructor(method: string) {
    super(`unknown method: ${method}`);
  }
}

export async function handleRpcLine(
  line: string,
  ctx: ServerContext,
): Promise<JsonRpcResponse | null> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line) as unknown;
  } catch {
    return errorResponse(null, PARSE_ERROR, "invalid JSON");
  }
  return handleRpcMessage(parsed, ctx);
}

export { toolByName };
import { TOOLS } from "./tools.ts";
export { TOOLS };
export type { ToolContext, ToolDef };

export interface ForwardableNotification {
  jsonrpc: "2.0";
  method: string;
  params: Record<string, unknown>;
}

export function shouldForward(
  session: McpSession | undefined,
  notification: ForwardableNotification,
  ctx?: ServerContext,
): boolean {
  if (
    notification.method === "notifications/message" ||
    notification.method === "notifications/tools/list_changed"
  ) {
    return true;
  }
  if (notification.method === "notifications/claude/channel") {
    const meta = notification.params.meta as
      | { subscription_id?: unknown; agent?: unknown }
      | undefined;
    if (meta === undefined) {
      return false;
    }
    if (
      typeof meta.agent === "string" &&
      typeof ctx?.agent === "string" &&
      meta.agent !== ctx.agent
    ) {
      return false;
    }
    return ctx?.channelSubs?.has(String(meta.subscription_id)) ?? false;
  }
  if (notification.method === "notifications/resources/updated") {
    const uri = notification.params.uri;
    return typeof uri === "string" && (session?.subscriptions.has(uri) ?? false);
  }
  return false;
}
