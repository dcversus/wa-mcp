import { expect, test } from "vite-plus/test";
import { handleStream, JSON_RPC_LINE_CAP, type ServerContext } from "../src/bin.ts";
import type { ServerContext as Ctx } from "../src/server.ts";

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
