import { expect, test } from "vite-plus/test";
import { handleStream, parseMcpConfig } from "../src/bin.ts";
import { TOOLS } from "../src/tools.ts";

const ctx = { tools: TOOLS, bridgeUrl: "http://127.0.0.1:8080", token: "secret" };

test("handleStream writes one response line per request and consumes notifications", async () => {
  const lines = [
    JSON.stringify({ jsonrpc: "2.0", id: 1, method: "ping" }),
    JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }),
    JSON.stringify({ jsonrpc: "2.0", id: "two", method: "tools/list" }),
    "not json at all",
  ];
  const written: string[] = [];
  await handleStream(lines, (line) => written.push(line), ctx);
  expect(written).toHaveLength(3);
  const first = JSON.parse(written[0] ?? "{}") as { id: unknown; result: unknown };
  expect(first.id).toBe(1);
  expect(first.result).toEqual({});
  const second = JSON.parse(written[1] ?? "{}") as { id: unknown };
  expect(second.id).toBe("two");
  const parseError = JSON.parse(written[2] ?? "{}") as { error?: { code?: number } };
  expect(parseError.error?.code).toBe(-32700);
});

test("parseMcpConfig prefers flags over env and applies defaults", () => {
  expect(parseMcpConfig([], {})).toEqual({ bridgeUrl: "http://127.0.0.1:8080", token: undefined });
  expect(parseMcpConfig([], { WA_BRIDGE_URL: "http://env:1", WA_TOKEN: "envtok" })).toEqual({
    bridgeUrl: "http://env:1",
    token: "envtok",
  });
  expect(
    parseMcpConfig(["--bridge-url", "http://flag:2", "--token", "flagtok"], {
      WA_BRIDGE_URL: "http://env:1",
      WA_TOKEN: "envtok",
    }),
  ).toEqual({ bridgeUrl: "http://flag:2", token: "flagtok" });
});
