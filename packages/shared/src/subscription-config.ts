import { isJid } from "./jid.ts";

export const DELIVERY_MODES = ["inbox", "session", "spawn"] as const;

export type DeliveryMode = (typeof DELIVERY_MODES)[number];

export interface SpawnAgent {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface SubscriptionDelivery {
  mode: DeliveryMode;
  session?: string;
  agent?: SpawnAgent;
}

export interface SubscriptionFilter {
  like?: string;
  mentionOnly?: boolean;
}

export interface SubscriptionConfigInput {
  name: string;
  chats: string[];
  filter: SubscriptionFilter;
  prompt?: string;
  delivery: SubscriptionDelivery;
  enabled: boolean;
}

export interface SubscriptionConfig extends SubscriptionConfigInput {
  id: string;
  created: string;
}

export type ConfigValidation =
  | { ok: true; value: SubscriptionConfigInput }
  | { ok: false; message: string };

type Loose = Record<string, unknown>;

function isObject(value: unknown): value is Loose {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function fail(message: string): ConfigValidation {
  return { ok: false, message };
}

function validateFilter(raw: unknown): SubscriptionFilter | string {
  if (raw === undefined) {
    return {};
  }
  if (!isObject(raw)) {
    return "filter must be an object";
  }
  const filter: SubscriptionFilter = {};
  if (raw.like !== undefined) {
    if (typeof raw.like !== "string") {
      return "filter.like must be a string";
    }
    filter.like = raw.like;
  }
  if (raw.mentionOnly !== undefined) {
    if (typeof raw.mentionOnly !== "boolean") {
      return "filter.mentionOnly must be a boolean";
    }
    filter.mentionOnly = raw.mentionOnly;
  }
  return filter;
}

function validateAgent(raw: unknown): SpawnAgent | string {
  if (!isObject(raw) || typeof raw.command !== "string" || raw.command.trim().length === 0) {
    return "delivery.agent.command is required for spawn";
  }
  const agent: SpawnAgent = { command: raw.command };
  if (raw.args !== undefined) {
    if (!Array.isArray(raw.args) || raw.args.some((arg) => typeof arg !== "string")) {
      return "delivery.agent.args must be a list of strings";
    }
    agent.args = raw.args as string[];
  }
  if (raw.env !== undefined) {
    if (!isObject(raw.env) || Object.values(raw.env).some((value) => typeof value !== "string")) {
      return "delivery.agent.env must map names to strings";
    }
    agent.env = raw.env as Record<string, string>;
  }
  return agent;
}

function validateDelivery(raw: unknown): SubscriptionDelivery | string {
  const mode = isObject(raw) ? raw.mode : undefined;
  if (!(DELIVERY_MODES as readonly unknown[]).includes(mode)) {
    return `delivery.mode must be one of ${DELIVERY_MODES.join(", ")}`;
  }
  const delivery = raw as Loose;
  if (mode === "session") {
    if (delivery.session === undefined) {
      return { mode };
    }
    if (typeof delivery.session !== "string") {
      return "delivery.session must be a string";
    }
    return { mode, session: delivery.session };
  }
  if (mode === "spawn") {
    const agent = validateAgent(delivery.agent);
    return typeof agent === "string" ? agent : { mode, agent };
  }
  return { mode: "inbox" };
}

export function validateSubscriptionConfigInput(raw: unknown): ConfigValidation {
  if (!isObject(raw)) {
    return fail("body must be a JSON object");
  }
  if (typeof raw.name !== "string" || raw.name.trim().length === 0) {
    return fail("name is required");
  }
  if (!Array.isArray(raw.chats) || raw.chats.length === 0) {
    return fail("chats must list at least one chat");
  }
  for (const [index, chat] of raw.chats.entries()) {
    if (!isJid(chat)) {
      return fail(`chats[${index}] is not a WhatsApp chat id: ${String(chat)}`);
    }
  }
  const filter = validateFilter(raw.filter);
  if (typeof filter === "string") {
    return fail(filter);
  }
  if (raw.prompt !== undefined && typeof raw.prompt !== "string") {
    return fail("prompt must be a string");
  }
  const delivery = validateDelivery(raw.delivery);
  if (typeof delivery === "string") {
    return fail(delivery);
  }
  if (raw.enabled !== undefined && typeof raw.enabled !== "boolean") {
    return fail("enabled must be a boolean");
  }
  const value: SubscriptionConfigInput = {
    name: raw.name.trim(),
    chats: raw.chats as string[],
    filter,
    delivery,
    enabled: (raw.enabled as boolean | undefined) ?? true,
  };
  if (raw.prompt !== undefined) {
    value.prompt = raw.prompt as string;
  }
  return { ok: true, value };
}
