# TASK: FIX WAVE R1-2 — D2 P0s (hero path) + D3 top P1s (TDD, no commit)

Read these first: review/AUDIT-R1-D2.md (findings 1-6),
review/AUDIT-R1-D3.md (findings 1-4 + TOP-5). All evidence is there.

TDD each fix. vp check 0, full suite green. Zero comments. No commit.

## Priority 1 — D2 P0s (the hero feature is dead)

### W1. Subscriptions drop live inbound (D2 #1) — HIGHEST PRIORITY
http.ts:497 drops `notify` (the real-time inbound type). Fix:
- Accept notify + append; skip fromMe by default.
- Update t107/t116 which pin the WRONG behavior (they only emit append).
- RED: notify from non-own JID → inbox line; fromMe append → nothing;
  notification rules evaluated for notify traffic.

### W2. Inbox event enrichment + JID canonicalization (D2 #6)
- Canonicalize @lid → phone JID before matchSubscription.
- Event line gains: id, chatName, senderName, fromMe.

### W3. Hook installer one-sub bug (D2 #2)
- mergeHooks keys entries by sub id (--sub appends, --remove --sub removes one).
- RED: two subs → two entries; remove one → one left.

### W4. Reply sends raw id as text (D2 #4)
- Client sends reply_to_message_id; quoted preview + cancel; id never in text.

### W5. drain exit-2 → stderr, one line per event (D2 #5 partial)
- stderr on exit 2; per-event lines (cap 20) with chat name/sender/id;
  hint line. Flag asyncRewake hook-shape as unverified in your report.

## Priority 2 — D3 P1s (wrong data / lost state)

### W6. formatWhen/formatDuration helper (D3 #1+#6, C7)
- One helper: today → HH:MM local, this week → weekday, else → "6 Oct".
  Durations: "1 d 0 h", relative: "2 h ago".
- Apply: chat list times, bubbles, day separators ("Today/Yesterday/Mon 5 Oct"),
  status uptime + lastDisconnectAt, events feed, context view.
- RED: fixed ISO input → expected local output (inject TZ in test env).

### W7. Stop swallowing read errors (D3 #2)
- Remove per-call .catch(() => empty) in profile/subscriptions/status
  loaders; let guardLoader banner. Per-section "couldn't load — retry"
  where partial render matters. Disable privacy selects with unknown values.

### W8. Keyboard access + archived selector (D3 #4+#13)
- Chat rows: <a href="#/chat/<jid>"> (if not already in the D1 wave).
- Group details toggle: <button aria-expanded>.
- Fix .chat-list.hide-archived li[data-archived="1"] selector + test.

### W9. Hidden-state kills (D3 #3+#10+#5)
- Contacts: echo query into input; "No contacts match 'x' — Clear search".
- Events: pause label from state; don't full-re-render on timer.
- Send: keep focus, keep mediaToken, append bubble instead of full re-render
  (or re-run the loader path), re-bind extras.

### W10. Bridge input validation (D3 #9)
- Shared isJid() in @wa-mcp/shared; 400 on /api/subscriptions +
  /api/block with "That doesn't look like a WhatsApp number or group".

## Report
Files changed, RED→GREEN test list, counts, anything deferred.
