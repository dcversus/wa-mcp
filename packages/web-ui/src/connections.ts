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
}

export interface ConnectionsPageView {
  connections: ConnectionView[];
  error?: string;
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
  const chat = connection.subscription?.chatJid ?? null;
  const logs = `<a href="#/logs"${chat === null ? "" : ` data-logs-chat="${escapeHtml(chat)}"`}>View logs</a>`;
  const sub =
    connection.kind === "hooks" && connection.subId !== null
      ? ` data-disconnect-sub="${escapeHtml(connection.subId)}"`
      : "";
  const disconnect = `<button class="danger" type="button" data-disconnect-kind="${kind}" data-disconnect-agent="${agent}"${sub} data-disconnect-label="${label}" aria-label="Disconnect ${label}">Disconnect</button>`;
  return `<li class="connection-card" data-connection-kind="${kind}" data-connection-agent="${agent}"><div class="connection-head"><span class="avatar" aria-hidden="true">${escapeHtml(initials(connection.label))}</span><strong class="connection-name">${label}</strong>${badge}${statusHtml(connection)}</div><p class="connection-sub">${subscriptionHtml(connection)}</p><p class="hint"><code>${escapeHtml(connection.detail)}</code> · <span class="connection-path">${escapeHtml(connection.configPath)}</span></p><div class="connection-actions">${logs}${disconnect}</div></li>`;
}

export function connectionsPageHtml(view: ConnectionsPageView): string {
  const error =
    view.error === undefined
      ? ""
      : `<div class="error-banner" role="alert">⚠ ${escapeHtml(view.error)}</div>`;
  const body =
    view.connections.length === 0
      ? '<div class="empty-state">No agents connected yet — set one up in <a href="#/subscriptions">Subscriptions</a></div>'
      : `<ul id="connections-list" aria-label="Connected agents">${view.connections.map(connectionCardHtml).join("")}</ul>`;
  return `<section id="connections-page"><h1>Connections</h1><p class="hint">AI agents wired to this WhatsApp — through hooks that deliver subscription events, or an MCP server registration.</p>${error}<h2>Connected agents</h2>${body}</section>`;
}
