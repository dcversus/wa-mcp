# TASK: FIX WAVE R1-D1 — onboarding P0/P1 defects (TDD, no commit)

You are the implementing agent. Fix ONLY what is listed here, TDD each
(RED test first with the broken behavior, then GREEN), `vp check` must
stay 0, full suite must stay green (1046+). Zero comments in source.
Do NOT commit — report back with gates.

Source of truth: `review/AUDIT-R1-D1.md` (read it first — every finding
has file:line + repro + fix direction).

## P0 fixes (all four, in this order)

### F1. Chat routing — main.ts:492
`if (hash.startsWith("#/chat"))` matches `#/chats` so bindChatClicks,
bindChatsControls, bindChatExtras and scroll-to-bottom never run.
- Match EXACT routes: `#/chats` binds chats-list controls; `#/chat/<jid>`
  binds send box + extras. Order matters or use exact equality where
  possible.
- Render chat rows as `<a href="#/chat/<jid>">` (works without JS, keyboard
  accessible). Same for Unread rows.
- RED test: hash-dispatch pure function (extract `bindRoute`'s decision
  into a testable `routeKind(hash)` if needed) asserting `#/chats` →
  "chats-list" and `#/chat/x@g.us` → "chat-view".
- Also fixes F6 (chat opens at oldest message — scroll to bottom after
  render) and F7 (search + archived toggle dead).

### F2. Pairing poll storm — main.ts:975-991
bindPairingFlow creates a new setInterval every render; rerenderPairing
re-binds → exponential leak.
- ONE interval, created once, cleared on hashchange (the existing
  pairingPoll clear must catch it).
- Re-render ONLY when the pairing view-model actually changes (compare
  state, skip DOM write when equal).
- NEVER replace a focused form: if document.activeElement is inside the
  phone-form, skip the innerHTML rewrite that tick.
- RED test: fake-timer test asserting ONE /health fetch per 3s after 60s
  (count fetch calls), and that a focused input survives 3 ticks.

### F3. Link-state gate — router/main
- When /health says loggedIn !== true, `#/` (and any route without explicit
  user intent) renders the pairing pane as the app content, with a one-line
  explainer: what wa-mcp is ("Link WhatsApp to your AI agent").
- Persistent banner on other routes while unpaired: "WhatsApp not linked —
  Link now".
- When paired but store empty (or contactsWarm false): chats page shows
  "Syncing your chats from your phone…" with spinner instead of the
  current misleading empty-copy.
- RED test: router gate pure function (health + hash → which pane).

### F4. "Connect your agent" step
- After pairing success (and as a section on #/subscriptions), render a
  "Connect your agent" card: per-target install commands
  (`wa-mcp install --target claude-code` etc.) with copy buttons.
- `wa-mcp start` output (bin.ts:375): print `Web UI: http://127.0.0.1:8080
  — open it to link WhatsApp` next to the pid line.
- Keep it simple: static command list + copy buttons, no doctor calls yet.

## P1 fixes (these too)

### F5. Hook command uses the real inbox path
- GET /api/subscriptions must return the real absolute `inboxPath` the
  server already knows (http.ts:3559-3565) — the UI currently fabricates
  `/api/subscriptions/inbox/<id>/inbox.jsonl` (main.ts:466).
- `inbox drain --inbox <missing>` exits non-zero with "no such inbox:
  <path>" (subscribe.ts:98).
- RED tests both sides.

### F8. Pairing error pane recovery
- "try again" becomes a button that clears error/code and re-renders
  (pages-pairing.ts:81, main.ts:966-969).

### F10. Owner phone number placeholder
- pages-pairing.ts:104 placeholder → `e.g. 447700900123`. Grep the repo
  for `358497773518` elsewhere and replace any user-facing copies (NOT
  test fixtures where it's data).

### F14. "paired as this device" → real identity
- Fill pairingView.me from GET /api/me (already exists) → "paired as
  Versus (+358497773518)".

## Explicitly OUT of this wave (do not touch)
- F9 (copy-paste link relabel), F11 (displayName layer), F12 (status
  card), F13, F15, F19, F20, F21 — next wave.
- Do not redesign styles.

## Gates
- vp test full green (expect +N new tests) · vp check 0 · report: files
  changed, test counts, which findings are fixed vs deferred.
