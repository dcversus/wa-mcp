import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { spawn } from "node:child_process";
import { ALL_CHATS, type SubscriptionConfig } from "@wa-mcp/shared";
import { openInbox, type InboxEvent, type InboxWriter } from "./inbox.ts";
import type { Store } from "./store/schema.ts";
import { recordAgentActivity } from "./store/agent-activity.ts";
import { listSubscriptionConfigs } from "./store/subscription-configs.ts";
import { subscriptionDir } from "./subscriptions.ts";

export interface InboundMessage {
  chatJid: string;
  rawChatJid: string;
  fromJid: string;
  chatName: string | null;
  fromName: string | null;
  id?: string;
  text: string;
  media: boolean;
  mentionedJids: string[];
  backlogTsMs: number | null;
}

export interface SubsDispatcherDeps {
  store: Store;
  subscriptionsDir: string;
  ownJids: () => string[];
  spawnFn: typeof spawn;
  now?: () => Date;
  logger?: { error(obj: unknown, msg?: string): void; warn(obj: unknown, msg?: string): void };
}

export interface SubsDispatcher {
  dispatch(message: InboundMessage): number;
  deliver(config: SubscriptionConfig, event: InboxEvent): void;
  prepare(config: SubscriptionConfig): string | null;
  invalidate(): void;
  evict(id: string): void;
  dropped(): number;
}

export const SESSION_SPOOL = "session";
export const ACTIVE_SESSION = "active";

export function likeToRegExp(pattern: string): RegExp {
  const wildcard = /(?<!\\)[%_]/.test(pattern);
  const source = wildcard ? pattern : `%${pattern}%`;
  let body = "";
  for (let index = 0; index < source.length; index += 1) {
    const char = source[index] as string;
    if (char === "\\" && index + 1 < source.length) {
      index += 1;
      body += (source[index] as string).replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
    } else if (char === "%") {
      body += "[\\s\\S]*";
    } else if (char === "_") {
      body += "[\\s\\S]";
    } else {
      body += char.replace(/[.*+?^${}()|[\]\\/-]/g, "\\$&");
    }
  }
  return new RegExp(`^${body}$`, "iu");
}

function bareJid(jid: string): string {
  return jid.replace(/:\d+@/, "@");
}

export function extractMentions(content: unknown): string[] {
  if (content === null || typeof content !== "object") {
    return [];
  }
  return Object.values(content as Record<string, unknown>).flatMap((value) => {
    const mentioned = (value as { contextInfo?: { mentionedJid?: unknown } } | null)?.contextInfo
      ?.mentionedJid;
    return Array.isArray(mentioned)
      ? mentioned.filter((jid): jid is string => typeof jid === "string")
      : [];
  });
}

export function matchesConfig(
  config: SubscriptionConfig,
  message: InboundMessage,
  ownJids: string[],
): boolean {
  if (!config.enabled) {
    return false;
  }
  if (
    !config.chats.includes(ALL_CHATS) &&
    !config.chats.includes(message.chatJid) &&
    !config.chats.includes(message.rawChatJid)
  ) {
    return false;
  }
  if (message.backlogTsMs !== null && message.backlogTsMs < Date.parse(config.created)) {
    return false;
  }
  const like = config.filter.like;
  if (like !== undefined && like.length > 0 && !likeToRegExp(like).test(message.text)) {
    return false;
  }
  if (config.filter.mentionOnly === true) {
    const own = new Set(ownJids.map(bareJid));
    return message.mentionedJids.some((jid) => own.has(bareJid(jid)));
  }
  return true;
}

export function subscriptionEvent(
  config: SubscriptionConfig,
  message: InboundMessage,
  ts: string,
): InboxEvent {
  return {
    ts,
    kind: "message",
    chat: message.chatJid,
    chatName: message.chatName,
    from: message.fromJid,
    fromName: message.fromName,
    fromMe: false,
    id: message.id,
    text: message.text,
    media: message.media,
    subId: config.id,
    ...(config.prompt !== undefined && config.prompt.length > 0 ? { prompt: config.prompt } : {}),
    ...(config.delivery.mode === "session"
      ? { session: config.delivery.session ?? ACTIVE_SESSION }
      : {}),
  };
}

export function createSubsDispatcher(deps: SubsDispatcherDeps): SubsDispatcher {
  const now = deps.now ?? (() => new Date());
  const writers = new Map<string, InboxWriter>();
  let cache: SubscriptionConfig[] | null = null;

  const writer = (id: string, name: string): InboxWriter => {
    const key = `${id}/${name}`;
    const existing = writers.get(key);
    if (existing !== undefined) {
      return existing;
    }
    const dir = subscriptionDir(deps.subscriptionsDir, id);
    mkdirSync(dir, { recursive: true, mode: 0o700 });
    const fresh = openInbox(dir, undefined, name);
    writers.set(key, fresh);
    return fresh;
  };

  const spawnAgent = (config: SubscriptionConfig, event: InboxEvent): void => {
    const agent = config.delivery.agent;
    if (agent === undefined) {
      return;
    }
    const fail = (err: unknown): void =>
      deps.logger?.error(
        { subId: config.id, command: agent.command, err: String(err) },
        "subscription spawn failed",
      );
    try {
      const child = deps.spawnFn(agent.command, agent.args ?? [], {
        detached: true,
        stdio: "ignore",
        env: {
          ...process.env,
          ...agent.env,
          WAMCP_EVENT: JSON.stringify(event),
          WAMCP_SUB: config.id,
          WAMCP_PROMPT: config.prompt ?? "",
        },
      });
      child.on("error", fail);
      child.on("exit", (code) => {
        if (code !== 0 && code !== null) {
          deps.logger?.warn(
            { subId: config.id, command: agent.command, code },
            "subscription agent exited non-zero",
          );
        }
      });
      child.unref();
    } catch (err) {
      fail(err);
    }
  };

  const deliver = (config: SubscriptionConfig, event: InboxEvent): void => {
    if (config.delivery.mode === "spawn") {
      spawnAgent(config, event);
      return;
    }
    writer(config.id, config.delivery.mode === "session" ? SESSION_SPOOL : "inbox").append(event);
  };

  return {
    dispatch(message) {
      cache ??= listSubscriptionConfigs(deps.store);
      const ownJids = deps.ownJids();
      const ts = now().toISOString();
      let delivered = 0;
      for (const config of cache) {
        if (matchesConfig(config, message, ownJids)) {
          deliver(config, subscriptionEvent(config, message, ts));
          delivered += 1;
          if (message.id !== undefined) {
            recordAgentActivity(deps.store, {
              kind: "delivery",
              source: null,
              subId: config.id,
              chatJid: message.chatJid,
              messageId: message.id,
              ts,
            });
          }
        }
      }
      return delivered;
    },
    deliver,
    prepare(config) {
      if (config.delivery.mode === "spawn") {
        return null;
      }
      const dir = subscriptionDir(deps.subscriptionsDir, config.id);
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const path = join(
        dir,
        `${config.delivery.mode === "session" ? SESSION_SPOOL : "inbox"}.jsonl`,
      );
      if (!existsSync(path)) {
        writeFileSync(path, "", { mode: 0o600 });
      }
      return path;
    },
    invalidate() {
      cache = null;
    },
    evict(id) {
      for (const key of writers.keys()) {
        if (key.startsWith(`${id}/`)) {
          writers.delete(key);
        }
      }
    },
    dropped() {
      let total = 0;
      for (const entry of writers.values()) {
        total += entry.dropped();
      }
      return total;
    },
  };
}
