# TASK: R2-9 — Nav regroup + settings-page deletion (TDD, no commit)

## Canon (owner, verbatim)
> we dont need a http://127.0.0.1:8080/#/settings page; at left menu
> regroup everything into two categories: logs, Subscriptions, Agents
> (prev renamed Connections) AND profile, Contacts, Connection, Help.
> no need group header, just more space between groups;

## Part A — delete #/settings
1. Find what the settings page holds (settingsHtml in pages.ts:
   server/token form + possibly transcription settings) — the UI
   token display already moved or is redundant with the cookie flow;
   transcription settings: MOVE the transcription panel onto the
   Connection page (it's daemon config) ONLY if it's live-wired;
   if it's dead/display-only, delete it (note which in the report).
2. Delete: settings route, settingsHtml, its loader/binding in
   main.ts, NAV_TITLES entry, tests referencing #/settings (update
   them), help.ts references to Settings, docs page lists.
3. `#/settings` → redirect to `#/connection` (closest heir).
- RED: router redirect test; removed-code assertions.

## Part B — nav: two groups, no headers, "Agents" rename
NAV_SECTIONS + navHtml groups become exactly:
- Group 1: Logs, Subscriptions, Agents
- Group 2: Profile, Contacts, Connection, Help
Rules:
1. NO group header labels at all (the `nav-group` div is gone).
   Two groups separated by EXTRA VERTICAL SPACE only (a spacer/margin
   between group 1's last item and group 2's first item — pick the
   design-token-consistent way, e.g. margin-top on the second group's
   first li, or a `.nav-separator` with generous padding).
2. "Connections" page/nav/route renamed to "Agents": nav label
   "Agents", page h1 "Agents", document.title "Agents · wa-mcp".
   KEEP the route `#/connections` working as an alias redirect to
   `#/agents` (old links + e2e may reference it; redirect, don't
   break). Choose the canonical route `#/agents`.
3. Order within groups exactly as the owner listed:
   [logs, subscriptions, agents] and [profile, contacts, connection,
   help].
- RED: nav render test (exact order, no group headers, separator
  spacing class present); router test (#/agents resolves, #/connections
  redirects); page title test; existing nav/connections tests updated.

## Part C — consistency sweep
1. help.ts + any docs referencing "Connections" page name → "Agents"
   (the MCP registrations it lists are agent connections).
2. e2e script if it navigates #/connections or #/settings → update.
3. CSS: remove `.nav-group` styles; add the separator treatment per
   design tokens.
- RED: grep-style assertions (no "nav-group" in src, no
  `group headers`), e2e green.

Report: per-part summary, what happened to each settings-page control,
RED→GREEN list, gates.
