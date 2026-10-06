# TASK: FIX WAVE R1-4 — product polish: IA + identity + copy + status card (TDD, no commit)

Read first: review/AUDIT-R1-D1.md (#11 #12), review/AUDIT-R1-D2.md
(#3 #7 #9 #10 #12 #13 #14 #16), review/AUDIT-R1-D3.md (COPY REWRITE
TABLE + CONSISTENCY TABLE — these are your specifications, apply them).

TDD where logic changes; markup/copy changes need at least snapshot-ish
assertions (render the page fn with fixture input, assert key strings).
vp check 0, suite green, zero comments, no commit.

## P1. displayName identity layer (D1 #11, C18)
- shared helper: displayName(jid, contacts, aliases) → contact/alias
  name | formatted phone (+358 49 777 3518) | "Unknown".
- Apply EVERYWHERE: unread rows, contacts list, subscriptions rows,
  picker rows, blocklist, leave-confirm, rule rows.
- JIDs move behind a "details" disclosure (small <details> element).
- RED: helper unit tests + rendered-page assertions for unread/contacts.

## P2. IA restructure (D2 #12 #13, D3 copy table nav rows)
- Nav becomes: Messages (Chats) / People (Contacts) / Agent (Connect,
  Alerts) / Me (Profile) / System (Connection, Settings).
- /#/unread folds into a Chats filter tab (All/Unread/Groups/Archived).
- /#/health + /#/events redirect to /#/status.
- /#/pairing relabeled "Link phone"; when linked shows "Unlink this
  computer" (uses /api/logout) instead of pairing content.
- 404 nav highlight fixed.
- RED: router tests for redirects + route table; nav render test.

## P3. Status → human card (D1 #12, D3 #6, copy table)
- Top: "✅ Linked as Versus (+358 46…) · online · last reconnect 2 h ago
  · running for 1 d 0 h · 1 agent subscription" (uses /api/me + formatDuration).
- "Recent activity" = bounded live feed (existing appendEvent).
- "Notification rules" section renamed from "pairing rules", moved under
  Agent nav (leave a redirect stub on status).
- Raw /health dump collapses into <details>Diagnostics</details>, minus
  any token keys.
- RED: formatDuration cases; status render contains human card, no
  token keys, no raw epoch.

## P4. Copy rewrite pass (D3 COPY REWRITE TABLE — all 60 rows)
- Apply every row. Placeholders get aria-labels. Privacy enums get
  WhatsApp labels (Everyone / My contacts / My contacts except… /
  Nobody). Engines get human names. Errors get Retry buttons.
- The subscriptions page copy: "Agent alerts" language, "Your agent
  watches 1 of 2 chats", "Stop watching", install command surfaced with
  Copy → "Copied ✓".
- RED: page-fn assertions for the new strings (one test per page).

## P5. Consistency pass (D3 C1-C16)
- One .list reset (no browser bullets). Sentence case everywhere.
- .primary on each form's main action; .danger on destructive.
- Font-size tokens --fs-xs/sm/md/lg; snap radii/spacing to tokens.
- Fix dead selectors (C12): #send-box, button.primary, .section-label,
  #group-participants, #link-input.
- Focus ring: outline 2px var(--accent) (kills the 1.13:1 ring).
- aria-label on every input; one h1 per page; document.title per page;
  aria-current on nav; dir="auto" on message text.
- RED: a11y-focused render assertions (h1 exists, aria-labels present).

## P6. Empty/loading/error states (D2 #10 partial, D3 #7 #8)
- Nav + skeleton paint immediately on hashchange.
- errorBannerHtml gains a Retry button; while bridgeDown poll /health
  2s and auto-recover; 429 auto-retry once after retryAfterMs.
- Empty states per D3 copy table (unread, events, rules, blocklist get
  empty states; chats empty state distinguishes syncing vs truly empty).
- RED: guardLoader retry behavior; render assertions.

Report: per-P summary, RED→GREEN list, gates, anything deferred.
