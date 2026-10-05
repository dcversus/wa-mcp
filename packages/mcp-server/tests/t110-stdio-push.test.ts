import { expect, test } from "vite-plus/test";
import { handleStream } from "../src/bin.ts";
import type { ServerContext } from "../src/server.ts";
import { TOOLS } from "../src/tools.ts";

function makeSseBody(lines: string[]): ReadableStream<Uint8Array> {
  const encoder = new TextEncoder();
  return new ReadableStream<Uint8Array>({
    start(controller) {
      for (const line of lines) {
        controller.enqueue(encoder.encode(`data: ${line}\n\n`));
      }
      controller.close();
    },
  });
}

test("after resources/subscribe wa://unread, a bridge upsert yields a notifications/resources/updated line on stdout", async () => {
  const written: string[] = [];
  const ctx: ServerContext = {
    tools: TOOLS,
    bridgeUrl: "http://127.0.0.1:1",
    token: "t",
    fetchFn: (async (input: string | URL) => {
      const url = String(input);
      if (url.endsWith("/api/mcp-notify")) {
        return new Response(
          makeSseBody([
            JSON.stringify({
              jsonrpc: "2.0",
              method: "notifications/resources/updated",
              params: { uri: "wa://unread" },
            }),
            JSON.stringify({
              jsonrpc: "2.0",
              method: "notifications/resources/updated",
              params: { uri: "wa://chats" },
            }),
          ]),
          { status: 200, headers: { "content-type": "text/event-stream" } },
        );
      }
      throw new Error(`unexpected fetch ${url}`);
    }) as unknown as typeof fetch,
  };
  const input = async function* () {
    yield JSON.stringify({ jsonrpc: "2.0", id: 1, method: "initialize", params: {} });
    yield JSON.stringify({
      jsonrpc: "2.0",
      id: 2,
      method: "resources/subscribe",
      params: { uri: "wa://unread" },
    });
    yield "";
    await new Promise((resolve) => setTimeout(resolve, 200));
  };
  await handleStream(input(), (line) => written.push(line), ctx);
  const notifications = written
    .map((line) => JSON.parse(line) as { method?: string; params?: { uri?: string } })
    .filter((entry) => entry.method === "notifications/resources/updated");
  expect(notifications).toHaveLength(1);
  expect(notifications[0]?.params?.uri).toBe("wa://unread");
});

test("unsubscribed URIs produce no line", async () => {
  const written: string[] = [];
  const ctx: ServerContext = {
    tools: TOOLS,
    bridgeUrl: "http://127.0.0.1:1",
    token: "t",
    fetchFn: (async () => {
      return new Response(
        makeSseBody([
          JSON.stringify({
            jsonrpc: "2.0",
            method: "notifications/resources/updated",
            params: { uri: "wa://chats" },
          }),
        ]),
        { status: 200, headers: { "content-type": "text/event-stream" } },
      );
    }) as unknown as typeof fetch,
  };
  const input = async function* () {
    yield JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "resources/subscribe",
      params: { uri: "wa://unread" },
    });
    await new Promise((resolve) => setTimeout(resolve, 200));
  };
  await handleStream(input(), (line) => written.push(line), ctx);
  const notifications = written
    .map((line) => JSON.parse(line) as { method?: string })
    .filter((entry) => entry.method === "notifications/resources/updated");
  expect(notifications).toHaveLength(0);
});
