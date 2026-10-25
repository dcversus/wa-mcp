import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { PLATFORMS } from "@wa-mcp/shared";
import { writeServerEntry } from "../src/writers.ts";

const homes: string[] = [];
afterEach(() => {
  for (const home of homes.splice(0)) {
    rmSync(home, { recursive: true, force: true });
  }
});

const SPEC = {
  command: "node",
  args: ["/opt/wa-mcp/bin.mjs", "--bridge-url", "http://127.0.0.1:27777", "--token", "tok"],
  env: { WA_TOKEN: "tok" },
};

test.each(PLATFORMS)("T188 P2 — the %s entry names its agent for log attribution", (platform) => {
  const home = mkdtempSync(join(tmpdir(), "t188-agent-arg-"));
  homes.push(home);
  const first = writeServerEntry(platform, { home, spec: SPEC });
  const once = readFileSync(first.path, "utf8");
  const again = writeServerEntry(platform, { home, spec: SPEC });
  expect(first.verified).toBe(true);
  expect(again.verified).toBe(true);
  expect(readFileSync(again.path, "utf8")).toBe(once);
  expect(once).toMatch(new RegExp(`"--agent",\\s*"${platform}"`));
  expect(once.split("--agent").length - 1).toBe(1);
});

test("T188 P2 — a spec that already names an agent is not given a second one", () => {
  const home = mkdtempSync(join(tmpdir(), "t188-agent-arg-"));
  homes.push(home);
  const result = writeServerEntry("grok", {
    home,
    spec: { ...SPEC, args: [...SPEC.args, "--agent", "custom"] },
  });
  const entry = JSON.parse(readFileSync(result.path, "utf8")).mcpServers["wa-mcp"];
  expect(entry.args.slice(-2)).toEqual(["--agent", "custom"]);
  expect(entry.args.filter((arg: string) => arg === "--agent")).toHaveLength(1);
});

test("T188 P2 — wa-mcp messages --agent filters the log like the web UI Agent select", async () => {
  const { runMessages } = await import("../src/messages.ts");
  const urls: string[] = [];
  const exit = await runMessages(
    {
      fetchFn: (async (input: string | URL) => {
        urls.push(String(input));
        return Response.json({ messages: [], chats: [] });
      }) as unknown as typeof fetch,
      print: () => undefined,
      sleep: async () => undefined,
      keepFollowing: () => false,
    },
    { baseUrl: "http://h", token: "t", agent: "codex", follow: false },
  );
  expect(exit).toBe(0);
  const search = urls.find((url) => url.includes("/api/search")) ?? "";
  expect(new URL(search).searchParams.get("agent")).toBe("codex");
});

test("T188 P1 — wa-mcp connections lists installed agents first and flags missing apps", async () => {
  const { runConnections } = await import("../src/connections.ts");
  const printed: string[] = [];
  const row = (agent: string, label: string, installed: boolean | null) => ({
    kind: "mcp",
    agent,
    label,
    enabled: true,
    subId: null,
    subscription: null,
    installed,
  });
  const exit = await runConnections(
    {
      fetchFn: (async () =>
        Response.json({
          connections: [
            row("grok", "Grok", false),
            row("pi", "Pi", null),
            row("codex", "Codex", true),
          ],
        })) as unknown as typeof fetch,
      print: (line) => printed.push(line),
    },
    { baseUrl: "http://h", token: "t", action: "list" },
  );
  expect(exit).toBe(0);
  expect(printed[1]).toMatch(/^Codex\s+mcp\s+enabled\s+—$/);
  expect(printed[2]).toMatch(/^Pi\s+mcp\s+enabled\s+—$/);
  expect(printed[3]).toMatch(/^Grok\s+mcp\s+enabled\s+— · app not installed$/);
});
