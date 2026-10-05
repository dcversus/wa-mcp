import { expect, test } from "vite-plus/test";
import { handleStream, readCappedLines, JSON_RPC_LINE_CAP } from "../src/bin.ts";
import type { ServerContext } from "../src/server.ts";

function makeCtx(): ServerContext {
  return {
    tools: [],
    bridgeUrl: "http://127.0.0.1:8080",
    token: "test",
  };
}

async function* linesOf(lines: string[]): AsyncGenerator<string> {
  for (const line of lines) {
    yield line;
  }
}

test("T139 — a subscribe survives a later request on the same stream (session is not reset per line)", async () => {
  const ctx = makeCtx();
  const writes: string[] = [];
  const input = linesOf([
    JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/subscribe",
      params: { uri: "wa://unread" },
    }),
    JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" }),
    JSON.stringify({
      jsonrpc: "2.0",
      id: 3,
      method: "resources/subscribe",
      params: { uri: "wa://chats" },
    }),
  ]);
  await handleStream(input, (line) => writes.push(line), ctx);
  expect(ctx.session?.subscriptions.has("wa://unread")).toBe(true);
  expect(ctx.session?.subscriptions.has("wa://chats")).toBe(true);
  const ping = writes.find((line) => line.includes('"id":2'));
  expect(ping).toContain("result");
});

test("T139 — readCappedLines yields lines as an async generator with a single handleStream consumer", async () => {
  const ctx = makeCtx();
  const writes: string[] = [];
  const chunks: string[] = [];
  const filler = "x".repeat(JSON_RPC_LINE_CAP + 5);
  for (let i = 0; i < filler.length; i += 1000) {
    chunks.push(filler.slice(i, i + 1000));
  }
  chunks.push("\n");
  chunks.push(
    JSON.stringify({
      jsonrpc: "2.0",
      id: 7,
      method: "resources/subscribe",
      params: { uri: "wa://unread" },
    }) + "\n",
  );
  chunks.push(JSON.stringify({ jsonrpc: "2.0", id: 8, method: "ping" }) + "\n");
  const input = (async function* generate() {
    for (const chunk of chunks) {
      yield chunk;
    }
  })();
  await handleStream(readCappedLines(input, JSON_RPC_LINE_CAP), (line) => writes.push(line), ctx);
  expect(ctx.session?.subscriptions.has("wa://unread")).toBe(true);
  const ping = writes.find((line) => line.includes('"id":8'));
  expect(ping).toContain("result");
});

test("T139 — multibyte UTF-8 split across chunks survives (Cyrillic)", async () => {
  const ctx = makeCtx();
  const writes: string[] = [];
  const payload = JSON.stringify({
    jsonrpc: "2.0",
    id: 9,
    method: "ping",
    params: { note: "привет мир" },
  });
  const bytes = Buffer.from(payload + "\n", "utf8");
  const input = (async function* generate() {
    const mid = Math.floor(bytes.length / 2);
    yield bytes.subarray(0, mid);
    yield bytes.subarray(mid);
  })();
  await handleStream(readCappedLines(input, JSON_RPC_LINE_CAP), (line) => writes.push(line), ctx);
  const pong = writes.find((line) => line.includes('"id":9'));
  expect(pong).toContain("result");
});
