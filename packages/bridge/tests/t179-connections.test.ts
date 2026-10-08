import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vite-plus/test";
import { createEventBus } from "../src/events.ts";
import { createHttpServer, type BridgeHttp } from "../src/http.ts";
import type { BridgeHandle } from "../src/lifecycle.ts";
import { openStore } from "../src/store/schema.ts";
import { createSubscriptionConfig } from "../src/store/subscription-configs.ts";
import { disconnectAgent, listConnections } from "../src/connections.ts";

const TOKEN = "t179-token";

function stubHandle(): BridgeHandle {
  return {
    status: "connected",
    events: createEventBus(),
    close: async () => {},
    getLastQr: () => null,
    hasPairedAccount: () => true,
    pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
    resumePairing: () => {},
    connectionQuality: () => ({ reconnects: 0, lastDisconnectAt: null }),
    logout: async () => {},
    fetchHistory: async () => ({ requested: false, request_id: "" }),
    contactsWarm: () => true,
  } as unknown as BridgeHandle;
}

function put(home: string, rel: string, text: string): string {
  const path = join(home, rel);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  return path;
}

function drain(inbox: string, async?: boolean) {
  return {
    matcher: inbox,
    hooks: [
      {
        type: "command",
        command: `wa-mcp inbox drain --inbox ${inbox}`,
        ...(async === true ? { async: true } : {}),
      },
    ],
  };
}

const FOREIGN_HOOK = { matcher: "Bash", hooks: [{ type: "command", command: "echo foreign" }] };

function seedHome(): { home: string; claudeInbox: string; codexInbox: string } {
  const home = mkdtempSync(join(tmpdir(), "t179-home-"));
  const claudeInbox = join(home, ".wa-mcp", "subs", "sub-claude", "inbox.jsonl");
  const codexInbox = join(home, ".wa-mcp", "subs", "sub-codex", "inbox.jsonl");
  put(
    home,
    ".claude/settings.json",
    `${JSON.stringify(
      {
        model: "opus",
        hooks: { FileChanged: [drain(claudeInbox, true)], PreToolUse: [FOREIGN_HOOK] },
      },
      null,
      2,
    )}\n`,
  );
  put(
    home,
    ".codex/hooks.json",
    `${JSON.stringify({ hooks: { FileChanged: [drain(codexInbox)] } }, null, 2)}\n`,
  );
  put(
    home,
    ".claude.json",
    `${JSON.stringify(
      {
        numStartups: 7,
        mcpServers: {
          "wa-mcp": {
            type: "stdio",
            command: "/usr/local/bin/wa-mcp-server",
            args: ["--bridge", "http://127.0.0.1:8080", "--token", "SECRET-ARG"],
            env: { WA_TOKEN: "SECRET-ENV" },
          },
          other: { command: "other-server", args: [] },
        },
      },
      null,
      2,
    )}\n`,
  );
  put(
    home,
    ".cursor/mcp.json",
    `${JSON.stringify({ mcpServers: { "wa-mcp": { command: "wa-mcp-server", args: [], disabled: true } } })}\n`,
  );
  put(
    home,
    ".codex/config.toml",
    'model = "o4"\n\n[mcp_servers.wa-mcp]\ncommand = "wa-mcp-server"\nargs = ["--token=SECRET-TOML"]\n\n[mcp_servers.wa-mcp.env]\nWA_TOKEN = "SECRET-TOML-ENV"\n\n[mcp_servers.other]\ncommand = "other"\n',
  );
  put(
    home,
    ".hermes/config.yaml",
    'theme: dark\nmcp_servers:\n  wa-mcp:\n    command: wa-mcp-server\n    args: ["--x"]\n    env:\n      WA_TOKEN: "SECRET-YAML"\n  other:\n    command: other\n',
  );
  return { home, claudeInbox, codexInbox };
}

test("T179 A — hook entries in claude settings + codex hooks.json become hook connections with subId", () => {
  const { home, claudeInbox, codexInbox } = seedHome();
  try {
    const hooks = listConnections(home).filter((c) => c.kind === "hooks");
    expect(hooks).toEqual([
      expect.objectContaining({
        kind: "hooks",
        agent: "claude",
        label: "Claude Code",
        configPath: join(home, ".claude", "settings.json"),
        subId: "sub-claude",
        inboxPath: claudeInbox,
        enabled: true,
      }),
      expect.objectContaining({
        kind: "hooks",
        agent: "codex",
        label: "Codex",
        configPath: join(home, ".codex", "hooks.json"),
        subId: "sub-codex",
        inboxPath: codexInbox,
        enabled: true,
      }),
    ]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("T179 A — disableAllHooks marks claude hook connections disabled", () => {
  const home = mkdtempSync(join(tmpdir(), "t179-home-"));
  try {
    put(
      home,
      ".claude/settings.json",
      JSON.stringify({
        disableAllHooks: true,
        hooks: { FileChanged: [drain("/x/subs/s1/inbox.jsonl")] },
      }),
    );
    expect(listConnections(home)).toEqual([
      expect.objectContaining({ kind: "hooks", agent: "claude", enabled: false, subId: "s1" }),
    ]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("T179 A — MCP registrations across json/toml/yaml surfaces, disabled flag honoured", () => {
  const { home } = seedHome();
  try {
    const mcp = listConnections(home).filter((c) => c.kind === "mcp");
    expect(mcp.map((c) => [c.agent, c.enabled])).toEqual([
      ["claude-code", true],
      ["cursor", false],
      ["codex", true],
      ["hermes", true],
    ]);
    expect(mcp[0]).toMatchObject({
      label: "Claude Code",
      configPath: join(home, ".claude.json"),
      subId: null,
      inboxPath: null,
    });
    expect(mcp[0]?.detail).toContain("/usr/local/bin/wa-mcp-server");
    expect(mcp[2]?.detail).toContain("wa-mcp-server");
    expect(mcp[3]?.detail).toContain("wa-mcp-server");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("T179 A — no secrets leak: token args and env values are redacted", () => {
  const { home } = seedHome();
  try {
    const text = JSON.stringify(listConnections(home));
    for (const secret of ["SECRET-ARG", "SECRET-ENV", "SECRET-TOML", "SECRET-YAML"]) {
      expect(text).not.toContain(secret);
    }
    const claude = listConnections(home).find((c) => c.kind === "mcp" && c.agent === "claude-code");
    expect(claude?.detail).toContain("--token [redacted]");
    expect(claude?.detail).toContain("WA_TOKEN");
    const codex = listConnections(home).find((c) => c.kind === "mcp" && c.agent === "codex");
    expect(codex?.detail).toContain("--token=[redacted]");
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("T179 A — missing or malformed files → empty list, no throw", () => {
  const home = mkdtempSync(join(tmpdir(), "t179-empty-"));
  try {
    expect(listConnections(home)).toEqual([]);
    put(home, ".claude/settings.json", "{not json");
    put(home, ".claude.json", "[]");
    put(home, ".cursor/mcp.json", JSON.stringify({ mcpServers: { other: { command: "x" } } }));
    expect(listConnections(home)).toEqual([]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("T179 B — disconnect hooks/claude removes only wa-mcp entries; foreign entries intact; idempotent", () => {
  const { home } = seedHome();
  try {
    const path = join(home, ".claude", "settings.json");
    expect(disconnectAgent(home, "hooks", "claude")).toEqual({ status: "removed", removed: 1 });
    const after = JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>;
    expect(after).toEqual({ model: "opus", hooks: { PreToolUse: [FOREIGN_HOOK] } });
    expect(readdirSync(dirname(path)).some((name) => name.startsWith("settings.json.bak-"))).toBe(
      true,
    );
    expect(disconnectAgent(home, "hooks", "claude")).toEqual({
      status: "not-connected",
      removed: 0,
    });
    expect(listConnections(home).some((c) => c.kind === "hooks" && c.agent === "claude")).toBe(
      false,
    );
    expect(listConnections(home).some((c) => c.kind === "hooks" && c.agent === "codex")).toBe(true);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("T179 B — disconnect hooks with a subId removes only that subscription's hook", () => {
  const home = mkdtempSync(join(tmpdir(), "t179-home-"));
  try {
    const a = "/d/subs/a/inbox.jsonl";
    const b = "/d/subs/b/inbox.jsonl";
    const path = put(
      home,
      ".claude/settings.json",
      JSON.stringify({ hooks: { FileChanged: [drain(a), drain(b)] } }),
    );
    expect(disconnectAgent(home, "hooks", "claude", "a")).toEqual({
      status: "removed",
      removed: 1,
    });
    expect(JSON.parse(readFileSync(path, "utf8"))).toEqual({ hooks: { FileChanged: [drain(b)] } });
    expect(disconnectAgent(home, "hooks", "claude", "a")).toEqual({
      status: "not-connected",
      removed: 0,
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("T179 B — disconnect mcp/<host> removes only the wa-mcp server key (json/toml/yaml)", () => {
  const { home } = seedHome();
  try {
    expect(disconnectAgent(home, "mcp", "claude-code")).toEqual({ status: "removed", removed: 1 });
    expect(JSON.parse(readFileSync(join(home, ".claude.json"), "utf8"))).toEqual({
      numStartups: 7,
      mcpServers: { other: { command: "other-server", args: [] } },
    });
    expect(disconnectAgent(home, "mcp", "codex")).toEqual({ status: "removed", removed: 1 });
    expect(readFileSync(join(home, ".codex", "config.toml"), "utf8")).toBe(
      'model = "o4"\n\n[mcp_servers.other]\ncommand = "other"\n',
    );
    expect(disconnectAgent(home, "mcp", "hermes")).toEqual({ status: "removed", removed: 1 });
    expect(readFileSync(join(home, ".hermes", "config.yaml"), "utf8")).toBe(
      "theme: dark\nmcp_servers:\n  other:\n    command: other\n",
    );
    expect(disconnectAgent(home, "mcp", "codex")).toEqual({ status: "not-connected", removed: 0 });
    expect(disconnectAgent(home, "mcp", "grok")).toEqual({ status: "not-connected", removed: 0 });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("T179 B — unknown kind/agent → unknown", () => {
  const { home } = seedHome();
  try {
    expect(disconnectAgent(home, "hooks", "cursor")).toEqual({ status: "unknown", removed: 0 });
    expect(disconnectAgent(home, "mcp", "nope")).toEqual({ status: "unknown", removed: 0 });
    expect(disconnectAgent(home, "other", "claude")).toEqual({ status: "unknown", removed: 0 });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

async function withBridge(
  home: string | undefined,
  run: (bridge: BridgeHttp, store: ReturnType<typeof openStore>) => Promise<void>,
): Promise<void> {
  const dataDir = mkdtempSync(join(tmpdir(), "t179-data-"));
  const store = openStore(dataDir);
  const bridge = await createHttpServer(stubHandle(), {
    token: TOKEN,
    store,
    ...(home !== undefined ? { homeDir: home } : {}),
  });
  try {
    await run(bridge, store);
  } finally {
    await bridge.close();
    store.close();
    rmSync(dataDir, { recursive: true, force: true });
  }
}

function call(bridge: BridgeHttp, path: string, method = "GET"): Promise<Response> {
  return fetch(`http://127.0.0.1:${bridge.port}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}` },
  });
}

test("T179 A — GET /api/connections returns connections + generatedAt, links subscription names", async () => {
  const { home } = seedHome();
  try {
    await withBridge(home, async (bridge, store) => {
      const sub = createSubscriptionConfig(store, {
        name: "Family alerts",
        chats: [],
        filter: {},
        delivery: { mode: "inbox" },
        enabled: true,
      });
      const settings = join(home, ".claude", "settings.json");
      const inbox = join(home, ".wa-mcp", "subs", sub.id, "inbox.jsonl");
      writeFileSync(settings, JSON.stringify({ hooks: { FileChanged: [drain(inbox)] } }));
      const res = await call(bridge, "/api/connections");
      expect(res.status).toBe(200);
      const body = (await res.json()) as {
        connections: Array<Record<string, unknown>>;
        generatedAt: string;
      };
      expect(Number.isNaN(Date.parse(body.generatedAt))).toBe(false);
      expect(body.connections[0]).toMatchObject({
        kind: "hooks",
        agent: "claude",
        subId: sub.id,
        subscription: { id: sub.id, name: "Family alerts" },
      });
      expect(body.connections.find((c) => c.agent === "codex" && c.kind === "hooks")).toMatchObject(
        {
          subscription: null,
        },
      );
      expect(JSON.stringify(body)).not.toContain("SECRET");
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("T179 B — DELETE /api/connections/:kind/:agent → 200 then 404; unknown agent → 404", async () => {
  const { home } = seedHome();
  try {
    await withBridge(home, async (bridge) => {
      const first = await call(bridge, "/api/connections/mcp/cursor", "DELETE");
      expect(first.status).toBe(200);
      expect(await first.json()).toEqual({ ok: true, removed: 1 });
      const again = await call(bridge, "/api/connections/mcp/cursor", "DELETE");
      expect(again.status).toBe(404);
      expect(await again.json()).toMatchObject({ ok: false, error: { code: "NOT_FOUND" } });
      const unknown = await call(bridge, "/api/connections/mcp/nope", "DELETE");
      expect(unknown.status).toBe(404);
      const scoped = await call(bridge, "/api/connections/hooks/codex?sub=sub-codex", "DELETE");
      expect(scoped.status).toBe(200);
      expect(existsSync(join(home, ".cursor", "mcp.json"))).toBe(true);
    });
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("T179 A — without a home dir the endpoint is 501", async () => {
  await withBridge(undefined, async (bridge) => {
    expect((await call(bridge, "/api/connections")).status).toBe(501);
  });
});
