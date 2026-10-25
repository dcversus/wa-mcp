# TASK: R2-12 — Agents page truth + agent-filtered logs (TDD, no commit)

## Owner complaints (verbatim, 2026-10-08)
> HOW ALL of agents registered, but i am not have codex
> installed? AND View logs should navigate me to page with agent
> filter to see EXACTLY logs related to this agent

## Problem 1 — page shows registrations as if installed
Current /api/connections lists any config file carrying our entry.
~/.grok/mcp.json, ~/.gemini/antigravity/mcp_config.json
exist ONLY because our installer wrote them (platform E2E); the apps
aren't installed. That's misleading.
FIX in bridge connections.ts:
1. For each MCP connection, detect whether the HOST APP is actually
   installed (macOS: /Applications/<Name>.app existence + common CLI
   path on PATH via which-equivalent check; per-platform table:
   claude-code CLI (claude), claude-desktop app, codex
   CLI, pi CLI, grok app, antigravity app — keep it
   simple and documented; unknown → null).
2. Response gains `installed: boolean | null` per connection.
3. UI: each card shows "Not installed" badge (muted) when false;
   installed agents sort first. Copy stays honest: badge text
   "App not installed".
- RED: platform table unit test with fake /Applications dir + PATH.

## Problem 2 — View logs must filter by THAT agent
"View logs" on an agent card → logs page pre-filtered to that agent.
Today's logs filters are chat/person/direction/date/text — there is
no agent dimension, and messages don't carry which agent acted.
Design (keep it truthful):
1. What "agent logs" MEANS here: events where THAT agent's
   subscription delivered (subscription deliveries) + sends made via
   that agent's MCP session. The bridge knows deliveries (subs2
   dispatch + send_log). Add `agent` dimension to /api/search:
   for a connection with a linked subscription → filter by that
   subscription's deliveries; plus send_log rows whose source marks
   the MCP client (extend send logging to record the MCP client
   name when a send comes through the MCP server — pass through
   from the stdio session; HTTP UI sends stay "ui").
2. UI: logs page gains an "Agent" filter select (populated from
   /api/connections); the Agents page "View logs" link becomes
   #/logs?agent=<slug> which pre-selects it.
- RED: search agent-filter tests; send_log source recording; logs
  page reads ?agent= param; link includes it.

Report: per-problem summary, the platform-installed detection table,
how sends are attributed, RED→GREEN list, gates.
