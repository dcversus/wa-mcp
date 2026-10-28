import { expect, test } from "vite-plus/test";
import { handleRpcMessage, shouldForward, type ServerContext } from "../src/server.ts";
import { TOOLS } from "../src/tools.ts";

function ctx(channelSubs: string[], agent?: string): ServerContext {
  return {
    tools: TOOLS,
    bridgeUrl: "http://127.0.0.1:1",
    token: "t",
    channelSubs: new Set(channelSubs),
    ...(agent === undefined ? {} : { agent }),
  };
}

test("T193 — channel frames forward only for subscriptions this session created", () => {
  const context = ctx(["sub-own"]);
  const frame = (meta: Record<string, unknown>) =>
    ({
      jsonrpc: "2.0",
      method: "notifications/claude/channel",
      params: { content: "hi", meta },
    }) as Parameters<typeof shouldForward>[1];
  expect(shouldForward(undefined, frame({ subscription_id: "sub-own" }), context)).toBe(true);
  expect(shouldForward(undefined, frame({ subscription_id: "sub-foreign" }), context)).toBe(false);
  expect(shouldForward(undefined, frame({}), context)).toBe(false);
  expect(shouldForward(undefined, frame({ subscription_id: "sub-own" }), ctx(["sub-own"]))).toBe(
    true,
  );
});

test("T193 — agent-scoped channel frames drop when the agent differs", () => {
  const mine = ctx(["sub-own"], "claude-code");
  const frame = {
    jsonrpc: "2.0",
    method: "notifications/claude/channel",
    params: { content: "hi", meta: { subscription_id: "sub-own", agent: "codex" } },
  } as Parameters<typeof shouldForward>[1];
  expect(shouldForward(undefined, frame, mine)).toBe(false);
  const matching = {
    ...frame,
    params: { content: "hi", meta: { subscription_id: "sub-own", agent: "claude-code" } },
  } as Parameters<typeof shouldForward>[1];
  expect(shouldForward(undefined, matching, mine)).toBe(true);
});

test("T193 — subscribe_events result adopts the subscription; unsubscribe drops it", async () => {
  const context = ctx([]);
  const fetchFn = (async () =>
    new Response(JSON.stringify({ id: "sub-live", inboxPath: "/tmp/x.jsonl" }), {
      status: 200,
      headers: { "content-type": "application/json" },
    })) as typeof fetch;
  const contextWithFetch = { ...context, fetchFn };
  const subscribe = await handleRpcMessage(
    {
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "subscribe_events", arguments: { chat_jid: "120363428874442773@g.us" } },
    },
    contextWithFetch,
  );
  expect(JSON.stringify(subscribe)).toContain("sub-live");
  expect(contextWithFetch.channelSubs?.has("sub-live")).toBe(true);

  const unsubscribe = await handleRpcMessage(
    {
      jsonrpc: "2.0",
      id: 2,
      method: "tools/call",
      params: { name: "unsubscribe_events", arguments: { id: "sub-live" } },
    },
    contextWithFetch,
  );
  expect(JSON.stringify(unsubscribe)).toBeTruthy();
  expect(contextWithFetch.channelSubs?.has("sub-live")).toBe(false);
});

test("T193 — channel=true subscribe posts mode channel with the session agent", async () => {
  const bodies: string[] = [];
  const fetchFn = (async (_input: string | URL, init?: RequestInit) => {
    bodies.push(typeof init?.body === "string" ? init.body : "");
    return new Response(JSON.stringify({ id: "sub-chan" }), { status: 200 });
  }) as typeof fetch;
  const context = { ...ctx([]), fetchFn, agent: "claude-code" };
  await handleRpcMessage(
    {
      jsonrpc: "2.0",
      id: 3,
      method: "tools/call",
      params: {
        name: "subscribe_events",
        arguments: { chat_jid: "351930017568@s.whatsapp.net", channel: true },
      },
    },
    context,
  );
  expect(JSON.parse(bodies[0] ?? "{}")).toMatchObject({
    delivery: { mode: "channel", agentName: "claude-code" },
  });
  expect(context.channelSubs?.has("sub-chan")).toBe(true);
});

test(
  "T193 — end-to-end stdio: subscribe_events(channel) starts the SSE pump and forwards the channel frame",
  { timeout: 15000 },
  async () => {
    const { handleStream } = await import("../src/bin.ts");
    const written: string[] = [];
    const lines = new Set<string>();
    const request = (obj: unknown) => lines.add(JSON.stringify(obj));
    const canned = JSON.stringify({
      jsonrpc: "2.0",
      method: "notifications/claude/channel",
      params: {
        content: "wa-mcp: test event",
        meta: { subscription_id: "sub-e2e", chat_id: "c@g.us", agent: "claude-code" },
      },
    });
    const fetchFn = (async (input: string | URL | Request, init?: RequestInit) => {
      void init;
      const target =
        typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (target.endsWith("/api/subs2")) {
        return new Response(JSON.stringify({ id: "sub-e2e", inboxPath: "/tmp/x" }), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      }
      // SSE stream that yields the channel frame once read
      const encoder = new TextEncoder();
      const body = new ReadableStream<Uint8Array>({
        start(controller) {
          controller.enqueue(encoder.encode(`data: ${canned}\n\n`));
        },
      });
      return new Response(body, { status: 200, headers: { "content-type": "text/event-stream" } });
    }) as typeof fetch;
    const context = ctx([], "claude-code");
    context.fetchFn = fetchFn;
    const input = (async function* () {
      yield JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "t", version: "0" },
        },
      });
      yield JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" });
      yield JSON.stringify({
        jsonrpc: "2.0",
        id: 2,
        method: "tools/call",
        params: { name: "subscribe_events", arguments: { chat_jid: "c@g.us", channel: true } },
      });
      // keep the stream alive briefly so the async pump can forward
      await new Promise((resolve) => setTimeout(resolve, 1500));
      void request;
    })();
    const done = handleStream(input, (line) => written.push(line), context);
    await done;
    expect(written.join("\n")).toContain("sub-e2e"); // subscribe echoed
    const frame = written.find((line) => line.includes("notifications/claude/channel"));
    expect(frame).toBeDefined();
    expect(frame).toContain("test event");
  },
);

test("T193 — initialize declares the claude/channel capability and channel instructions (Claude Code registers no listener without it)", async () => {
  const response = (await handleRpcMessage(
    {
      jsonrpc: "2.0",
      id: 9,
      method: "initialize",
      params: {
        protocolVersion: "2025-06-18",
        capabilities: {},
        clientInfo: { name: "t", version: "0" },
      },
    },
    ctx([]),
  )) as { result: { capabilities: Record<string, unknown>; instructions?: unknown } };
  expect(response.result.capabilities.experimental).toEqual({ "claude/channel": {} });
  // permission relay (#236) is not implemented — it must not be declared
  expect(
    (response.result.capabilities.experimental as Record<string, unknown>)[
      "claude/channel/permission"
    ],
  ).toBeUndefined();
  expect(typeof response.result.instructions).toBe("string");
  expect(response.result.instructions).toContain("chat_id");
  expect(response.result.instructions).toContain("send_message");
});
