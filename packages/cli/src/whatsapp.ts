import {
  PRIVACY_LABELS,
  PRIVACY_SETTINGS,
  buildPrivacyPatch,
  normalizeJid,
  privacyOptionsFor,
} from "@wa-mcp/shared";

export interface WhatsAppDeps {
  fetchFn: typeof fetch;
  print: (line: string) => void;
}

export interface WhatsAppArgs {
  baseUrl: string;
  token: string;
  positionals: string[];
  flags: Record<string, string>;
}

type Result = { ok: true; body: Record<string, unknown> } | { ok: false; message: string };

async function call(
  deps: WhatsAppDeps,
  args: WhatsAppArgs,
  label: string,
  method: string,
  path: string,
  body?: unknown,
): Promise<Result> {
  const res = await deps.fetchFn(`${args.baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${args.token}`, "content-type": "application/json" },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const parsed = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (res.ok) {
    return { ok: true, body: parsed };
  }
  const detail = (parsed.error as { message?: string } | undefined)?.message;
  const retry = res.headers.get("retry-after");
  return {
    ok: false,
    message: `${label} failed: HTTP ${res.status}${detail !== undefined ? ` — ${detail}` : ""}${retry !== null ? ` — retry in ${retry}s` : ""}`,
  };
}

function asText(value: unknown, fallback: string): string {
  return typeof value === "string" ? value : fallback;
}

function fail(deps: WhatsAppDeps, message: string): number {
  deps.print(message);
  return 1;
}

function cell(value: string, width: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  return (flat.length > width ? `${flat.slice(0, width - 1)}…` : flat).padEnd(width);
}

function localPart(jid: string): string {
  return (jid.split("@")[0] ?? jid).split(":")[0] ?? jid;
}

interface ChatRow {
  jid: string;
  name: string | null;
  unreadCount: number;
  archived?: boolean;
}

export async function runChats(deps: WhatsAppDeps, args: WhatsAppArgs): Promise<number> {
  const params = new URLSearchParams();
  if (args.flags.limit !== undefined) {
    params.set("limit", args.flags.limit);
  }
  params.set("include_last_message", "false");
  const result = await call(deps, args, "chats", "GET", `/api/chats?${params.toString()}`);
  if (!result.ok) {
    return fail(deps, result.message);
  }
  const all = (result.body.chats ?? []) as ChatRow[];
  const query = (args.flags.q ?? "").toLowerCase();
  const rows = all.filter(
    (chat) =>
      query.length === 0 ||
      (chat.name ?? "").toLowerCase().includes(query) ||
      chat.jid.toLowerCase().includes(query),
  );
  if (rows.length === 0) {
    deps.print(
      query.length > 0
        ? `no chats match '${args.flags.q ?? ""}'`
        : "no chats yet — link WhatsApp first: wa-mcp pair",
    );
    return 0;
  }
  deps.print(`${cell("NAME", 28)}  ${cell("JID", 34)}  UNREAD`);
  for (const chat of rows) {
    const name = chat.name !== null && chat.name.length > 0 ? chat.name : localPart(chat.jid);
    deps.print(
      `${cell(name, 28)}  ${cell(chat.jid, 34)}  ${chat.unreadCount}${chat.archived === true ? " (archived)" : ""}`,
    );
  }
  deps.print(`${rows.length} chat${rows.length === 1 ? "" : "s"}`);
  return 0;
}

export async function runSend(deps: WhatsAppDeps, args: WhatsAppArgs): Promise<number> {
  const chat = args.flags.chat;
  const text = args.flags.text;
  if (chat === undefined || chat.length === 0 || text === undefined || text.length === 0) {
    return fail(deps, "send --chat <jid|phone> --text <text> [--reply-to <message-id>]");
  }
  const replyTo = args.flags["reply-to"];
  const result = await call(deps, args, "send", "POST", "/api/send", {
    chat_jid: chat,
    text,
    ...(replyTo !== undefined ? { reply_to_message_id: replyTo } : {}),
  });
  if (!result.ok) {
    return fail(deps, result.message);
  }
  deps.print(`sent ${asText(result.body.message_id, "")} to ${chat}`);
  return 0;
}

function formatSize(bytes: number): string {
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export async function runMedia(deps: WhatsAppDeps, args: WhatsAppArgs): Promise<number> {
  const [action, id] = args.positionals;
  if (action !== "download" && action !== "transcribe") {
    return fail(deps, `media: unknown action '${action ?? ""}' — use download or transcribe`);
  }
  if (id === undefined || id.length === 0) {
    return fail(deps, `media ${action} <message-id>`);
  }
  if (action === "download") {
    const result = await call(
      deps,
      args,
      "media",
      "POST",
      `/api/media/${encodeURIComponent(id)}`,
      {},
    );
    if (!result.ok) {
      return fail(deps, result.message);
    }
    const size = typeof result.body.size === "number" ? `, ${formatSize(result.body.size)}` : "";
    deps.print(
      `saved ${asText(result.body.name, id)} (${asText(result.body.mime, "media")}${size})`,
    );
    return 0;
  }
  const result = await call(deps, args, "media", "POST", "/api/transcribe", { message_id: id });
  if (!result.ok) {
    return fail(deps, result.message);
  }
  deps.print(asText(result.body.text, ""));
  return 0;
}

const PROFILE_ACTIONS = ["show", "name", "about", "privacy", "blocked", "block", "unblock"];

function listWords(words: string[]): string {
  return words.length <= 1
    ? words.join("")
    : `${words.slice(0, -1).join(", ")} or ${words[words.length - 1]}`;
}

async function showProfile(deps: WhatsAppDeps, args: WhatsAppArgs): Promise<number> {
  const [me, privacy, blocked] = await Promise.all([
    call(deps, args, "profile", "GET", "/api/me"),
    call(deps, args, "profile", "GET", "/api/privacy"),
    call(deps, args, "profile", "GET", "/api/blocklist"),
  ]);
  for (const result of [me, privacy, blocked]) {
    if (!result.ok) {
      return fail(deps, result.message);
    }
  }
  const meBody = (me.ok ? me.body : {}) as {
    name?: string | null;
    pn?: string | null;
    status?: string | null;
  };
  const values = ((privacy.ok ? privacy.body.privacy : {}) ?? {}) as Record<string, string>;
  const list = ((blocked.ok ? blocked.body.blocklist : []) ?? []) as string[];
  deps.print(`name: ${meBody.name ?? "—"}`);
  deps.print(`phone: ${meBody.pn != null ? `+${localPart(meBody.pn)}` : "—"}`);
  deps.print(`about: ${meBody.status != null && meBody.status.length > 0 ? meBody.status : "—"}`);
  deps.print("privacy:");
  for (const setting of PRIVACY_SETTINGS) {
    const value = values[setting.key];
    deps.print(
      `  ${setting.label}: ${value === undefined ? "—" : (PRIVACY_LABELS[value] ?? value)}`,
    );
  }
  deps.print(`blocked: ${list.length} (wa-mcp profile blocked)`);
  return 0;
}

export async function runProfile(deps: WhatsAppDeps, args: WhatsAppArgs): Promise<number> {
  const [action = "show", ...rest] = args.positionals;
  if (!PROFILE_ACTIONS.includes(action)) {
    return fail(deps, `profile: unknown action '${action}' — use ${listWords(PROFILE_ACTIONS)}`);
  }
  if (action === "show") {
    return showProfile(deps, args);
  }
  if (action === "name" || action === "about") {
    const value = rest.join(" ").trim();
    if (action === "name" && value.length === 0) {
      return fail(deps, "profile name <name>");
    }
    const result = await call(
      deps,
      args,
      "profile",
      "POST",
      "/api/profile",
      action === "name" ? { name: value } : { status: value },
    );
    if (!result.ok) {
      return fail(deps, result.message);
    }
    deps.print(`${action} saved: ${value}`);
    return 0;
  }
  if (action === "privacy") {
    const [key = "", value = ""] = rest;
    const setting = PRIVACY_SETTINGS.find((entry) => entry.key === key);
    if (setting === undefined) {
      return fail(
        deps,
        `profile privacy: unknown setting '${key}' — use ${listWords(PRIVACY_SETTINGS.map((entry) => entry.key))}`,
      );
    }
    const options = privacyOptionsFor(key);
    if (!options.includes(value)) {
      return fail(deps, `profile privacy ${key}: value must be ${listWords(options)}`);
    }
    const result = await call(
      deps,
      args,
      "profile",
      "POST",
      "/api/privacy",
      buildPrivacyPatch(key, value),
    );
    if (!result.ok) {
      return fail(deps, result.message);
    }
    deps.print(`privacy: ${setting.label} → ${PRIVACY_LABELS[value] ?? value}`);
    return 0;
  }
  if (action === "blocked") {
    const result = await call(deps, args, "profile", "GET", "/api/blocklist");
    if (!result.ok) {
      return fail(deps, result.message);
    }
    const list = (result.body.blocklist ?? []) as string[];
    if (list.length === 0) {
      deps.print("no blocked contacts");
    }
    for (const jid of list) {
      deps.print(jid);
    }
    return 0;
  }
  const raw = rest.join(" ").trim();
  const jid = normalizeJid(raw);
  if (jid === null) {
    return fail(deps, `profile ${action}: '${raw}' is not a phone number or WhatsApp id`);
  }
  const result = await call(deps, args, "profile", "POST", "/api/block", {
    jid,
    block: action === "block",
  });
  if (!result.ok) {
    return fail(deps, result.message);
  }
  deps.print(`${action === "block" ? "blocked" : "unblocked"} ${jid}`);
  return 0;
}

export async function runUnlink(deps: WhatsAppDeps, args: WhatsAppArgs): Promise<number> {
  if (args.flags.yes === undefined) {
    return fail(
      deps,
      "unlink signs this computer out of WhatsApp — run again with --yes to confirm",
    );
  }
  const result = await call(deps, args, "unlink", "POST", "/api/logout", {});
  if (!result.ok) {
    return fail(deps, result.message);
  }
  deps.print("unlinked — link again with: wa-mcp pair");
  return 0;
}

export async function runPairResume(deps: WhatsAppDeps, args: WhatsAppArgs): Promise<number> {
  const result = await call(deps, args, "pair --resume", "POST", "/api/pair/resume", {});
  if (!result.ok) {
    return fail(deps, result.message);
  }
  const attempts = result.body.pairingAttempts as { used?: number; limit?: number } | undefined;
  deps.print(
    `pairing resumed (${attempts?.used ?? 0}/${attempts?.limit ?? 0} attempts used) — run: wa-mcp pair`,
  );
  return 0;
}

export function todayStatsLine(stats: {
  sentToday?: number;
  receivedToday?: number;
  reconnects?: number;
}): string {
  return `today: ${stats.sentToday ?? 0} sent · ${stats.receivedToday ?? 0} received · ${stats.reconnects ?? 0} reconnects`;
}
