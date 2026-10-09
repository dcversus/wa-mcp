import { closeSync, existsSync, openSync, readSync, readdirSync, statSync, watch } from "node:fs";
import type { FSWatcher } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface SpoolEvent {
  ts: string;
  kind: string;
  chat: string;
  from: string;
  text: string;
  media: boolean;
  id?: string;
  chatName?: string | null;
  fromName?: string | null;
  subId?: string;
  prompt?: string;
  session?: string;
}

export interface PiLike {
  on(event: string, handler: (event: unknown, ctx: unknown) => unknown): void;
  sendUserMessage(content: string, options?: { deliverAs?: "steer" | "followUp" }): Promise<void>;
}

export interface SpoolTailerOptions {
  subsDir: string;
  deliver: (text: string) => void;
  onError: (err: unknown) => void;
}

export interface SpoolTailer {
  prime(): void;
  poll(): void;
}

export interface ExtensionOptions {
  env?: Record<string, string | undefined>;
  home?: string;
  intervalMs?: number;
  stderr?: (text: string) => void;
}

const SPOOL = "session.jsonl";
const DEFAULT_INTERVAL_MS = 500;
const DEFAULT_ASK = "your subscription asked you to react";

export function subsDirOf(env: Record<string, string | undefined>, home: string): string {
  const root = env.WA_MCP_HOME;
  return join(root !== undefined && root.length > 0 ? root : join(home, ".wa-mcp"), "subs");
}

function isSpoolEvent(value: unknown): value is SpoolEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.chat === "string" &&
    typeof record.from === "string" &&
    typeof record.text === "string"
  );
}

export function forPi(event: SpoolEvent): boolean {
  const target = event.session;
  return target === undefined || target === "active" || target.startsWith("pi:");
}

function named(name: string | null | undefined, fallback: string): string {
  return typeof name === "string" && name.length > 0 ? name : fallback;
}

export function render(event: SpoolEvent): string {
  const sender = named(event.fromName, event.from);
  const chat = named(event.chatName, event.chat);
  const ids =
    typeof event.id === "string" && event.id.length > 0
      ? `chat_jid ${event.chat}, message_id ${event.id}`
      : `chat_jid ${event.chat}`;
  const body = event.text.length > 0 ? event.text : event.media === true ? "[media]" : "";
  const ask =
    typeof event.prompt === "string" && event.prompt.length > 0
      ? `your subscription asks: ${event.prompt}`
      : DEFAULT_ASK;
  return `[wa-mcp] message from ${sender} in ${chat} (${ids}): ${body} — ${ask}`;
}

function spoolPaths(subsDir: string): string[] {
  if (!existsSync(subsDir)) {
    return [];
  }
  return readdirSync(subsDir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(subsDir, entry.name, SPOOL))
    .filter((path) => existsSync(path));
}

function readFrom(path: string, offset: number, size: number): Buffer {
  const buffer = Buffer.alloc(size - offset);
  const fd = openSync(path, "r");
  try {
    readSync(fd, buffer, 0, buffer.length, offset);
  } finally {
    closeSync(fd);
  }
  return buffer;
}

export function createSpoolTailer(options: SpoolTailerOptions): SpoolTailer {
  const cursors = new Map<string, { ino: number; offset: number }>();

  const drain = (path: string): void => {
    const { ino, size } = statSync(path);
    const cursor = cursors.get(path);
    const offset =
      cursor === undefined || cursor.ino !== ino || size < cursor.offset ? 0 : cursor.offset;
    cursors.set(path, { ino, offset });
    if (size === offset) {
      return;
    }
    const chunk = readFrom(path, offset, size);
    const end = chunk.lastIndexOf(10);
    if (end < 0) {
      return;
    }
    cursors.set(path, { ino, offset: offset + end + 1 });
    for (const line of chunk.subarray(0, end).toString("utf8").split("\n")) {
      if (line.trim().length === 0) {
        continue;
      }
      try {
        const parsed: unknown = JSON.parse(line);
        if (!isSpoolEvent(parsed)) {
          throw new Error(`unrecognised spool line in ${path}`);
        }
        if (forPi(parsed)) {
          options.deliver(render(parsed));
        }
      } catch (err) {
        options.onError(err);
      }
    }
  };

  return {
    prime() {
      try {
        for (const path of spoolPaths(options.subsDir)) {
          const { ino, size } = statSync(path);
          cursors.set(path, { ino, offset: size });
        }
      } catch (err) {
        options.onError(err);
      }
    },
    poll() {
      try {
        for (const path of spoolPaths(options.subsDir)) {
          try {
            drain(path);
          } catch (err) {
            options.onError(err);
          }
        }
      } catch (err) {
        options.onError(err);
      }
    },
  };
}

export function createExtension(options: ExtensionOptions = {}) {
  const env = options.env ?? { WA_MCP_HOME: process.env.WA_MCP_HOME };
  const home = options.home ?? homedir();
  const intervalMs = options.intervalMs ?? DEFAULT_INTERVAL_MS;
  const stderr = options.stderr ?? ((text: string) => void process.stderr.write(text));

  return async function waMcpPiExtension(pi: PiLike): Promise<void> {
    let warned = false;
    let timer: ReturnType<typeof setInterval> | undefined;
    let watchers: FSWatcher[] = [];

    const warn = (err: unknown): void => {
      if (warned) {
        return;
      }
      warned = true;
      const message = err instanceof Error ? err.message : String(err);
      stderr(`[wa-mcp] pi extension: ${message} (further errors suppressed)\n`);
    };

    const stop = (): void => {
      if (timer !== undefined) {
        clearInterval(timer);
        timer = undefined;
      }
      for (const watcher of watchers) {
        watcher.close();
      }
      watchers = [];
    };

    const watchDir = (dir: string, tailer: SpoolTailer): void => {
      try {
        const watcher = watch(dir, () => tailer.poll());
        watcher.on("error", () => watcher.close());
        watcher.unref();
        watchers.push(watcher);
      } catch {
        return;
      }
    };

    const start = (): void => {
      stop();
      const subsDir = subsDirOf(env, home);
      const tailer = createSpoolTailer({
        subsDir,
        deliver: (text) => {
          pi.sendUserMessage(text, { deliverAs: "followUp" }).catch(warn);
        },
        onError: warn,
      });
      tailer.prime();
      if (existsSync(subsDir)) {
        watchDir(subsDir, tailer);
        for (const entry of readdirSync(subsDir, { withFileTypes: true })) {
          if (entry.isDirectory()) {
            watchDir(join(subsDir, entry.name), tailer);
          }
        }
      }
      timer = setInterval(() => tailer.poll(), intervalMs);
      timer.unref();
    };

    pi.on("session_start", () => {
      try {
        start();
      } catch (err) {
        warn(err);
      }
    });
    pi.on("session_shutdown", () => {
      stop();
    });
  };
}

export default createExtension();
