import { expect, test } from "vite-plus/test";
import { handleRpcMessage, shouldForward, type ServerContext } from "../src/server.ts";

const ctx: ServerContext = {
  tools: [],
  bridgeUrl: "http://127.0.0.1:8080",
  token: "test",
};

async function init(session?: ServerContext["session"]): Promise<Record<string, unknown>> {
  const res = await handleRpcMessage(
    { jsonrpc: "2.0", id: 1, method: "initialize", params: {} },
    { ...ctx, session },
  );
  return (res as { result: Record<string, unknown> }).result;
}

test("initialize advertises resources.subscribe === true", async () => {
  const result = await init();
  const capabilities = result.capabilities as {
    resources: { subscribe: boolean; listChanged: boolean };
  };
  expect(capabilities.resources.subscribe).toBe(true);
  expect(capabilities.resources.listChanged).toBe(true);
});

test("resources/subscribe adds to session; unknown uri → -32602", async () => {
  const session = { subscriptions: new Set<string>() };
  const ok = await handleRpcMessage(
    { jsonrpc: "2.0", id: 2, method: "resources/subscribe", params: { uri: "wa://unread" } },
    { ...ctx, session },
  );
  expect((ok as { result: unknown }).result).toEqual({});
  expect(session.subscriptions.has("wa://unread")).toBe(true);
  const bad = await handleRpcMessage(
    { jsonrpc: "2.0", id: 3, method: "resources/subscribe", params: { uri: "wa://nope" } },
    { ...ctx, session },
  );
  const err = (bad as { error?: { code?: number } }).error;
  expect(err?.code).toBe(-32602);
});

test("resources/unsubscribe removes; idempotent", async () => {
  const session = { subscriptions: new Set<string>(["wa://unread"]) };
  const first = await handleRpcMessage(
    { jsonrpc: "2.0", id: 4, method: "resources/unsubscribe", params: { uri: "wa://unread" } },
    { ...ctx, session },
  );
  expect((first as { result: unknown }).result).toEqual({});
  expect(session.subscriptions.has("wa://unread")).toBe(false);
  const again = await handleRpcMessage(
    { jsonrpc: "2.0", id: 5, method: "resources/unsubscribe", params: { uri: "wa://unread" } },
    { ...ctx, session },
  );
  expect((again as { result: unknown }).result).toEqual({});
});

test("shouldForward passes resources/updated only for subscribed uris; always passes notifications/message and tools/list_changed", () => {
  const session = { subscriptions: new Set<string>(["wa://unread"]) };
  const updated = {
    jsonrpc: "2.0" as const,
    method: "notifications/resources/updated",
    params: { uri: "wa://unread" },
  };
  const other = {
    jsonrpc: "2.0" as const,
    method: "notifications/resources/updated",
    params: { uri: "wa://chats" },
  };
  const message = { jsonrpc: "2.0" as const, method: "notifications/message", params: {} };
  const toolsChanged = {
    jsonrpc: "2.0" as const,
    method: "notifications/tools/list_changed",
    params: {},
  };
  expect(shouldForward(session, updated)).toBe(true);
  expect(shouldForward(session, other)).toBe(false);
  expect(shouldForward(session, message)).toBe(true);
  expect(shouldForward(session, toolsChanged)).toBe(true);
  expect(shouldForward({ subscriptions: new Set() }, updated)).toBe(false);
});
