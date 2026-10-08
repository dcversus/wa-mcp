# AUDIT R1 — campaign summary (live document)

Dimensions: D1 onboarding ✓ · D2 product flow ✓ · D3 QA deep-manual ✓ ·
D4 security (in flight). Auditor: opus, independent herdr pane, fresh
eyes. Fix executor: zai (TDD, verified by orchestrator).

## Verified-fixed (live, deployed)
- Chat rows clickable (D1 #1) — routing bug, fixed + CDP-probed
- Pairing poll storm (D1 #2) — 7 /health per 10s (was 1343+)
- Link-state gate + sync hint (D1 #3, #16)
- Connect-agent step + start output (D1 #4, #17)
- Real inbox paths + drain fails loudly (D1 #5)
- Pairing error recovery, de-personalized placeholder, paired-as identity (D1 #8 #10 #14)

## In fix wave 2 (zai, in flight)
- W1: subscriptions drop live inbound (D2 #1 — HERO KILLER, live-confirmed)
- W2: inbox event enrichment + @lid canonicalization (D2 #6)
- W3: hook installer one-sub bug (D2 #2)
- W4: reply sends raw id (D2 #4)
- W5: drain stderr + per-event lines (D2 #5)
- W6: formatWhen/formatDuration everywhere (D3 #1 #6 — UTC-as-local times)
- W7: read-error swallowing (D3 #2 — fake empty data under 429)
- W8: keyboard access + archived selector (D3 #4 #13)
- W9: hidden-state kills (D3 #3 #10 #5)
- W10: bridge JID validation (D3 #9)

## Queued (wave 3+)
- D1: #9 copy-paste-link relabel, #11 displayName layer, #12 status card, #13, #15, #19, #20, #21
- D2: #3 agent-inbox wizard, #7 automations page, #8 group admin wiring, #9 rule create-form, #10 search/new-chat/media-send, #12-#16 IA restructure
- D3: #11 copy feedback, #12 button-per-message, #14 contrast tokens, #15 labels/headings, #16 mobile layout, #17-#23 + full copy-rewrite table

## Wave 3 — security (DONE, live-verified)
- S1: uiBootstrapToken OFF /health → HttpOnly SameSite=Strict cookie on GET / (ADR 0012 addendum), bearer compat kept
- S2: Host guard on /health + static, runs before rate limits
- S3: no tokens painted; settings token = password type
- S4: frame-ancestors none, Referrer-Policy, media nosniff/sandbox/disposition
- S5: limiter anon-keying + TTL eviction
- S6: media relative names, events cap 500
- 1124/1124, e2e green with cookie auth

## Wave 4 — product polish (DONE, live-verified)
- P1 displayName + formatPhone everywhere; JIDs behind details
- P2 IA: Messages/People/Agent/Me/System; #/connect; unread+health+events → redirects; Unlink
- P3 human status card; diagnostics collapsed; token keys filtered
- P4 60-row copy rewrite
- P5 consistency + a11y (focus rings, aria, h1, title, tokens, primary/danger)
- P6 skeleton paint, retry banners, bridge-down auto-recovery
- 1155/1155, e2e green, CDP-verified (nav, redirects, status card, names, local times)

## Remaining for Round 2 entry
- D2 #3 agent-inbox wizard (pick chats → install command → send test event → delivery readout)
- D2 #7 automations page (autoreply/scheduled/rules read+delete)
- D2 #10 chat-core parity (message search, new chat, media send, chat header)
- D2 #8 group admin wiring; D1 #15 QR countdown; D1 #20 favicon
- Deferred security: ?token= tickets (D4#4), sessionStorage (D4#11), bind warning (D4#14)

## Round 2 (after the above)
Re-audit each dimension with fresh eyes; two clean passes = dimension closed.

## R2 WebUI restructure (owner canon 2026-10-07) — COMPLETE
Waves, all TDD, mechanically verified, live-probed, committed:
- R2-1 Logs page + /api/search filters (direction/from/since/until) + wa-mcp logs CLI + SubscriptionConfig model + /api/subs2 CRUD (1219)
- R2-2 Contacts true WhatsApp-Web parity (addOrEditContact/removeContact protocol), V23 fields, page + CLI; R2-2B backfill from chats+messages+lid_mapping (1259)
- R2-3 Connections: /api/connections scans 8 MCP hosts + hooks, disconnect preserves foreign entries, page + CLI (1287)
- R2-4 Subscriptions rebuild: dispatcher on subs2 (like/mentionOnly/prompt, inbox/session/spawn), /api/sessions, wizard UI with all delivery options, wa-mcp subs CLI, v1 migration + 410 (1342)
- R2-5 Connection settings: humanisation (delay+per-char+jitter+typing, OFF default) + send limits (min/hour/day/per-chat, 429+Retry-After, send_log), #/connection page, settings CLI (1382)
- R2-6 Help page (concepts + CLI reference + drift test), CLI parity matrix closed, 652 LOC dead code removed (1395)
Deploy gap lesson: kickstart can race the build write — verify the daemon's bundle is fresh (404-vs-200 route check) before live-verifying.
Open: Chats page keep/delete (owner decision); Round-2 re-audit; real-inbound dispatch check (owner sends 'live' to Test group).
