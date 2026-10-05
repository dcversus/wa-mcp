import { expect, test } from "vite-plus/test";
import { handleStream, readCappedLines, JSON_RPC_LINE_CAP } from "../src/bin.ts";
import type { ServerContext } from "../src/server.ts";

function makeCtx(): ServerContext {
  return {
    bridgeUrl: "http://127.0.0.1:1",
    token: "t",
    fetchFn: undefined,
    session: undefined,
  } as unknown as ServerContext;
}

test("an oversized line is rejected with PARSE/limit error, not processed", async () => {
  const writes: string[] = [];
  const huge = JSON.stringify({
    jsonrpc: "2.0",
    id: 1,
    method: "ping",
    params: { filler: "x".repeat(JSON_RPC_LINE_CAP) },
  });
  await handleStream([huge], (line) => writes.push(line), makeCtx());
  expect(writes.length).toBe(1);
  const parsed = JSON.parse(writes[0]!) as { error?: { code?: number; message?: string } };
  expect(parsed.error?.message).toContain("too large");
});

test("a normal-size line still flows", async () => {
  const writes: string[] = [];
  await handleStream(
    [JSON.stringify({ jsonrpc: "2.0", id: 2, method: "ping" })],
    (line) => writes.push(line),
    makeCtx(),
  );
  expect(writes.length).toBe(1);
  const parsed = JSON.parse(writes[0]!) as { id?: number };
  expect(parsed.id).toBe(2);
});

test("readCappedLines drops an oversized line DURING streaming (bounded memory)", async () => {
  const writes: string[] = [];
  const chunks: string[] = [];
  const filler = "x".repeat(JSON_RPC_LINE_CAP + 5);
  for (let i = 0; i < filler.length; i += 1000) {
    chunks.push(filler.slice(i, i + 1000));
  }
  chunks.push("\n");
  chunks.push(JSON.stringify({ jsonrpc: "2.0", id: 7, method: "ping" }) + "\n");
  const input = (async function* generate() {
    for (const chunk of chunks) {
      yield chunk;
    }
  })();
  for await (const line of readCappedLines(input, JSON_RPC_LINE_CAP)) {
    writes.push(line);
  }
  const oversized = writes.find((line) => line.includes("exceeds"));
  expect(oversized).toContain("-32600");
  expect(writes.some((line) => line.includes('"id":7'))).toBe(true);
});
