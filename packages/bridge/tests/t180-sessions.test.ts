import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vite-plus/test";
import { createEventBus } from "../src/events.ts";
import { createHttpServer } from "../src/http.ts";
import type { BridgeHandle } from "../src/lifecycle.ts";
import { listAgentSessions } from "../src/sessions.ts";

function put(path: string, text: string, mtimeSec: number): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, text);
  utimesSync(path, mtimeSec, mtimeSec);
}

function seed(): string {
  const home = mkdtempSync(join(tmpdir(), "t180-sessions-"));
  const projects = join(home, ".claude", "projects");
  put(
    join(projects, "-Users-me-code-wa-mcp", "b41d09a0.jsonl"),
    `${JSON.stringify({ type: "user", cwd: "/Users/me/code/wa-mcp", message: { content: "SECRET PROMPT" } })}\n`,
    1_791_000_300,
  );
  put(
    join(projects, "-Users-me-code-wa-mcp", "older.jsonl"),
    `${JSON.stringify({ type: "summary", summary: "SECRET SUMMARY" })}\n`,
    1_791_000_100,
  );
  put(join(projects, "-Users-me-code-wa-mcp", "b41d09a0", "subagent.jsonl"), "{}\n", 1_791_000_900);
  put(join(projects, "-Users-me-notes", "notes.txt"), "x", 1_791_000_800);
  put(
    join(home, ".codex", "sessions", "2026", "10", "05", "rollout-2026-10-05T04-54-29-01a1.jsonl"),
    `${JSON.stringify({ type: "session_meta", payload: { cwd: "/Users/me/api", instructions: "SECRET" } })}\n`,
    1_791_000_200,
  );
  return home;
}

test("T180 A — claude + codex session files, newest first, metadata only", () => {
  const home = seed();
  try {
    const sessions = listAgentSessions(home);
    expect(sessions.map((s) => s.id)).toEqual([
      "claude:b41d09a0",
      "codex:rollout-2026-10-05T04-54-29-01a1",
      "claude:older",
    ]);
    expect(sessions[0]).toEqual({
      id: "claude:b41d09a0",
      agent: "claude",
      project: "wa-mcp",
      label: "Claude Code · wa-mcp · 2026-10-03 04:05 UTC",
      mtime: new Date(1_791_000_300_000).toISOString(),
      size: expect.any(Number),
    });
    expect(sessions[1]).toMatchObject({ agent: "codex", project: "api" });
    expect(sessions[2]).toMatchObject({ project: "-Users-me-code-wa-mcp" });
    expect(JSON.stringify(sessions)).not.toContain("SECRET");
    expect(listAgentSessions(home, 1)).toHaveLength(1);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("T180 A — no agent dirs → []", () => {
  const home = mkdtempSync(join(tmpdir(), "t180-sessions-"));
  try {
    expect(listAgentSessions(home)).toEqual([]);
  } finally {
    rmSync(home, { recursive: true, force: true });
  }
});

test("T180 A — GET /api/sessions?limit= serves the list; 501 without a home dir", async () => {
  const home = seed();
  const handle = {
    status: "connected",
    events: createEventBus(),
    close: async () => {},
    getLastQr: () => null,
    hasPairedAccount: () => true,
    pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
    connectionQuality: () => ({ reconnects: 0, lastDisconnectAt: null }),
    contactsWarm: () => true,
  } as unknown as BridgeHandle;
  const withHome = await createHttpServer(handle, { token: "tok", homeDir: home });
  const without = await createHttpServer(handle, { token: "tok" });
  try {
    const res = await fetch(`http://127.0.0.1:${withHome.port}/api/sessions?limit=2`, {
      headers: { authorization: "Bearer tok" },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { sessions: Array<{ id: string }>; generatedAt: string };
    expect(body.sessions.map((s) => s.id)).toEqual([
      "claude:b41d09a0",
      "codex:rollout-2026-10-05T04-54-29-01a1",
    ]);
    const missing = await fetch(`http://127.0.0.1:${without.port}/api/sessions`, {
      headers: { authorization: "Bearer tok" },
    });
    expect(missing.status).toBe(501);
  } finally {
    await withHome.close();
    await without.close();
    rmSync(home, { recursive: true, force: true });
  }
});
