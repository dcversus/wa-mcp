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

## Round 2 (after fixes)
Re-audit each dimension with fresh eyes; two clean passes = dimension closed.
