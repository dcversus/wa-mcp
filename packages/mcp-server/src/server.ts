import { TOOLS, toolByName, ParamError, type ToolContext, type ToolDef } from "./tools.ts";

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

export interface ServerContext {
  tools: ToolDef[];
  bridgeUrl: string;
  token: string;
  fetchFn?: typeof fetch;
}

export interface WaResource {
  uri: string;
  name: string;
  description: string;
  mimeType: string;
}

export const WA_RESOURCES: WaResource[] = [
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
  if (uri === "wa://health") {
    return "/health";
  }
  return null;
}

async function readResource(toolCtx: ToolContext, uri: string): Promise<Record<string, unknown>> {
  const path = resourcePath(uri);
  if (path === null) {
    throw new ParamError(`unknown resource: ${uri}`);
  }
  const payload = (await bridgeFetchResource(toolCtx, path)) as Record<string, unknown>;
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

export const SERVER_INFO = { name: "wa-mcp", version: "0.9.0" } as const;
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
  if (args === undefined || args === null) {
    return toolResultToPayload(await tool.handler(toolCtx, {}));
  }
  if (typeof args !== "object" || Array.isArray(args)) {
    throw new ParamError("arguments must be an object");
  }
  return toolResultToPayload(await tool.handler(toolCtx, args as Record<string, unknown>));
}

function toolResultToPayload(result: {
  content: Array<{ type: string; text: string }>;
}): Record<string, unknown> {
  return { content: result.content };
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
        return {
          protocolVersion: PROTOCOL_VERSION,
          capabilities: { tools: {}, resources: {} },
          serverInfo: SERVER_INFO,
        };
      case "ping":
        return {};
      case "tools/list":
        return {
          tools: ctx.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            inputSchema: tool.inputSchema,
          })),
        };
      case "tools/call":
        return dispatchToolCall(
          { bridgeUrl: ctx.bridgeUrl, token: ctx.token, fetchFn: ctx.fetchFn },
          ctx.tools,
          request.params,
        );
      case "resources/list":
        return { resources: WA_RESOURCES };
      case "resources/read": {
        const params = request.params as { uri?: unknown } | undefined;
        const uri = typeof params?.uri === "string" ? params.uri : undefined;
        if (uri === undefined) {
          throw new ParamError("uri is required");
        }
        return readResource(
          { bridgeUrl: ctx.bridgeUrl, token: ctx.token, fetchFn: ctx.fetchFn },
          uri,
        );
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

export { TOOLS, toolByName };
export type { ToolContext, ToolDef };
