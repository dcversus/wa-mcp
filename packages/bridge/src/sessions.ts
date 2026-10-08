import { closeSync, openSync, readSync, readdirSync, statSync } from "node:fs";
import { basename, join } from "node:path";

export type SessionAgent = "claude" | "codex";

export interface AgentSession {
  id: string;
  agent: SessionAgent;
  project: string;
  label: string;
  mtime: string;
  size: number;
}

const AGENT_LABELS: Record<SessionAgent, string> = { claude: "Claude Code", codex: "Codex" };
const HEAD_BYTES = 8192;
const MAX_DEPTH = 4;

function entries(dir: string): Array<{ name: string; dir: boolean }> {
  try {
    return readdirSync(dir, { withFileTypes: true }).map((entry) => ({
      name: entry.name,
      dir: entry.isDirectory(),
    }));
  } catch {
    return [];
  }
}

function headCwd(path: string): string | null {
  let fd: number | null = null;
  try {
    fd = openSync(path, "r");
    const buffer = Buffer.alloc(HEAD_BYTES);
    const read = readSync(fd, buffer, 0, HEAD_BYTES, 0);
    const match = buffer
      .subarray(0, read)
      .toString("utf8")
      .match(/"cwd"\s*:\s*"((?:[^"\\]|\\.)*)"/);
    return match?.[1] === undefined ? null : (JSON.parse(`"${match[1]}"`) as string);
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      closeSync(fd);
    }
  }
}

function session(agent: SessionAgent, path: string, fallbackProject: string): AgentSession | null {
  try {
    const stats = statSync(path);
    const cwd = headCwd(path);
    const project = cwd === null ? fallbackProject : basename(cwd);
    const mtime = stats.mtime.toISOString();
    return {
      id: `${agent}:${basename(path, ".jsonl")}`,
      agent,
      project,
      label: `${AGENT_LABELS[agent]} · ${project} · ${mtime.slice(0, 16).replace("T", " ")} UTC`,
      mtime,
      size: stats.size,
    };
  } catch {
    return null;
  }
}

function claudeSessions(home: string): AgentSession[] {
  const root = join(home, ".claude", "projects");
  return entries(root)
    .filter((entry) => entry.dir)
    .flatMap((project) =>
      entries(join(root, project.name))
        .filter((file) => !file.dir && file.name.endsWith(".jsonl"))
        .map((file) => session("claude", join(root, project.name, file.name), project.name)),
    )
    .filter((item): item is AgentSession => item !== null);
}

function codexFiles(dir: string, depth: number): string[] {
  return entries(dir).flatMap((entry) => {
    const path = join(dir, entry.name);
    if (entry.dir) {
      return depth < MAX_DEPTH ? codexFiles(path, depth + 1) : [];
    }
    return entry.name.endsWith(".jsonl") ? [path] : [];
  });
}

function codexSessions(home: string): AgentSession[] {
  return codexFiles(join(home, ".codex", "sessions"), 0)
    .map((path) => session("codex", path, "codex"))
    .filter((item): item is AgentSession => item !== null);
}

export function listAgentSessions(home: string, limit = 30): AgentSession[] {
  return [...claudeSessions(home), ...codexSessions(home)]
    .sort((a, b) => b.mtime.localeCompare(a.mtime))
    .slice(0, limit);
}
