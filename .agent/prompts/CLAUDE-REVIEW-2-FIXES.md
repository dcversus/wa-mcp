# TASK: fix CLAUDE-REVIEW-2 findings (4 majors + selected minors)

Read `review/CLAUDE-REVIEW-2.md` first — it is the source of truth for
every finding below. TDD: RED test first, then fix, then GREEN.
Zero comments in source. `vp check` must stay 0.

## Majors (all four required)

1. **Dead control `#sub-include-media`** — the picker renders the checkbox
   but the change handler never reads it. Wire it: when creating a
   subscription from a picker toggle, pass `include_media` from the checkbox
   state. RED test: pure function or api-level test proving the payload
   includes it.

2. **`staleTokenCleared` never resets** — after a SUCCESSFUL exchange the
   flag must return to `false` so a second daemon restart within one page
   load still recovers. RED test in t145-style pure form if possible.

3. **`clearStaleTokenOnce` wipes manually entered tokens** — only clear the
   stored token when it is empty-able AND the exchange path is actually
   available. Guard: do not clear if the token was just written by a
   successful exchange in this same load (use a monotonic guard, not a
   one-shot flag). If exchange terminally 403s, surface the inline token
   form (existing needsToken path) instead of looping.

4. **Privacy selects misreport** — `PRIVACY_ROWS` in pages.ts diverges from
   the bridge's allowed values (`contact_blacklist` missing on
   profile/status, `none` missing on groupadd). Single-source it: pages.ts
   must derive its option lists from `privacyOptionsFor()` in state.ts (the
   same source the tests pin). When the live value is not in the list,
   render it as an extra selected `<option>` so the truth is visible.

## Minors (do these)

- `deleteSubscriptionForChat` deletes only the first match — delete ALL
  subscriptions for the chat (the markup already has data-sub-ids).
- Loader `.filter((c) => !c.jid.endsWith("@lid"))` throws when jid is
  missing — guard, don't filter out silently-broken rows.
- `renderCurrent` catch interpolates `err.message` into innerHTML unescaped
  — escapeHtml it.
- Exchange-401 render loop (minor 2 in the report): in
  `exchangeAccountToken`, treat ApiError 401 as terminal-for-this-load
  (same class as 403) so the inline token form shows instead of a 2 req/s
  loop.

## Gates
- `vp test` full suite green (1028+ tests, expect new ones added)
- `vp check` 0 — verify it yourself before reporting; do NOT commit
- Report: what changed, test counts, check status
