# TASK: R2-6 — Help page + CLI parity audit + dead-code cleanup (TDD, no commit)

## Canon
docs/raw/2026-10-07-webui-r2-restructure.md: "+ HELP page with
information how everything working and guides; OTHER PAGES SHOULD BE
DELETED…; should be 100% parity between web ui and cli; clear all the
rest and unusable / unreachable code"

## Part A — Help page (#/help)
Nav top-level. Content (from the docs, adapted for UI):
1. "What is this?" — one paragraph (local WhatsApp bridge for you +
   your AI agents).
2. Getting started: link phone → your first subscription → connect an
   agent (the three flows with links to #/connection,
   #/subscriptions, #/connections).
3. Concepts: Logs, Contacts, Connections, Subscriptions (filter,
   mention-only, prompt, delivery modes), Profile, Connection
   settings (humanisation, send limits) — one short section each,
   with links.
4. CLI reference: every wa-mcp command with flags (from bin.ts usage
   strings — keep in sync mechanically: generate the section from the
   same source the usage text uses if feasible, else a drift test
   that fails when a subcommand exists without a Help entry).
5. Troubleshooting: not linked (QR), 401 (token), 429 (limits),
   subscription not firing (filter/mention check).
- RED: render test (sections present, links valid — assert hrefs
  match the router table); CLI drift test (subcommands ⊆ help
  entries).

## Part B — CLI parity audit (100% webui↔cli)
Build a parity matrix (in the report): every WebUI capability → CLI
command and vice versa. Gaps found → implement the missing side:
- known suspects: contacts add (CLI ✓ web ✓), logs (✓/✓), subs
  (✓/✓), connections (✓/✓), settings (✓/✓), profile edit (web ✓,
  CLI: wa-mcp profile set-name/set-status — add if missing), search
  (web via logs; CLI logs --q ✓), blocklist (web ✓, CLI?), media
  download (CLI?, web?).
- RED: a parity TEST that walks a declared capability table (both
  sides' handlers exist).

## Part C — dead code cleanup
1. Delete unreachable pages/routes/components the R2 restructure
   orphaned: statusDashboardHtml (agent noted it's test-only now),
   any leftover #/connect/#/unread/#/events handlers, nav entries
   gone, unused api.ts methods, unused CSS blocks (grep classes
   before deleting), unused exports (vp check catches unused locals
   but not exports — use a quick ts-prune-style grep or manual
   cross-check).
2. MCP tool surface: REMOVE tools that no longer make sense post-R2?
   NO — MCP tools stay (agents use them); only web-ui/cli dead code
   goes.
3. Docs sweep: docs/ pages referencing deleted UI (grep '#/status',
   'automations', 'Agent alerts') → update.
- RED: existing suites stay green; add assertions where a deletion
  could regress (router table test).

## Report
Per-part summary, the parity MATRIX (web | cli | gap→fixed),
deletion list with LOC removed, gates.
