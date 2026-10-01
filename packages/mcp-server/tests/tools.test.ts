import { expect, test } from "vite-plus/test";
import { TOOLS, toolByName, type ToolContext } from "../src/tools.ts";

const ctx: ToolContext = { bridgeUrl: "http://bridge.test:8080", token: "tok" };

interface RecordedCall {
  url: string;
  method?: string;
  body?: string;
  headers?: Record<string, string>;
}

function mockFetch(routes: Record<string, unknown>): {
  fetchFn: typeof fetch;
  calls: Array<RecordedCall>;
} {
  const calls: Array<RecordedCall> = [];
  const fetchFn = (async (url: string | URL, init?: RequestInit) => {
    const key = String(url).replace("http://bridge.test:8080", "");
    calls.push({
      url: String(url),
      method: init?.method,
      body: typeof init?.body === "string" ? init.body : undefined,
      headers: init?.headers as Record<string, string> | undefined,
    });
    const payload = routes[key] ?? {};
    return new Response(JSON.stringify(payload), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  }) as unknown as typeof fetch;
  return { fetchFn, calls };
}

test("the registry exposes the four launch tools", () => {
  expect(TOOLS.map((tool) => tool.name)).toEqual([
    "send_message",
    "list_chats",
    "list_messages",
    "search_messages",
  ]);
  expect(toolByName("send_message")?.name).toBe("send_message");
  expect(toolByName("nope")).toBeUndefined();
});

test("send_message posts to the bridge with the bearer token", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/send": { message_id: "M9" } });
  const tool = toolByName("send_message");
  if (!tool) throw new Error("send_message missing");
  const result = await tool.handler(
    { ...ctx, fetchFn },
    { chat_jid: "358497773518", text: "hello" },
  );
  expect(calls[0]?.url).toBe("http://bridge.test:8080/api/send");
  expect(calls[0]?.method).toBe("POST");
  const headers = calls[0]?.headers ?? {};
  expect(headers.authorization).toBe("Bearer tok");
  expect(JSON.parse(calls[0]?.body ?? "{}")).toEqual({
    chat_jid: "358497773518",
    text: "hello",
  });
  expect(result.content[0]?.text).toContain("M9");
});

test("list_chats fetches the chat list and returns json text", async () => {
  const { fetchFn, calls } = mockFetch({ "/api/chats?limit=50": { chats: [{ jid: "a@g.us" }] } });
  const tool = toolByName("list_chats");
  if (!tool) throw new Error("list_chats missing");
  const result = await tool.handler({ ...ctx, fetchFn }, { limit: 50 });
  expect(calls[0]?.url).toBe("http://bridge.test:8080/api/chats?limit=50");
  expect(calls[0]?.method).toBe("GET");
  expect(JSON.parse(result.content[0]?.text ?? "{}")).toEqual({ chats: [{ jid: "a@g.us" }] });
});

test("list_messages and search_messages pass their filters through", async () => {
  const { fetchFn, calls } = mockFetch({
    "/api/messages?chat_jid=g%40us&limit=10": { messages: [] },
    "/api/search?q=pizza&limit=25": { messages: [] },
  });
  const toolCtx = { ...ctx, fetchFn };
  const list = toolByName("list_messages");
  if (!list) throw new Error("list_messages missing");
  await list.handler(toolCtx, { chat_jid: "g@us", limit: 10 });
  const search = toolByName("search_messages");
  if (!search) throw new Error("search_messages missing");
  await search.handler(toolCtx, { q: "pizza", limit: 25 });
  expect(calls.map((call) => call.url.replace("http://bridge.test:8080", ""))).toEqual([
    "/api/messages?chat_jid=g%40us&limit=10",
    "/api/search?q=pizza&limit=25",
  ]);
});
