#!/usr/bin/env node
import { createInterface } from "node:readline";
import { pathToFileURL } from "node:url";
import { handleRpcLine, type JsonRpcResponse, type ServerContext } from "./server.ts";
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

export async function handleStream(
  lines: Iterable<string> | AsyncIterable<string>,
  write: (line: string) => void,
  ctx: ServerContext,
): Promise<void> {
  for await (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length === 0) {
      continue;
    }
    const response: JsonRpcResponse | null = await handleRpcLine(trimmed, ctx);
    if (response !== null) {
      write(JSON.stringify(response));
    }
  }
}

export async function main(args: string[], env: NodeJS.ProcessEnv = process.env): Promise<void> {
  const config = parseMcpConfig(args, env);
  if (config.token === undefined || config.token.length === 0) {
    console.error("wa-mcp mcp-server: a bridge token is required (--token or WA_TOKEN)");
    process.exitCode = 1;
    return;
  }
  const ctx: ServerContext = { tools: TOOLS, bridgeUrl: config.bridgeUrl, token: config.token };
  const rl = createInterface({ input: process.stdin });
  await handleStream(
    rl,
    (line) => {
      process.stdout.write(`${line}\n`);
    },
    ctx,
  );
}

if (process.argv[1] !== undefined && import.meta.url === pathToFileURL(process.argv[1]).href) {
  void main(process.argv.slice(2));
}
