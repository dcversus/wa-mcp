#!/usr/bin/env node
import { realpathSync } from "node:fs";
import { StringDecoder } from "node:string_decoder";
import { pathToFileURL } from "node:url";
import {
  handleRpcLine,
  shouldForward,
  type JsonRpcResponse,
  type ServerContext,
} from "./server.ts";
import { TOOLS } from "./tools.ts";

export interface McpConfig {
  bridgeUrl: string;
  token: string | undefined;
}

export function parseMcpConfig(args: string[], env: Record<string, string | undefined>): McpConfig {
  let bridgeUrl: string | undefined;
  let token: string | undefined;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--bridge-url") {
      bridgeUrl = args[index + 1];
      index += 1;
    } else if (arg === "--token") {
      token = args[index + 1];
      index += 1;
    }
  }
  return {
    bridgeUrl: bridgeUrl ?? env.WA_BRIDGE_URL ?? "http://127.0.0.1:8080",
    token: token ?? env.WA_TOKEN,
  };
}

export const JSON_RPC_LINE_CAP = 4 * 1024 * 1024;

export async function handleStream(
  lines: Iterable<string> | AsyncIterable<string>,
  write: (line: string) => void,
  ctx: ServerContext,
): Promise<void> {
  let pump: Promise<void> | null = null;
  ctx.session = { subscriptions: new Set<string>() };
  for await (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    if (trimmed.length > JSON_RPC_LINE_CAP) {
      write(
        JSON.stringify({
          jsonrpc: "2.0",
          id: null,
          error: {
            code: -32600,
            message: `request too large: ${trimmed.length} characters exceeds the ${JSON_RPC_LINE_CAP} line cap`,
          },
        }),
      );
      continue;
    }
    const response: JsonRpcResponse | null = await handleRpcLine(trimmed, ctx);
    if (response !== null) {
      write(JSON.stringify(response));
    }
    if (
      pump === null &&
      ctx.session !== undefined &&
      ctx.session.subscriptions.size > 0 &&
      ctx.fetchFn !== undefined
    ) {
      pump = pumpNotifications(ctx, write);
    }
  }
}

async function pumpNotifications(ctx: ServerContext, write: (line: string) => void): Promise<void> {
  const controller = new AbortController();
  try {
    const fetchFn = ctx.fetchFn;
    if (fetchFn === undefined) {
      return;
    }
    const res = await fetchFn(`${ctx.bridgeUrl}/api/mcp-notify`, {
      headers: { authorization: "Bearer " + ctx.token },
      signal: controller.signal,
    });
    if (res.body === null) {
      return;
    }
    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffered = "";
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) {
        break;
      }
      buffered += decoder.decode(chunk.value, { stream: true });
      const frames = buffered.split("\n\n");
      buffered = frames.pop() ?? "";
      for (const frame of frames) {
        for (const dataLine of frame.split("\n")) {
          if (!dataLine.startsWith("data: ")) {
            continue;
          }
          try {
            const notification = JSON.parse(dataLine.slice(6)) as {
              jsonrpc: "2.0";
              method: string;
              params: Record<string, unknown>;
            };
            if (shouldForward(ctx.session, notification)) {
              write(JSON.stringify(notification));
            }
          } catch {
            break;
          }
        }
      }
    }
  } catch {
    return;
  }
}

/** Character-counting line generator: unlike readline, memory stays bounded
 * at the cap — an oversized line is dropped as soon as it EXCEEDS the cap
 * while still streaming, instead of being buffered whole and rejected
 * afterwards. Yields complete lines only; the ONE handleStream consumer
 * keeps its MCP session and notification pump across lines. */
export async function* readCappedLines(
  input: AsyncIterable<string | Buffer>,
  cap: number,
): AsyncGenerator<string> {
  const decoder = new StringDecoder("utf8");
  let buffer = "";
  let dropping = false;
  const oversized = (): string =>
    JSON.stringify({
      jsonrpc: "2.0",
      id: null,
      error: { code: -32600, message: `line exceeds ${cap} characters — dropping` },
    });
  for await (const chunk of input) {
    buffer += decoder.write(typeof chunk === "string" ? Buffer.from(chunk, "utf8") : chunk);
    let newlineIndex = buffer.indexOf("\n");
    while (newlineIndex !== -1) {
      const line = buffer.slice(0, newlineIndex);
      buffer = buffer.slice(newlineIndex + 1);
      if (dropping) {
        dropping = false;
      } else {
        yield line;
      }
      newlineIndex = buffer.indexOf("\n");
    }
    if (buffer.length > cap) {
      if (!dropping) {
        yield oversized();
      }
      dropping = true;
      buffer = "";
    }
  }
  buffer += decoder.end();
  if (buffer.length > 0) {
    if (dropping) {
      return;
    }
    if (buffer.length > cap) {
      yield oversized();
      return;
    }
    yield buffer;
  }
}

export async function main(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = parseMcpConfig(args, env);
  if (config.token === undefined || config.token.length === 0) {
    console.error("wa-mcp mcp-server: a bridge token is required (--token or WA_TOKEN)");
    process.exitCode = 1;
    return;
  }
  const ctx: ServerContext = {
    tools: TOOLS,
    bridgeUrl: config.bridgeUrl,
    token: config.token,
    fetchFn: fetch,
  };
  await handleStream(
    readCappedLines(process.stdin, JSON_RPC_LINE_CAP),
    (line) => {
      process.stdout.write(`${line}\n`);
    },
    ctx,
  );
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  void main(process.argv.slice(2));
}
