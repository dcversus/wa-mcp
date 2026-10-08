export interface ConnectionsDeps {
  fetchFn: typeof fetch;
  print: (line: string) => void;
}

export interface ConnectionsArgs {
  baseUrl: string;
  token: string;
  action: string;
  kind?: string;
  agent?: string;
  sub?: string;
}

interface ConnectionRow {
  kind: string;
  agent: string;
  label?: string;
  enabled: boolean;
  subId: string | null;
  subscription?: { id: string; name: string } | null;
  installed?: boolean | null;
}

function installRank(row: ConnectionRow): number {
  return row.installed === true ? 0 : row.installed === false ? 2 : 1;
}

const DISCONNECT_USAGE = "connections disconnect <hooks|mcp> <agent> [--sub <id>]";

function cell(value: string, width: number): string {
  const flat = value.replace(/\s+/g, " ").trim();
  const fitted = flat.length > width ? `${flat.slice(0, width - 1)}…` : flat;
  return fitted.padEnd(width);
}

function subscriptionCell(row: ConnectionRow): string {
  if (row.subscription !== undefined && row.subscription !== null) {
    return `${row.subscription.name} (${row.subscription.id})`;
  }
  return row.subId === null ? "—" : `${row.subId} (missing)`;
}

async function request(
  deps: ConnectionsDeps,
  args: ConnectionsArgs,
  method: string,
  path: string,
): Promise<{ ok: true; body: unknown } | { ok: false; message: string }> {
  const res = await deps.fetchFn(`${args.baseUrl}${path}`, {
    method,
    headers: { authorization: `Bearer ${args.token}` },
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

async function list(deps: ConnectionsDeps, args: ConnectionsArgs): Promise<number> {
  const result = await request(deps, args, "GET", "/api/connections");
  if (!result.ok) {
    deps.print(`connections failed: ${result.message}`);
    return 1;
  }
  const rows = (result.body as { connections?: ConnectionRow[] }).connections ?? [];
  if (rows.length === 0) {
    deps.print(
      "no agents connected — run `wa-mcp install --target <agent>` or `wa-mcp install --hooks claude --sub <id>`",
    );
    return 0;
  }
  deps.print(`${cell("AGENT", 16)}  ${cell("KIND", 6)}  ${cell("STATUS", 9)}  SUBSCRIPTION`);
  for (const row of [...rows].sort((a, b) => installRank(a) - installRank(b))) {
    const missing = row.installed === false ? " · app not installed" : "";
    deps.print(
      `${cell(row.label ?? row.agent, 16)}  ${cell(row.kind, 6)}  ${cell(row.enabled ? "enabled" : "disabled", 9)}  ${subscriptionCell(row)}${missing}`,
    );
  }
  deps.print(
    `${rows.length} ${rows.length === 1 ? "connection" : "connections"} — disconnect with: wa-mcp connections disconnect <kind> <agent>`,
  );
  return 0;
}

async function disconnect(deps: ConnectionsDeps, args: ConnectionsArgs): Promise<number> {
  if (args.kind === undefined || args.agent === undefined) {
    deps.print(DISCONNECT_USAGE);
    return 1;
  }
  const query = args.sub !== undefined ? `?sub=${encodeURIComponent(args.sub)}` : "";
  const result = await request(
    deps,
    args,
    "DELETE",
    `/api/connections/${encodeURIComponent(args.kind)}/${encodeURIComponent(args.agent)}${query}`,
  );
  if (!result.ok) {
    deps.print(`connections failed: ${result.message}`);
    return 1;
  }
  const removed = (result.body as { removed?: number }).removed ?? 0;
  deps.print(
    `disconnected ${args.agent} (${args.kind}) — removed ${removed} ${removed === 1 ? "entry" : "entries"}`,
  );
  return 0;
}

export async function runConnections(
  deps: ConnectionsDeps,
  args: ConnectionsArgs,
): Promise<number> {
  if (args.action === "list") {
    return list(deps, args);
  }
  if (args.action === "disconnect") {
    return disconnect(deps, args);
  }
  deps.print(`connections: unknown action '${args.action}' — use list or disconnect`);
  return 1;
}
