# TASK: FIX WAVE R1-D2-P0 — hero path defects (TDD, no commit)

Read `review/AUDIT-R1-D2.md` findings 1-6 first — evidence + fix
directions are there. This wave is the campaign's highest priority: the
product's reason to exist is broken at the bridge level.

TDD every fix (RED with the broken behavior, then GREEN). vp check 0,
full suite green. Zero comments. Do NOT commit.

## F1 (P0, #1). Subscriptions drop live inbound messages
`packages/bridge/src/http.ts:497`: the dispatcher returns early on
`event.payload.type === "notify"` — but notify IS the real-time inbound
type (lifecycle.ts:634 autoreply treats it that way). Only backlog
(`append`) and own sends reach inboxes.
- Accept `notify` AND `append`.
- Skip `key.fromMe === true` events by default (prevents agent self-loop
  on its own replies).
- RED tests (t107/t116 currently pin the WRONG behavior — emit only
  `append`): (a) `notify` from a non-own JID → one inbox line written;
  (b) `fromMe` append → nothing written; (c) notification rules with
  deliver: file/ui evaluated for notify traffic too (they sit behind the
  same early return).

## F2 (P0, #6). Inbox events lack ids/names + JID canonicalization
- Canonicalize `@lid` JIDs before matchSubscription (reuse the store's
  canonical form) so 1:1 chats keyed by LID match their subscription.
- Extend the inbox event line: `{ts, kind, chat, from, text, media, id,
  chatName, senderName, fromMe}` — id enables reply/react without a
  re-query; names make summaries human.
- RED test for both.

## F3 (P0, #2). Hook installer keeps only one subscription
`packages/cli/src/hooks.ts` mergeHooks removes every existing wa-mcp
entry then adds one. The UI's model = one sub per chat.
- Key hook entries by sub id: `--sub <id>` appends a per-sub entry,
  `--remove --sub <id>` removes exactly one, other subs untouched.
- RED test: two merges with different subs → two entries; remove one →
  one left.

## F4 (P1, #4). Reply sends raw message id as text
`main.ts:583` builds `> ${replyToId}\n${text}`. The bridge supports
`reply_to_message_id` (http.ts:787).
- Client sends `reply_to_message_id`; composer shows a quoted preview
  with a cancel ✕; the id never appears in text.
- RED test at the api/client level.

## F5 (P1, #5 partial). drain exit-2 summary → stderr, one line per event
- Write the summary to stderr when exiting 2 (Claude Code feeds stderr to
  the model on exit 2).
- Emit one line per event (cap 20): chat name, sender, id, 60-char
  snippet, and a hint "use list_messages chat_jid=… to read more".
- RED test.
- Note in your report: the `asyncRewake` hook-key shape needs
  verification against real Claude Code docs — flag it, do not guess.

## Gates
vp test green (expect new RED→GREEN tests) · vp check 0 · report files +
counts + any finding you could not complete.
