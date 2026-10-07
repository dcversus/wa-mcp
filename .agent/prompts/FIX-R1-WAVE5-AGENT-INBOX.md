# TASK: FIX WAVE R1-5 — Agent-inbox wizard + hook-shape fix (TDD, no commit)

Read first: review/AUDIT-R1-D2.md findings #3, #5, #6 (+ D1 #4, #5).
TDD everything; vp check 0; full suite green; zero comments; no commit.

## A1. Rename + 3-step wizard on the Subscriptions page
"Subscriptions" becomes "Agent alerts" (nav label already says Agent
alerts — make the page h1 match). The page turns into a wizard:
1. **Pick chats** — reuse the existing picker; INCLUDE @lid chats
   (D2 #3 step-2 note: they are silently excluded today); show
   displayName + unread count per row.
2. **Pick agent** — three cards: Claude Code / Codex / Watch file
   (generic). Each shows the EXACT one-line command:
   - Claude Code: `wa-mcp install --hooks claude --sub <id>`
   - Codex: `wa-mcp install --hooks codex --sub <id>`
   - Watch file: `tail -F ~/.wa-mcp/subs/<id>/inbox.jsonl`
   Copy button → "Copied ✓". Under it: where events land + one-line
   explanation ("Events are appended to this file; your agent reads them
   and can reply via MCP tools").
3. **Send test event** — button calls a NEW endpoint (below). Shows
   per-inbox: last delivered (relative), pending count, dropped count
   (from /health subscriptions dict + the inbox file).

## A2. Bridge: POST /api/subscriptions/:id/test
- Appends a synthetic event `{"kind":"test","ts":<now>,...}` to the
  sub's inbox.jsonl (reuse the appendEvent path; respects the 500 cap).
- Rate-limit: 1 per 10s per sub (reuse limiter).
- Returns `{ok:true, appended:true, inboxPath}`.
- RED: hitting it appends exactly one line with kind "test"; 409 or 429
  on the second call within 10s; auth required; unknown sub → 404.

## A3. Hook shape verification + drain output (D2 #5)
- Verify `renderClaudeHooks` against the current Claude Code hooks
  reference: `asyncRewake` is a per-hook OPTION, not an event key.
  Fix the shape: FileChanged matcher stays; async rewake moves to the
  hook options. Pin the shape in a fixture test (real settings.json
  shape).
- `drainInbox` exit-2 path: write the summary to STDERR (Claude Code
  feeds stderr to the model on exit 2); stdout stays machine-readable.
  One line per event (cap 20), each with chat displayName, sender
  displayName, message id, 60-char snippet, and the hint
  "use list_messages chat_jid=<jid> to read more".

## A4. Richer inbox events (D2 #6)
The event line gains: `id` (message id), `chatName` (displayName at
dispatch time), `fromName` (displayName). Keep existing keys. Update
t154/t160 fixtures. RED: dispatched event contains all three new keys.

## A5. @lid chats in the picker (D2 #3 step 2)
Find the @lid exclusion in main.ts picker loading; include them; sort
with groups first (existing behavior preserved).

Report: per-A summary, RED→GREEN list, gates, any spec deviations.
