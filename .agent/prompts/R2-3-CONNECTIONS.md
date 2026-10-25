# TASK: R2-3 — Connections page (agent fleet, TDD, no commit)

## Canon
docs/raw/2026-10-07-webui-r2-restructure.md — owner spec:
"Connections (connected agent list, with shortcut links to logs,
disconnect button, status do hooks enabled or not and link to
Subscriptions)".

## Context — verified surfaces
- `renderClaudeHooks` (packages/cli/src/hooks.ts) writes
  ~/.claude/settings.json hook entries; hooks reference inbox paths
  ~/.wa-mcp/subs/<id>/inbox.jsonl.
- Subscriptions live in store + /api/subs + /api/subs2 (R2-1 model:
  delivery mode inbox/session/spawn).
- The bridge serves /api/*; an agent is "connected" when it has a hook
  entry (claude/codex) OR a live MCP registration (claude mcp list
  shows wa-mcp; check ~/.claude.json mcpServers, ~/.codex config).
- Logs page exists (#/logs) with filters; Subscriptions page exists.

## Part A — bridge: GET /api/connections
Reads (agent-side, bridge runs as same user):
1. Hook connections: parse ~/.claude/settings.json + ~/.codex/config.toml
   for wa-mcp hook entries → {agent: "claude"|"codex", hookFile,
   inboxPath, subId (derived from path), enabled}.
2. MCP registrations: scan known config surfaces (~/.claude.json
   mcpServers, ~/.codex, ~/.pi/agent/
   mcp.json) for a "wa-mcp" server entry → {agent: <host>,
   registered: true, command}.
3. Response: {connections: [{kind: "hooks"|"mcp", agent, detail, subId,
   enabled, inboxPath}], generatedAt}.
- NO secrets in response (no tokens, no full commands with keys —
  redact env values).
- RED: fixture settings.json + config files in tmp HOME → parsed
  connections; missing files → empty list, no throw; secrets redacted.

## Part B — bridge: DELETE /api/connections/:kind/:agent (disconnect)
- hooks/claude|codex: remove ONLY the wa-mcp entries from that file
  (reuse the remove logic in hooks.ts — extract shared fns if needed;
  preserve foreign entries byte-for-byte).
- mcp/<host>: remove the wa-mcp server key from that host's config.
- RED: removal leaves foreign entries intact; idempotent second call →
  404 or ok:false; unknown agent → 404.

## Part C — web UI: #/connections
Nav: replaces "Connect agent" stub in the Agent group (or System group
— put it top-level "Connections" since it also covers profile-link
status? NO: owner lists Connections as agent-fleet page; keep
WhatsApp-link stuff on Connection page). Sections:
1. "Connected agents" — cards per connection: agent name (Claude Code,
   Codex, Grok…), kind badge (Hooks / MCP), hook status (enabled ✓ /
   disabled), linked subscription (name + link → #/subscriptions),
   shortcut link → #/logs (pre-filtered ?agent= if we have jid context,
   else plain), Disconnect button (confirm → DELETE → refresh).
2. Empty state: "No agents connected yet — set one up in Subscriptions"
   with link.
3. h1, title, aria, .danger on disconnect, wave-4 standards.
- RED: render test with fixture connections (cards, badges, links,
  empty state); router test.

## Part D — CLI
`wa-mcp connections` (list, table: agent, kind, status, subscription),
`wa-mcp connections disconnect <kind> <agent>` (same DELETE).
RED: CLI tests.

Report: per-part summary, RED→GREEN list, the config surfaces scanned,
gates.
