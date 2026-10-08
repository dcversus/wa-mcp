export interface MessagesDeps {
  fetchFn: typeof fetch;
  print: (line: string) => void;
  sleep: (ms: number) => Promise<void>;
  keepFollowing: () => boolean;
}

export interface MessagesArgs {
  baseUrl: string;
  token: string;
  chat?: string;
  person?: string;
  from?: string;
  to?: string;
  direction?: "in" | "out";
  q?: string;
  agent?: string;
  limit?: number;
  around?: string;
  follow: boolean;
  intervalMs?: number;
}

interface LogMessage {
  id: string;
  chatJid: string;
  senderJid: string | null;
  senderName: string | null;
  timestamp: string;
  content: string | null;
  mediaType: string | null;
  isFromMe: boolean;
}

function cell(value: string, width: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  const fitted = flat.length > width ? `${flat.slice(0, width - 1)}…` : flat;
  return fitted.padEnd(width);
}

const HEADER = `${cell("TIME", 24)}  ${cell("DIR", 3)}  ${cell("CHAT", 20)}  ${cell("FROM", 16)}  TEXT`;

function formatRow(message: LogMessage, chatNames: Map<string, string>): string {
  const from = message.isFromMe
    ? "me"
    : (message.senderName ?? message.senderJid?.split("@")[0] ?? "");
  const text = message.content ?? (message.mediaType !== null ? `[${message.mediaType}]` : "");
  return [
    cell(message.timestamp, 24),
    cell(message.isFromMe ? "out" : "in", 3),
    cell(chatNames.get(message.chatJid) ?? message.chatJid, 20),
    cell(from, 16),
    text.replace(/\s+/g, " ").trim().slice(0, 120),
  ].join("  ");
}

async function fetchJson(
  deps: MessagesDeps,
  args: MessagesArgs,
  path: string,
): Promise<{ ok: true; body: unknown } | { ok: false; message: string }> {
  const res = await deps.fetchFn(`${args.baseUrl}${path}`, {
    headers: { authorization: `Bearer ${args.token}` },
  });
  const body = (await res.json().catch(() => ({}))) as { error?: { message?: string } };
  if (!res.ok) {
    const detail = body.error?.message;
    return {
      ok: false,
      message: `HTTP ${res.status}${detail !== undefined ? ` — ${detail}` : ""}`,
    };
  }
  return { ok: true, body };
}

async function loadChatNames(deps: MessagesDeps, args: MessagesArgs): Promise<Map<string, string>> {
  const names = new Map<string, string>();
  for (const archived of ["false", "true"]) {
    const result = await fetchJson(
      deps,
      args,
      `/api/chats?limit=500&include_last_message=false&archived=${archived}`,
    );
    if (!result.ok) {
      continue;
    }
    const chats = (result.body as { chats?: Array<{ jid: string; name: string | null }> }).chats;
    for (const chat of chats ?? []) {
      if (chat.name !== null && chat.name.length > 0) {
        names.set(chat.jid, chat.name);
      }
    }
  }
  return names;
}

function resolveChat(raw: string, names: Map<string, string>): string | null {
  if (raw.includes("@")) {
    return raw;
  }
  if (/^\+?\d{6,}$/.test(raw)) {
    return `${raw.replace(/^\+/, "")}@s.whatsapp.net`;
  }
  const needle = raw.toLowerCase();
  const entries = [...names.entries()];
  const exact = entries.find(([, name]) => name.toLowerCase() === needle);
  if (exact !== undefined) {
    return exact[0];
  }
  const partial = entries.filter(([, name]) => name.toLowerCase().includes(needle));
  return partial.length === 1 ? (partial[0] as [string, string])[0] : null;
}

function searchPath(
  args: MessagesArgs,
  chatJid: string | undefined,
  since: string | undefined,
): string {
  const params = new URLSearchParams();
  const entries: Array<[string, string | undefined]> = [
    ["chat_jid", chatJid],
    ["from_jid", args.person],
    ["since", since],
    ["until", args.to],
    ["direction", args.direction],
    ["q", args.q],
    ["agent", args.agent],
    ["limit", args.limit === undefined ? undefined : String(args.limit)],
  ];
  for (const [key, value] of entries) {
    if (value !== undefined && value.length > 0) {
      params.set(key, value);
    }
  }
  const query = params.toString();
  return query.length > 0 ? `/api/search?${query}` : "/api/search";
}

async function printContext(
  deps: MessagesDeps,
  args: MessagesArgs,
  chatJid: string | undefined,
  messageId: string,
  names: Map<string, string>,
): Promise<number> {
  const params = new URLSearchParams();
  if (chatJid !== undefined) {
    params.set("chat_jid", chatJid);
  }
  params.set("message_id", messageId);
  params.set("radius", String(args.limit ?? 5));
  const result = await fetchJson(deps, args, `/api/context?${params.toString()}`);
  if (!result.ok) {
    deps.print(`messages failed: ${result.message}`);
    return 1;
  }
  deps.print(HEADER);
  for (const message of (result.body as { messages?: LogMessage[] }).messages ?? []) {
    deps.print(
      formatRow(
        message.id === messageId ? { ...message, content: `▶ ${message.content ?? ""}` } : message,
        names,
      ),
    );
  }
  return 0;
}

export async function runMessages(deps: MessagesDeps, args: MessagesArgs): Promise<number> {
  if (args.direction !== undefined && args.direction !== "in" && args.direction !== "out") {
    deps.print("messages: --direction must be in or out");
    return 1;
  }
  const names = await loadChatNames(deps, args);
  let chatJid: string | undefined;
  if (args.chat !== undefined) {
    const resolved = resolveChat(args.chat, names);
    if (resolved === null) {
      deps.print(`messages: no chat named '${args.chat}' — pass a jid or an exact chat name`);
      return 1;
    }
    chatJid = resolved;
  }
  if (args.around !== undefined) {
    return printContext(deps, args, chatJid, args.around, names);
  }
  const seen = new Set<string>();
  let newest = args.from;
  let headerPrinted = false;
  const fetchPage = async (since: string | undefined): Promise<LogMessage[] | null> => {
    const result = await fetchJson(deps, args, searchPath(args, chatJid, since));
    if (!result.ok) {
      deps.print(`messages failed: ${result.message}`);
      return null;
    }
    return (result.body as { messages?: LogMessage[] }).messages ?? [];
  };
  const emit = (messages: LogMessage[]): void => {
    const fresh = messages
      .filter((message) => !seen.has(`${message.chatJid}/${message.id}`))
      .reverse();
    if (fresh.length > 0 && !headerPrinted) {
      deps.print(HEADER);
      headerPrinted = true;
    }
    for (const message of fresh) {
      seen.add(`${message.chatJid}/${message.id}`);
      deps.print(formatRow(message, names));
      if (newest === undefined || message.timestamp > newest) {
        newest = message.timestamp;
      }
    }
  };
  const first = await fetchPage(args.from);
  if (first === null) {
    return 1;
  }
  emit(first);
  if (!args.follow) {
    if (first.length === 0) {
      deps.print("no messages match");
    }
    return 0;
  }
  if (first.length === 0) {
    deps.print("no messages yet — following");
  }
  while (deps.keepFollowing()) {
    await deps.sleep(args.intervalMs ?? 2000);
    const page = await fetchPage(newest);
    if (page === null) {
      return 1;
    }
    emit(page);
  }
  return 0;
}
