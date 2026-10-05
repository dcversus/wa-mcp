# Opus usage ledger

| date | purpose | prompt | mode | outcome |
|---|---|---|---|---|
| 2026-10-04T22:43:10Z | Phase 2 notifications planning | /tmp/opus-phase2.md (3.3KB: state inventory + N1-N6 contract + constraints) | claude -p --model opus --permission-mode plan | DONE: 13-task plan T105-T117 (review/plans/PHASE2-OPUS-PLAN.md), key findings: push gap server.ts:190, V18/V19 migrations, /api/mcp-notify stream design |

## 2026-10-05T00:34:02Z — Phase 4 planning dispatch (opus, plan mode)
- Prompt: /tmp/opus-phase4-prompt.txt (Phase 4 gap inventory + owner rules; no code requested)
- Output: review/plans/PHASE4-OPUS-PLAN.md (T121-T130, 136 lines, exact acceptance checks + files + risks + live checks per task)
- Findings that changed the plan: serveTranscribe swallows all engine errors into 500 INTERNAL; mlx ENOENT mis-coded FFMPEG_UNAVAILABLE; no config store anywhere (config.json needed); transcripts PK lacks kind.
- Decisions taken by orchestrator: (1) GOAL re-ticks deferred to T130 with explicit ACCOUNTING delta; (2) zero-comments rule applies to new/edited lines only; (3) video transcription opt-OUT default (cost control) — will flip T126 to opt-in via include_transcript flag defaulting to false.
