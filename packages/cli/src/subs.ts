import { dirname } from "node:path";
import { validateSubscriptionConfigInput } from "@wa-mcp/shared";

export interface SubsDeps {
  fetchFn: typeof fetch;
  print: (line: string) => void;
}

export interface SubsArgs {
  baseUrl: string;
  token: string;
  action: string;
  id?: string;
  flags: Record<string, string>;
  lists: Record<string, string[]>;
}

interface Agent {
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

interface Delivery {
  mode: string;
  session?: string;
  agent?: Agent;
}

interface Sub {
  id: string;
  name: string;
  chats: string[];
  filter: { like?: string; mentionOnly?: boolean };
  prompt?: string;
  delivery: Delivery;
  enabled: boolean;
  inboxPath?: string;
}

type Result<T> = { ok: true; value: T } | { ok: false; message: string };

const CREATE_HINT =
  "wa-mcp subs create --name <name> --chat <jid> [--like %text%] [--mention-only] [--prompt <text>] [--delivery inbox|session|spawn]";

function cell(value: string, width: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  const fitted = flat.length > width ? `${flat.slice(0, width - 1)}…` : flat;
  return fitted.padEnd(width);
}

function has(args: SubsArgs, name: string): boolean {
  return Object.hasOwn(args.flags, name);
}

function flagBool(args: SubsArgs, name: string): boolean {
  return args.flags[name] !== "false";
}

export function chatsLabel(chats: string[]): string {
  if (chats.includes("*")) {
    return "all chats";
  }
  return chats.length === 1 ? (chats[0] as string) : `${chats.length} chats`;
}

export function filterLabel(filter: Sub["filter"]): string {
  const parts = [
    ...(filter.like !== undefined && filter.like.length > 0 ? [`~ ${filter.like}`] : []),
    ...(filter.mentionOnly === true ? ["mentions only"] : []),
  ];
  return parts.length === 0 ? "—" : parts.join(" · ");
}

export function deliveryLabel(delivery: Delivery): string {
  if (delivery.mode === "session") {
    return `session: ${delivery.session ?? "active"}`;
  }
  if (delivery.mode === "spawn") {
    return `spawn: ${delivery.agent?.command ?? "?"}`;
  }
  return "inbox";
}

async function request(
  deps: SubsDeps,
  args: SubsArgs,
  method: string,
  path: string,
  body?: unknown,
): Promise<Result<unknown>> {
  const res = await deps.fetchFn(`${args.baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${args.token}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const parsed = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) {
    const detail = parsed.error?.message;
    return {
      ok: false,
      message: `HTTP ${res.status}${detail !== undefined ? ` — ${detail}` : ""}`,
    };
  }
  return { ok: true, value: parsed };
}

function parseEnv(entries: string[]): Result<Record<string, string> | undefined> {
  if (entries.length === 0) {
    return { ok: true, value: undefined };
  }
  const env: Record<string, string> = {};
  for (const entry of entries) {
    const at = entry.indexOf("=");
    if (at <= 0) {
      return { ok: false, message: `--env must be NAME=value (got ${entry})` };
    }
    env[entry.slice(0, at)] = entry.slice(at + 1);
  }
  return { ok: true, value: env };
}

function deliveryFrom(args: SubsArgs, current?: Delivery): Result<Delivery | undefined> {
  const touched = ["delivery", "session", "command", "arg", "env"].some((name) => has(args, name));
  if (!touched) {
    return { ok: true, value: current };
  }
  const mode =
    args.flags.delivery !== undefined && args.flags.delivery.length > 0
      ? args.flags.delivery
      : has(args, "command")
        ? "spawn"
        : has(args, "session")
          ? "session"
          : (current?.mode ?? "inbox");
  if (mode === "session") {
    const session = args.flags.session ?? current?.session;
    return {
      ok: true,
      value: session !== undefined && session.length > 0 ? { mode, session } : { mode },
    };
  }
  if (mode === "spawn") {
    const env = parseEnv(args.lists.env ?? []);
    if (!env.ok) {
      return env;
    }
    const previous = current?.mode === "spawn" ? current.agent : undefined;
    const command = args.flags.command ?? previous?.command ?? "";
    const argList = has(args, "arg") ? (args.lists.arg ?? []) : previous?.args;
    const envMap = env.value ?? previous?.env;
    return {
      ok: true,
      value: {
        mode,
        agent: {
          command,
          ...(argList !== undefined && argList.length > 0 ? { args: argList } : {}),
          ...(envMap !== undefined ? { env: envMap } : {}),
        },
      },
    };
  }
  return { ok: true, value: { mode } };
}

function filterFrom(args: SubsArgs, current: Sub["filter"]): Sub["filter"] {
  const filter: Sub["filter"] = { ...current };
  if (has(args, "like")) {
    if (args.flags.like === "") {
      delete filter.like;
    } else {
      filter.like = args.flags.like;
    }
  }
  if (has(args, "mention-only")) {
    if (flagBool(args, "mention-only")) {
      filter.mentionOnly = true;
    } else {
      delete filter.mentionOnly;
    }
  }
  return filter;
}

function chatsFrom(args: SubsArgs): string[] | undefined {
  if (has(args, "all-chats") && flagBool(args, "all-chats")) {
    return ["*"];
  }
  const chats = (args.lists.chat ?? []).filter((chat) => chat.length > 0);
  return chats.length > 0 ? chats : undefined;
}

function printCreated(deps: SubsDeps, sub: Sub): void {
  deps.print(`created ${sub.name} (${sub.id}) — ${sub.delivery.mode} delivery`);
  if (sub.delivery.mode === "spawn") {
    deps.print(
      `  each matching message starts \`${sub.delivery.agent?.command ?? "?"}\` with the event JSON in $WAMCP_EVENT (prompt in $WAMCP_PROMPT)`,
    );
    return;
  }
  if (sub.inboxPath === undefined) {
    return;
  }
  if (sub.delivery.mode === "session") {
    deps.print(
      `  events spool to ${dirname(sub.inboxPath)}/session.jsonl for ${sub.delivery.session ?? "the active session"}`,
    );
    return;
  }
  deps.print(`  inbox: ${sub.inboxPath}`);
  deps.print(`  read new events: wa-mcp inbox drain --inbox ${sub.inboxPath}`);
  deps.print(`  wake Claude Code on new events: wa-mcp install --hooks claude --sub ${sub.id}`);
}

async function list(deps: SubsDeps, args: SubsArgs): Promise<number> {
  const result = await request(deps, args, "GET", "/api/subs2");
  if (!result.ok) {
    deps.print(`subs failed: ${result.message}`);
    return 1;
  }
  const subs = (result.value as { subscriptions?: Sub[] }).subscriptions ?? [];
  if (subs.length === 0) {
    deps.print(`no subscriptions — create one: ${CREATE_HINT}`);
    return 0;
  }
  deps.print(
    `${cell("NAME", 20)}  ${cell("ID", 12)}  ${cell("CHATS", 26)}  ${cell("FILTER", 30)}  ${cell("DELIVERY", 30)}  STATUS`,
  );
  for (const sub of subs) {
    deps.print(
      `${cell(sub.name, 20)}  ${cell(sub.id, 12)}  ${cell(chatsLabel(sub.chats), 26)}  ${cell(filterLabel(sub.filter), 30)}  ${cell(deliveryLabel(sub.delivery), 30)}  ${sub.enabled ? "on" : "off"}`,
    );
  }
  deps.print(`${subs.length} ${subs.length === 1 ? "subscription" : "subscriptions"}`);
  return 0;
}

async function create(deps: SubsDeps, args: SubsArgs): Promise<number> {
  const delivery = deliveryFrom(args);
  if (!delivery.ok) {
    deps.print(`subs create: ${delivery.message}`);
    return 1;
  }
  const body: Record<string, unknown> = {
    name: args.flags.name ?? "",
    chats: chatsFrom(args) ?? [],
    filter: filterFrom(args, {}),
    ...(args.flags.prompt !== undefined && args.flags.prompt.length > 0
      ? { prompt: args.flags.prompt }
      : {}),
    delivery: delivery.value ?? { mode: "inbox" },
    enabled: !(has(args, "disable") && flagBool(args, "disable")),
  };
  const checked = validateSubscriptionConfigInput(body);
  if (!checked.ok) {
    const hint = checked.message.startsWith("chats must")
      ? " — pass --chat <jid> (repeatable) or --all-chats"
      : "";
    deps.print(`subs create: ${checked.message}${hint}`);
    return 1;
  }
  const result = await request(deps, args, "POST", "/api/subs2", body);
  if (!result.ok) {
    deps.print(`subs failed: ${result.message}`);
    return 1;
  }
  printCreated(deps, result.value as Sub);
  return 0;
}

async function edit(deps: SubsDeps, args: SubsArgs, id: string): Promise<number> {
  const path = `/api/subs2/${encodeURIComponent(id)}`;
  const existing = await request(deps, args, "GET", path);
  if (!existing.ok) {
    deps.print(`subs failed: ${existing.message}`);
    return 1;
  }
  const current = existing.value as Sub;
  const delivery = deliveryFrom(args, current.delivery);
  if (!delivery.ok) {
    deps.print(`subs edit: ${delivery.message}`);
    return 1;
  }
  const patch: Record<string, unknown> = {};
  if (has(args, "name")) {
    patch.name = args.flags.name;
  }
  const chats = chatsFrom(args);
  if (chats !== undefined) {
    patch.chats = chats;
  }
  if (has(args, "like") || has(args, "mention-only")) {
    patch.filter = filterFrom(args, current.filter);
  }
  if (has(args, "prompt")) {
    patch.prompt = args.flags.prompt === "" ? null : args.flags.prompt;
  }
  if (delivery.value !== current.delivery) {
    patch.delivery = delivery.value;
  }
  if (has(args, "disable")) {
    patch.enabled = !flagBool(args, "disable");
  }
  if (has(args, "enable")) {
    patch.enabled = flagBool(args, "enable");
  }
  const result = await request(deps, args, "PATCH", path, patch);
  if (!result.ok) {
    deps.print(`subs failed: ${result.message}`);
    return 1;
  }
  const updated = result.value as Sub;
  deps.print(`updated ${updated.name} (${updated.id})`);
  return 0;
}

export async function runSubs(deps: SubsDeps, args: SubsArgs): Promise<number> {
  if (args.action === "list") {
    return list(deps, args);
  }
  if (args.action === "create") {
    return create(deps, args);
  }
  if (args.action === "sessions") {
    const result = await request(deps, args, "GET", "/api/sessions");
    if (!result.ok) {
      deps.print(`subs failed: ${result.message}`);
      return 1;
    }
    const sessions =
      (result.value as { sessions?: Array<{ id: string; label: string }> }).sessions ?? [];
    if (sessions.length === 0) {
      deps.print("no Claude Code or Codex sessions found");
    }
    for (const session of sessions) {
      deps.print(`${session.id}  ${session.label}`);
    }
    return 0;
  }
  if (!["edit", "delete", "test"].includes(args.action)) {
    deps.print(
      `subs: unknown action '${args.action}' — use list, create, edit, delete, test or sessions`,
    );
    return 1;
  }
  const id = args.id;
  if (id === undefined || id.length === 0) {
    deps.print(`subs ${args.action} <id>${args.action === "edit" ? " [flags]" : ""}`);
    return 1;
  }
  if (args.action === "edit") {
    return edit(deps, args, id);
  }
  const path = `/api/subs2/${encodeURIComponent(id)}`;
  const result =
    args.action === "delete"
      ? await request(deps, args, "DELETE", path)
      : await request(deps, args, "POST", `${path}/test`);
  if (!result.ok) {
    deps.print(`subs failed: ${result.message}`);
    return 1;
  }
  if (args.action === "delete") {
    deps.print(`deleted ${id}`);
    return 0;
  }
  const test = result.value as { mode?: string; inboxPath?: string | null; totalLines?: number };
  deps.print(
    test.inboxPath === null || test.inboxPath === undefined
      ? `test event delivered (${test.mode ?? "?"}) — the agent command was started`
      : `test event delivered (${test.mode ?? "?"}) → ${test.inboxPath} (${test.totalLines ?? 0} lines)`,
  );
  return 0;
}
