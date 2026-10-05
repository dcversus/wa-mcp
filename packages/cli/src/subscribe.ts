import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface SubscribeDeps {
  fetchFn: typeof fetch;
  print: (line: string) => void;
}

export interface SubscribeArgs {
  baseUrl: string;
  token: string;
  chat: string | undefined;
  all: boolean;
  kind: string | undefined;
}

export async function runSubscribe(deps: SubscribeDeps, args: SubscribeArgs): Promise<number> {
  if (args.all && args.chat !== undefined) {
    deps.print("subscribe: --all and --chat are mutually exclusive");
    return 1;
  }
  if (!args.all && args.chat === undefined) {
    deps.print("subscribe: --chat <jid> or --all is required");
    return 1;
  }
  const body: Record<string, unknown> = {};
  if (args.chat !== undefined) {
    body.chat_jid = args.chat;
  }
  if (args.all) {
    body.all_chats = true;
  }
  if (args.kind !== undefined) {
    body.kinds = args.kind
      .split(",")
      .map((k) => k.trim())
      .filter((k) => k.length > 0);
  }
  const res = await deps.fetchFn(`${args.baseUrl}/api/subscriptions`, {
    method: "POST",
    headers: { authorization: `Bearer ${args.token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    deps.print(`subscribe failed: HTTP ${res.status}`);
    return 1;
  }
  const payload = (await res.json()) as { id: string; inboxPath: string };
  deps.print(`subscription: ${payload.id}`);
  deps.print(`inbox: ${payload.inboxPath}`);
  return 0;
}

export async function runUnsubscribe(
  deps: SubscribeDeps,
  args: { baseUrl: string; token: string; id: string },
): Promise<number> {
  const res = await deps.fetchFn(
    `${args.baseUrl}/api/subscriptions/${encodeURIComponent(args.id)}`,
    {
      method: "DELETE",
      headers: { authorization: `Bearer ${args.token}` },
    },
  );
  if (res.status === 404) {
    deps.print(`unsubscribe: no subscription ${args.id}`);
    return 1;
  }
  if (!res.ok && res.status !== 204) {
    deps.print(`unsubscribe failed: HTTP ${res.status}`);
    return 1;
  }
  deps.print(`removed: ${args.id}`);
  return 0;
}

export interface DrainResult {
  exit: number;
  summary: string;
}

export function drainInbox(inboxPath: string, statePath: string): DrainResult {
  const cursor = existsSync(statePath) ? Number(readFileSync(statePath, "utf8")) : 0;
  if (!existsSync(inboxPath)) {
    return { exit: 0, summary: "inbox: no file" };
  }
  const size = statSync(inboxPath).size;
  let start = cursor;
  if (size < cursor) {
    start = 0;
  }
  const content = readFileSync(inboxPath, "utf8");
  const lines = content.split("\n").filter((line) => line.length > 0);
  let byteOffset = 0;
  const newLines: Array<{ chat: string; text: string }> = [];
  for (const line of lines) {
    const lineStart = byteOffset;
    byteOffset += line.length + 1;
    if (lineStart < start) {
      continue;
    }
    try {
      const parsed = JSON.parse(line) as { chat: string; text: string };
      newLines.push({ chat: parsed.chat, text: parsed.text });
    } catch {
      break;
    }
  }
  if (newLines.length === 0) {
    return { exit: 0, summary: "inbox: 0 new" };
  }
  const first = newLines[0] as { chat: string; text: string };
  const snippet = first.text.slice(0, 60);
  const dir = dirname(statePath);
  if (!existsSync(dir)) {
    return { exit: 0, summary: "inbox: state dir missing" };
  }
  writeFileSync(statePath, String(Math.min(byteOffset, size)));
  return { exit: 2, summary: `${newLines.length} new: ${first.chat}: ${snippet}` };
}
