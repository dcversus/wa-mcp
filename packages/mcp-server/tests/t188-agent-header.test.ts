import { expect, test } from "vite-plus/test";
import { parseMcpConfig } from "../src/bin.ts";
import { agentFromClientName, handleRpcLine, type ServerContext } from "../src/server.ts";
import { TOOLS } from "../src/tools.ts";

function recordingCtx(agent?: string): {
  ctx: ServerContext;
  headers: Array<Record<string, string>>;
} {
  const headers: Array<Record<string, string>> = [];
  const fetchFn = (async (_url: string | URL, init?: RequestInit) => {
    headers.push((init?.headers ?? {}) as Record<string, string>);
    return new Response(JSON.stringify({ message_id: "M1" }), { status: 200 });
  }) as unknown as typeof fetch;
  return {
    ctx: {
      tools: TOOLS,
      bridgeUrl: "http://127.0.0.1:27777",
      token: "secret",
      fetchFn,
      ...(agent === undefined ? {} : { agent }),
    },
    headers,
  };
}

function line(id: number, method: string, params?: unknown): string {
  return JSON.stringify({
    jsonrpc: "2.0",
    id,
    method,
    ...(params === undefined ? {} : { params }),
  });
}

const SEND = { name: "send_message", arguments: { chat_jid: "358497773518", text: "hi" } };

test("T188 P2 — --agent / WA_AGENT name the agent explicitly", () => {
  expect(parseMcpConfig(["--agent", "pi"], {}).agent).toBe("pi");
  expect(parseMcpConfig([], { WA_AGENT: "hermes" }).agent).toBe("hermes");
  expect(parseMcpConfig(["--agent", "pi"], { WA_AGENT: "hermes" }).agent).toBe("pi");
  expect(parseMcpConfig([], {}).agent).toBeUndefined();
});

test.each([
  ["claude-code", "claude-code"],
  ["claude-ai", "claude-desktop"],
  ["Claude Desktop", "claude-desktop"],
  ["cursor-vscode", "cursor"],
  ["codex-mcp-client", "codex"],
  ["Codex", "codex"],
  ["hermes-agent", "hermes"],
  ["grok-cli", "grok"],
  ["antigravity", "antigravity"],
  ["pi", "pi"],
  ["My Fancy Client 2.0", "my-fancy-client-2-0"],
])("T188 P2 — MCP clientInfo %s maps to agent %s", (name, agent) => {
  expect(agentFromClientName(name)).toBe(agent);
});

test("T188 P2 — tool calls carry x-wa-agent from the initialize handshake", async () => {
  const { ctx, headers } = recordingCtx();
  await handleRpcLine(
    line(1, "initialize", { clientInfo: { name: "codex-mcp-client", version: "0.50" } }),
    ctx,
  );
  await handleRpcLine(line(2, "tools/call", SEND), ctx);
  expect(headers[0]?.["x-wa-agent"]).toBe("codex");
});

test("T188 P2 — an explicit agent wins over clientInfo; no agent sends no header", async () => {
  const named = recordingCtx("pi");
  await handleRpcLine(line(1, "initialize", { clientInfo: { name: "claude-code" } }), named.ctx);
  await handleRpcLine(line(2, "tools/call", SEND), named.ctx);
  expect(named.headers[0]?.["x-wa-agent"]).toBe("pi");
  const anonymous = recordingCtx();
  await handleRpcLine(line(1, "initialize", {}), anonymous.ctx);
  await handleRpcLine(line(2, "tools/call", SEND), anonymous.ctx);
  expect(anonymous.headers[0]).not.toHaveProperty("x-wa-agent");
});
