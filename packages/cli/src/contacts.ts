export interface ContactsDeps {
  fetchFn: typeof fetch;
  print: (line: string) => void;
}

export interface ContactsArgs {
  baseUrl: string;
  token: string;
  action: string;
  target?: string;
  name?: string;
  username?: string;
  q?: string;
  saved?: boolean;
  limit?: number;
  dryRun?: boolean;
}

interface SyncResult {
  dryRun?: boolean;
  fromChats?: number;
  fromSenders?: number;
  mergedLids?: number;
  removedNonPersons?: number;
  removedEmpty?: number;
  unresolvedLids?: number;
  total?: number;
}

interface ContactRow {
  jid: string;
  displayName: string;
  phone: string | null;
  pushname?: string | null;
  username?: string | null;
}

const ADD_USAGE = "contacts add <phone> --name <name> [--username <u>]";
const RENAME_USAGE = "contacts rename <phone|jid> --name <name>";
const REMOVE_USAGE = "contacts remove <phone|jid>";

function cell(value: string, width: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  const fitted = flat.length > width ? `${flat.slice(0, width - 1)}…` : flat;
  return fitted.padEnd(width);
}

function whatsAppName(row: ContactRow): string {
  if (typeof row.pushname === "string" && row.pushname.length > 0) {
    return `~${row.pushname}`;
  }
  if (typeof row.username === "string" && row.username.length > 0) {
    return `@${row.username}`;
  }
  return "—";
}

async function request(
  deps: ContactsDeps,
  args: ContactsArgs,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ ok: true; body: unknown } | { ok: false; message: string }> {
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
  return { ok: true, body: parsed };
}

function present(value: string | undefined): value is string {
  return value !== undefined && value.trim().length > 0;
}

async function list(deps: ContactsDeps, args: ContactsArgs): Promise<number> {
  const params = new URLSearchParams();
  if (present(args.q)) {
    params.set("q", args.q);
  }
  if (args.saved === true) {
    params.set("saved", "true");
  }
  if (args.limit !== undefined) {
    params.set("limit", String(args.limit));
  }
  const query = params.toString();
  const result = await request(deps, args, "GET", `/api/contacts${query ? `?${query}` : ""}`);
  if (!result.ok) {
    deps.print(`contacts failed: ${result.message}`);
    return 1;
  }
  const payload = result.body as { contacts?: ContactRow[]; total?: number };
  const rows = payload.contacts ?? [];
  if (rows.length === 0) {
    deps.print("no contacts match");
    return 0;
  }
  deps.print(`${cell("NAME", 24)}  ${cell("PHONE", 18)}  ${cell("ON WHATSAPP", 20)}  JID`);
  for (const row of rows) {
    deps.print(
      `${cell(row.displayName, 24)}  ${cell(row.phone ?? "—", 18)}  ${cell(whatsAppName(row), 20)}  ${row.jid}`,
    );
  }
  const total = payload.total ?? rows.length;
  deps.print(
    total > rows.length
      ? `${rows.length} of ${total} contacts — narrow with --q or raise --limit`
      : `${total} ${total === 1 ? "contact" : "contacts"}`,
  );
  return 0;
}

export async function runContacts(deps: ContactsDeps, args: ContactsArgs): Promise<number> {
  if (args.action === "list") {
    return list(deps, args);
  }
  if (args.action === "sync") {
    const result = await request(
      deps,
      args,
      "POST",
      `/api/contacts/sync${args.dryRun === true ? "?dry_run=1" : ""}`,
    );
    if (!result.ok) {
      deps.print(`contacts failed: ${result.message}`);
      return 1;
    }
    const sync = result.body as SyncResult;
    deps.print(
      `contacts sync${sync.dryRun === true ? " (dry run — nothing written)" : ""}: ${sync.fromChats ?? 0} from chats, ${sync.fromSenders ?? 0} from message senders, ${sync.mergedLids ?? 0} LID duplicates merged, ${sync.removedNonPersons ?? 0} groups/channels removed, ${sync.removedEmpty ?? 0} empty rows removed, ${sync.unresolvedLids ?? 0} unresolved LIDs — ${sync.total ?? 0} contacts`,
    );
    return 0;
  }
  const path = args.target === undefined ? "" : `/api/contacts/${encodeURIComponent(args.target)}`;
  if (args.action === "add") {
    if (!present(args.target) || !present(args.name)) {
      deps.print(ADD_USAGE);
      return 1;
    }
    const result = await request(deps, args, "POST", "/api/contacts", {
      phone: args.target,
      name: args.name,
      ...(present(args.username) ? { username: args.username } : {}),
    });
    if (!result.ok) {
      deps.print(`contacts failed: ${result.message}`);
      return 1;
    }
    const contact = (result.body as { contact: ContactRow }).contact;
    deps.print(
      `saved ${contact.displayName} (${contact.phone ?? args.target}) ${contact.jid} — synced to your WhatsApp account`,
    );
    return 0;
  }
  if (args.action === "rename") {
    if (!present(args.target) || !present(args.name)) {
      deps.print(RENAME_USAGE);
      return 1;
    }
    const result = await request(deps, args, "PATCH", path, { name: args.name });
    if (!result.ok) {
      deps.print(`contacts failed: ${result.message}`);
      return 1;
    }
    const contact = (result.body as { contact: ContactRow }).contact;
    deps.print(`renamed ${contact.jid} → ${contact.displayName}`);
    return 0;
  }
  if (args.action === "remove") {
    if (!present(args.target)) {
      deps.print(REMOVE_USAGE);
      return 1;
    }
    const result = await request(deps, args, "DELETE", path);
    if (!result.ok) {
      deps.print(`contacts failed: ${result.message}`);
      return 1;
    }
    deps.print(`removed ${(result.body as { removed: string }).removed} from your contacts`);
    return 0;
  }
  deps.print(`contacts: unknown action '${args.action}' — use list, add, rename, remove or sync`);
  return 1;
}
