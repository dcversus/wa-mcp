# Opus usage ledger

| date | purpose | prompt | mode | outcome |
|---|---|---|---|---|
| 2026-10-04T22:43:10Z | Phase 2 notifications planning | /tmp/opus-phase2.md (3.3KB: state inventory + N1-N6 contract + constraints) | claude -p --model opus --permission-mode plan | DONE: 13-task plan T105-T117 (review/plans/PHASE2-OPUS-PLAN.md), key findings: push gap server.ts:190, V18/V19 migrations, /api/mcp-notify stream design |

## 2026-10-05T00:34:02Z — Phase 4 planning dispatch (opus, plan mode)
- Prompt: /tmp/opus-phase4-prompt.txt (Phase 4 gap inventory + owner rules; no code requested)
- Output: review/plans/PHASE4-OPUS-PLAN.md (T121-T130, 136 lines, exact acceptance checks + files + risks + live checks per task)
- Findings that changed the plan: serveTranscribe swallows all engine errors into 500 INTERNAL; mlx ENOENT mis-coded FFMPEG_UNAVAILABLE; no config store anywhere (config.json needed); transcripts PK lacks kind.
- Decisions taken by orchestrator: (1) GOAL re-ticks deferred to T130 with explicit ACCOUNTING delta; (2) zero-comments rule applies to new/edited lines only; (3) video transcription opt-OUT default (cost control) — will flip T126 to opt-in via include_transcript flag defaulting to false.

## 2026-10-05T01:10:34Z — Phase 5 docs drafting dispatch (opus, plan mode)
- Prompt: /tmp/opus-phase5-prompt.txt (3 pages: security-model expansion, troubleshooting matrix, diagnostics guide; source inventory + VERIFY-MARKER protocol)
- Output: 474 lines → landed as docs/security.md (15KB, 50 src anchors), docs/troubleshooting.md (8.3KB, matrix format), docs/diagnostics.md (8.5KB).
- Opus corrected the brief 8× — all verified against source before landing: /health flat fields (no watchdog key, has uiBootstrapToken+reconnects), bridge deps = baileys/pino/qrcode+terminal (ADR 0002 'zero-dep' scope = hand-rolled core), kill-switch order (after guard reserve), rate-limit keying (API=IP+sha256(token) http.ts:2360, health 120/min IP, UI 240/min, /events unlimited), /api/pair/resume needs account token (ADR 0012 addendum), stdio pump → /api/mcp-notify (not GET /mcp), doctor checks token-file mode not 'token mode'.
- 14 VERIFY-MARKERs resolved mechanically: node major 22 (bin.ts:317), deny-list allow-skip (send-rules.ts:59), non-constant-time webhook verify_token (webhooks.ts:14, owner-gated skeleton — noted as gap), dataDir chmod 0700 (bin.ts:70-71), MCP sessions in-memory no-TTL (http.ts:1445), messages columns (schema.ts:26), proto-media fix = T107b aca4144.
- Spot-verified after landing: bucket keys, /health shape, inbox path format. docs:build EXIT 0.

### Gate D opus dispatches — Phase 6 (2026-10-05T02:23:28Z)

- Dispatch 1: full Gate B diff (25d6052^..HEAD, 450 lines) review → verdict NOT CLEAN (1 blocker, 5 majors, 3 minors). All findings mechanically verified before fixing (blocker confirmed live: bin.ts:260 still DEFAULT_DATA_DIR).
- Dispatch 2: re-review of the fix wave (799-line diff) → verdict NOT CLEAN (new blocker: readCappedLines per-line handleStream reset MCP sessions; residue: per-row write_seq). Both fixed + minors (dedupe kinds check, CLI empty entries, Retry-After empty/cap, strong --data-dir wire assertion).
- Both dispatches: claude -p --model opus --permission-mode plan; prompts + verdicts at /tmp/opus-gated.md, /tmp/opus-rereview.md (preserved in session log).

### Opus dispatch — WebUI usable-round review (2026-10-05T13:11:58Z)

- Scope: 1df0a40..HEAD (3 commits: stats-format, redesign, usable-round W1-W3), 1921-line diff, Gate C deslop clean beforehand.
- Verdict: NOT CLEAN — 1 BLOCKER (B1: new profile controls never wired — handlers bind dead #name-form/#privacy-form selectors; no setProfileStatus client method; read/write privacy key mismatch), 4 MAJORS (M1 latch semantics + retry-storm risk, M2 stale stored token strands UI after daemon restart — "likely the REAL cause of the owner's paired-then-401", M3 /api/me name fallback returns the RECIPIENT's digits for 1:1 fromMe messages — one save would rename the owner to a contact's number, M4 picker races/duplicate subs/silent failures), 11 minors (CSS regressions: .chat-main flex, .messages scroll, send-box sticky, no mobile breakpoint; orphaned styles vs unstyled markup; dead privacyMatrixHtml; weak t141 assertions; unescaped initials).
- Orchestrator mechanically verified B1 + M3 before dispatching fixes (grep: handlers bind dead selectors; senderNameOf fallback = recipient digits).
- Fix round dispatched to zai (brief: .agent/prompts/WEBUI-REVIEW-FIXES.md, order B1→M3→M1+M2→M4→minors).
- Review preserved: .agent/prompts/OPUS-WEBUI-REVIEW.md + /tmp/opus-webui-review.md.
