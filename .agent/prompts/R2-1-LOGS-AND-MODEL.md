# R2-1 — Logs page + delivery-target data model (first wave of the WebUI R2 restructure)

## Canon
`docs/raw/2026-10-07-webui-r2-restructure.md` — the owner's exact page spec.
Read it FIRST. Executor: Anthropic claude (opus). TDD, no comments, vp check 0,
full suite green, no commit — report gates.

## Context — what exists (verified)
- `/api/search` (`http.ts:827`): q + chat_jid + limit/offset only — NO
  direction/from/date filters. Store fn `searchMessages(store, q, opts)`.
- SSE `/events` + client `appendEvent` ring buffer (500 cap) exist.
- Subscriptions model today: `{id, chats[], kinds[]}` + inbox.jsonl files.
  No filter/prompt/delivery-target fields.
- `renderClaudeHooks` writes `~/.claude/settings.json` hook entries; the
  bridge has NO read surface for "which agents are connected".

## Part A — Logs page (replaces nothing; new core page)
1. Bridge: extend `/api/search` with: `direction` (in|out), `from_jid`,
   `since`, `until` (ISO or epoch ms), `chat_jid` (existing). Extend
   `searchMessages` accordingly (SQL WHERE composition; keep LIKE escape).
   RED: each filter in isolation + combined.
2. Web UI: route `#/logs`. Table: time (local, relative+absolute on hover),
   direction badge (⬇ in / ⬆ out), chat displayName, sender displayName,
   snippet. Filter bar: chat picker, person picker (from chat participants
   or from), direction select, date range (from/to datetime-local), free
   text. Server-side pagination (limit/offset, page buttons). Live tail
   toggle (reuse SSE, filtered client-side by the same predicates).
3. CLI: `wa-mcp logs --chat <jid|name> --from --to --direction --q --limit
   --follow` → same endpoint. RED: CLI test asserting the query string +
   table output shape.
4. Delete `#/events` remnants (already redirects to #/status; remove the
   redirect, route becomes 404 → home) — Logs replaces it.

## Part B — delivery-target model (foundation for Subscriptions R2)
1. shared: `SubscriptionConfig` type: `{ id, name, chats: string[], filter:
   { like?: string, mentionOnly?: boolean }, prompt?: string, delivery: {
   mode: "inbox" | "session" | "spawn", session?: string, agent?: { command:
   string, args?: string[], env?: Record<string,string> } } , created, enabled }`.
2. Store: persist config per subscription (`store` layer, new table or
   JSON sidecar — read the existing store schema first, choose the least-
   invasive consistent option; defensive migration).
3. Bridge: `GET/POST/PATCH/DELETE /api/subs2` (full CRUD over the config;
   keep v1 endpoints untouched this wave). RED: CRUD round-trip + validation
   errors (empty chats, bad mode, bad jid).
4. THIS WAVE STOPS at the data model + endpoints. UI wiring, dispatch
   behavior changes, CLI subcommands come in R2-2/R2-3. Do not touch the
   live dispatcher.

## Report
Per-part summary, RED→GREEN list, endpoint/store diff summary, gates.
