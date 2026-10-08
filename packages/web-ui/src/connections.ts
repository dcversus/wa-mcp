import { escapeHtml } from "./escape.ts";
import { initials } from "./pages.ts";

export interface ConnectionView {
  kind: "hooks" | "mcp";
  agent: string;
  label: string;
  configPath: string;
  detail: string;
  enabled: boolean;
  subId: string | null;
  inboxPath: string | null;
  subscription: { id: string; name: string; chatJid: string | null } | null;
  installed?: boolean | null;
}

export interface ConnectionsPageView {
  connections: ConnectionView[];
  error?: string;
}

export function agentSlug(connection: Pick<ConnectionView, "kind" | "agent">): string {
  return connection.kind === "hooks" && connection.agent === "claude"
    ? "claude-code"
    : connection.agent;
}

export function agentOptions(
  connections: ConnectionView[],
): Array<{ value: string; label: string }> {
  const options = new Map<string, string>();
  for (const connection of connections) {
    const slug = agentSlug(connection);
    if (!options.has(slug)) {
      options.set(slug, connection.label);
    }
  }
  return [...options.entries()].map(([value, label]) => ({ value, label }));
}

function installRank(connection: ConnectionView): number {
  return connection.installed === true ? 0 : connection.installed === false ? 2 : 1;
}

function statusHtml(connection: ConnectionView): string {
  if (connection.kind === "hooks") {
    return connection.enabled
      ? '<span class="connection-status ok">Hooks enabled ✓</span>'
      : '<span class="connection-status off">Hooks disabled</span>';
  }
  return connection.enabled
    ? '<span class="connection-status ok">Registered ✓</span>'
    : '<span class="connection-status off">Disabled in agent config</span>';
}

function subscriptionHtml(connection: ConnectionView): string {
  if (connection.subscription !== null) {
    return `Subscription: <a href="#/subscriptions">${escapeHtml(connection.subscription.name)}</a>`;
  }
  if (connection.subId !== null) {
    return `Subscription ${escapeHtml(connection.subId)} no longer exists — <a href="#/subscriptions">open Subscriptions</a>`;
  }
  return 'Uses WhatsApp tools on demand. <a href="#/subscriptions">Set up a subscription</a> to push messages to it.';
}

export function connectionCardHtml(connection: ConnectionView): string {
  const kind = escapeHtml(connection.kind);
  const agent = escapeHtml(connection.agent);
  const label = escapeHtml(connection.label);
  const badge =
    connection.kind === "hooks"
      ? '<span class="badge badge-hooks">Hooks</span>'
      : '<span class="badge badge-mcp">MCP</span>';
  const missing =
    connection.installed === false
      ? '<span class="badge badge-muted">App not installed</span>'
      : "";
  const logs = `<a href="#/logs?agent=${encodeURIComponent(agentSlug(connection))}">View logs</a>`;
  const sub =
    connection.kind === "hooks" && connection.subId !== null
      ? ` data-disconnect-sub="${escapeHtml(connection.subId)}"`
      : "";
  const disconnect = `<button class="danger" type="button" data-disconnect-kind="${kind}" data-disconnect-agent="${agent}"${sub} data-disconnect-label="${label}" aria-label="Disconnect ${label}">Disconnect</button>`;
  const installed =
    connection.installed === undefined || connection.installed === null
      ? ""
      : ` data-installed="${String(connection.installed)}"`;
  return `<li class="connection-card" data-connection-kind="${kind}" data-connection-agent="${agent}"${installed}><div class="connection-head"><span class="avatar" aria-hidden="true">${escapeHtml(initials(connection.label))}</span><strong class="connection-name">${label}</strong>${badge}${missing}${statusHtml(connection)}</div><p class="connection-sub">${subscriptionHtml(connection)}</p><p class="hint"><code>${escapeHtml(connection.detail)}</code> · <span class="connection-path">${escapeHtml(connection.configPath)}</span></p><div class="connection-actions">${logs}${disconnect}</div></li>`;
}

export function connectionsPageHtml(view: ConnectionsPageView): string {
  const error =
    view.error === undefined
      ? ""
      : `<div class="error-banner" role="alert">${escapeHtml(view.error)}</div>`;
  const body =
    view.connections.length === 0
      ? '<div class="empty-state">No agents connected yet — set one up in <a href="#/subscriptions">Subscriptions</a></div>'
      : `<ul id="connections-list" aria-label="Connected agents">${[...view.connections]
          .sort((a, b) => installRank(a) - installRank(b))
          .map(connectionCardHtml)
          .join("")}</ul>`;
  return `<section id="connections-page"><h1>Agents</h1><p class="hint">AI agents wired to this WhatsApp — through hooks that deliver subscription events, or an MCP server registration.</p>${error}<h2>Connected agents</h2>${body}</section>`;
}
