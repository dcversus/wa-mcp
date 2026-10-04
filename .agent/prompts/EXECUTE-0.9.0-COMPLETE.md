# EXECUTE: wa-mcp 0.9.0 — COMPLETE AND VERIFY. Version stays 0.9.0.

You are the implementing agent for the wa-mcp project. This prompt is your contract. Read it fully before touching anything. **The owner's verdict: 0.9.0 is NOT finished — verify everything, do not infer it.** Nothing gets re-versioned; this prompt closes 0.9.0 completely: full verification of every claim, full documentation, and QA/AQA review using the four installed skills.

## Mission

1. **VERIFY everything already claimed** — every GOAL.md tick (148/229), every VERIFY.md line, every "done" marker — mechanically, against real code and real runs. An unverified claim is a lie; fix it or remove it.
2. **CLOSE the remaining 81 unchecked boxes** or re-disposition them with evidence.
3. **SIMPLE agent notifications** — everything MCP provides natively + inbox-file streaming for agents to watch + hook-based chat subscriptions (web UI / MCP tool / CLI). Nothing heavier.
4. **DOCUMENT fully** — docs a stranger can install from (openclaw-refactor-docs workflow).
5. **QA/AQA** — systematic quality campaigns over the whole repo (auto-qa + test-audit + deslop skills, now installed at `.agents/skills/` and `.claude/skills/`).

Nothing is published. Deliverable = private repo `dcversus/wa-mcp` at **0.9.0**, green CI, `wa-mcp-0.9.0.tgz` (sha256 0fa2fb11… on record) never shipped.

## The owner's questions — code truth as of 2026-10-04, each a work item

1. **Subscriptions/notifications to the agent?** — NO today (SSE is browser-only; MCP clients get nothing pushed; `add_notification_rule` matches rules but delivers nowhere). **IN SCOPE — the SIMPLE version, Phase 2 below** (MCP-native push + inbox files + host hooks; research verified against current Claude Code + Codex docs).
2. **Web UI tool-call diagnostics?** — NO. Future work.
3. **QR + code signin CLI and web?** — PARTIAL (web: both; CLI: QR only, no `--code`). **IN SCOPE here — close it.**
4. `WA_CHANNEL` dual channel — SKELETON (select + webhook receive). Live Cloud stays owner-gated. **IN SCOPE — ADR + mock conformance.**
5. **Docs** — 23 files, 63/63 tools referenced, but no cookbook/troubleshooting/security-model. **IN SCOPE — full overhaul via openclaw-refactor-docs.**
6. **Voice/video parsing** — voice transcription exists (mock/openai-BYOK/mlx engines); no video transcription, no whisper.cpp optional, no transcript persistence. **IN SCOPE — close per below.**

## Phase 0 — Mechanical truth audit (before anything else)

For EVERY claim below, produce evidence or a fix. Record in `review/VERIFY.md` with ISO timestamps:

- `vp test` full-suite PASS with exact counts (currently claimed 839/839, 75 files — re-run, capture)
- `vp check` clean; `coverage:gate` green at 80/80/90 floors
- `pnpm run doc-coverage` → 63/63; `accounting:check` → 1,029 dispositioned
- GOAL.md 148 ticks: line-by-line, each tick backed by a VERIFY.md evidence line; untick anything unbacked
- CHANGELOG `## 0.9.0 (unreleased)` exists? — if missing, create from phase history
- ADRs 0001–0012 exist; 0012 matches current auth design (pairing token + stable UI token)
- `docs:build` green; release guard greps green; 8-platform sandbox registers green; fresh-container Docker install PASS
- WebUI e2e + webui-dogfood PASS on the CURRENT daemon build
- Live daemon: connected, loggedIn, 0 watchdog firings, /health honest
- Tarball `wa-mcp-0.9.0.tgz` sha256 `0fa2fb11…` reproducible from HEAD
- package.json version = 0.9.0 across all 6 packages + bin.ts + SERVER_INFO + device label — AND a CI guard preventing version drift (the 0.0.0 pack incident)
- CI: billing-blocked is documented in BLOCKED.md; CI green locally via act or equivalent
- CHANGELOG/README/docs don't promise anything the binary doesn't do

## Phase 1 — Close the remaining unchecked boxes

Go box-by-box through GOAL.md's 81 unchecked. For each: either implement (TDD), or re-disposition (OUT-OF-SCOPE-0.9 / NA-ENGINE with probe evidence / owner-gated → BLOCKED.md with proposed default). The 14-day dogfood, node≥22.5 ratification, WABA creds, npm claim, branch protection stay owner-gated. Every disposition needs a one-line reason + anchor.

## Phase 2 — Simple agent notifications (owner Q1, SIMPLE version)

Research baseline (verified 2026-10-04): our MCP protocol version (2025-06-18) natively provides `notifications/message`, `resources/subscribe` + `notifications/resources/updated`, `notifications/tools/list_changed`. Claude Code (current docs, v2.1.289 era) exposes hook events `FileChanged`, `SessionStart`, `Notification`, `Stop` + **`asyncRewake`** hooks (run in background; exit 2 wakes Claude with stderr as a system reminder — the built-in "agent reacts to external events" primitive). Codex exposes `~/.codex/hooks.json` with `mcp_tool`-type hooks. Build the SIMPLE bridge, nothing more:

- **N1 — MCP-native push**: honor `resources/subscribe` on `wa://` resources (chats, per-chat messages, unread, health) and emit `notifications/resources/updated` on change; emit `notifications/message` (logging channel) for connection lifecycle + rule matches; `notifications/tools/list_changed` when tools change. Server capability declared: `resources: { subscribe: true, listChanged: true }`.
- **N2 — Inbox files (the file the agent watches)**: each subscription writes an append-only JSONL inbox under `~/.wa-mcp/subs/<id>/inbox.jsonl` (one event per line: ts, kind, chat, from, text-snippet, media flag). Bounded: size-capped with rotation (keep last N MB), `dropped` counter in /health. Simple, inspectable, `tail -f`-able by humans too.
- **N3 — Subscribe from three surfaces**: (a) web UI — select chats/groups → subscription created with a shown inbox path + copyable hook snippet; (b) MCP tool `subscribe_events` / `unsubscribe_events` (filters: chat_jid, from_jid, kind, include_media) returning the inbox path; (c) CLI `wa-mcp subscribe --chat <jid> [--all] [--kind message,reaction]` / `wa-mcp unsubscribe`. All three manage the SAME subscription registry.
- **N4 — Hook installer (configurable, idempotent, reversible)**: `wa-mcp install --hooks claude [--inbox <id>]` writes a merge-safe `hooks` entry into `~/.claude/settings.json`: a `FileChanged` watch on the inbox file (plus an `asyncRewake` command-hook variant that tails the inbox and exits 2 with the new-event summary — wakes Claude so it REACTS); `wa-mcp install --hooks codex` writes the equivalent `~/.codex/hooks.json` entry (command hook calling a `wa-mcp events --since` reader). `--hooks --remove` undoes. Never clobber existing hooks; merge; back up before writing. Web-first flow needs NO terminal — hook install is the power-user path, and the web UI shows the snippet to paste for users who prefer that.
- **N5 — Wire notification rules to delivery**: `add_notification_rule` gains `deliver: ["mcp","file","ui"]` (file = append to a subscription inbox). No webhooks in this release.
- **N6 — Docs**: one cookbook page "React to WhatsApp messages from your agent" covering Claude Code (FileChanged + asyncRewake), Codex (hooks.json), and generic (tail the JSONL / MCP resources subscribe).
- TDD: resources/subscribe→updated round-trip (fake MCP client receives frame ≤2s after synthetic upsert); inbox JSONL append + rotation + cap; subscription registry CRUD from all three surfaces; hook installer writes valid settings.json/hooks.json shapes against fixtures, idempotent re-run, clean removal; asyncRewake command exits 2 with payload on new events; filter matrix. Live verify: subscribe to Test group via CLI, send one message, watch inbox file grow, hook command exits 2 once.

## Phase 3 — Sign-in symmetry (owner Q3)

- CLI `wa-mcp pair --code` (requestPairingCode → print 8-digit → wait), QR stays.
- Web UI: "use a code instead" toggle on the pairing page (bridge route exists: get_pairing_code).
- Absolute: web-first flow NEVER requires a terminal step (owner rule). CLI pair documented as headless path.
- TDD: bridge route tests (mock engine), CLI --code unit tests with fake daemon, web toggle e2e.

## Phase 4 — Voice/video/document understanding (owner PS)

- Transcript persistence: transcripts stored with the message and surfaced in `list_messages` — no re-transcribing history.
- Video messages → transcript (ffmpeg audio extract — already a dep).
- whisper.cpp local engine (optional, `WA_TRANSCRIBE_ENGINE=whisper-local`, structured fallback when binary absent — never a hard dep).
- BYOK config surface: `wa-mcp config set transcription.api_key` (0600 data-dir) + web Settings field; missing key + openai engine → structured error with setup instructions.
- PDF/DOCX text extraction into the transcript surface. Optional OCR behind `WA_OCR_ENGINE`, default none.
- `doctor --engines` reports availability + config validity per engine. TDD per type with fixtures.

## Phase 5 — Full documentation (owner Q5) — openclaw-refactor-docs workflow

Mandatory: load and follow `.agents/skills/openclaw-refactor-docs/SKILL.md` (facts inventory → classify page types → source-of-truth audit → move/keep/delete → rewrite → verify). No inferred defaults; every behavior-sensitive claim verified against source.

- VitePress IA: 3 getting-started paths (desktop web-first / headless CLI / Docker), generated configuration reference (EVERY env var; new env-doc-coverage script, CI-wired), cookbook, troubleshooting matrix (symptom→cause→fix, seeded from BLOCKED.md + every review finding), generated tool reference, security model, diagnostics guide.
- The implementing agent dispatches drafting to `claude -p --model opus` (owner's ~/.claude config, max effort) for cookbook + security-model + troubleshooting-matrix drafts; verifies every claim against file:line before landing. Claude CLI never commits.
- CLAUDE.md/AGENTS.md: how to add a tool/engine, how to run gates.

## Phase 6 — QA/AQA campaigns (the four skills, wired as gates)

**Setup already done**: skills installed at `.agents/skills/` + `.claude/skills/` (test-audit + CAMPAIGN.md, auto-qa + references, deslop, openclaw-refactor-docs), attribution in `.agents/skills/SOURCE.md`.

Wa-mcp mapping of openclaw-specific references (apply when the skill names something OpenClaw-specific):

| Skill says | wa-mcp equivalent |
|---|---|
| `scripts/run-vitest.mjs <filter>` | `npx vitest run <filter>` (or `vp test` full) |
| `scripts/check-changed.mjs --dry-run` | `vp check` |
| `$openclaw-testing` / `$openclaw-qa-testing` | `vp test` + this repo's gates (`review/GATES.md`) |
| `$crabbox` remote/Docker proof | `bash scripts/docker-install-test.sh wa-mcp-0.9.0.tgz` |
| `$autoreview` | independent reviewer pass: `claude -p --permission-mode plan` on the changed surface |
| `$openclaw-pr-maintainer` / `scripts/pr` | direct commit to main (single-maintainer repo) |
| Control UI / gateway / agents.list | wa-mcp web UI / bridge daemon / MCP tools |
| QA Lab scenarios / `qa/scenarios/index.yaml` | `scripts/webui-e2e.mjs` + webui-dogfood + live probes per `review/GATES.md` live rules |
| `codex/` worktrees | herdr workspace worktrees; zai agent executes, orchestrator verifies |

**Gate A — test-audit (authoring gate + audit sweep)**: load `.agents/skills/test-audit/SKILL.md`. (1) Apply the four authoring questions + junk-pattern checklist to every NEW test this phase adds. (2) Run one audit sweep of existing tests hunting the junk patterns (mocks-implement-the-asserted-behavior is the proven killer here: http.test.ts:108 mocked fetchHistory while live fetchHistory 500'd). Evidence fields per candidate before editing. Optimize for confidence, not deletion count.

**Gate B — auto-qa campaign**: load `.agents/skills/auto-qa/SKILL.md`. Adapt: single-machine herdr fleet, zai executor + independent reviewers (claude -p read-only/plan, grok, codex exec). Target: **25 distinct, independently verified, actually-landed root-cause fixes** (scaled from 100 for repo size; owner may raise). Numbered evidence ledger in `review/AUTO-QA-LEDGER.md` (hypotheses → reproduced → verified → landed, with exact SHAs; preserve history on target change). Root-cause refactors over quick fixes; reject symptom-masking guards. Security/persistent-state/protocol changes → user review required, outside count. Lanes: bridge http/dispatch, lifecycle+watchdog, send+canonicalization, store+migrations, ingest+media, MCP server, CLI+platforms, web UI, scheduler, security gate. ≥10 lanes in flight during campaign waves.

**Gate C — deslop before every review**: load `.agents/skills/deslop/SKILL.md`. Diff-scoped slop pass (comment slop, defensive-check slop, type-laundering, compatibility shims without removal plan) on every branch diff before independent review. No functional edits; report 1–3 sentences. Runs BEFORE autoreview, never instead of it.

**Gate D — autoreview (independent review)**: after Gates A–C on each batch: fresh `claude -p --permission-mode plan` (or grok/codex) review of the complete diff. Reviewer must confirm clean root-cause solutions, reject quick-fix residue even when green. Resolve verified findings, re-review substantive changes.

**Evidence law (all phases)**: every claim → command + output + ISO timestamp in VERIFY.md; agent self-reports are NOT proof — the orchestrator re-runs everything mechanically; live E2E on the real daemon before every wrap (mock-green ≠ working, proven 4× this cycle).

## Phase 7 — Final verification + packaging

- Full gate re-run: vp test + vp check + coverage:gate + doc-coverage (all tools) + env-doc-coverage (new) + accounting:check + docs:build + release-guard greps + 8-platform sandbox + fresh-container Docker + webui-e2e + live smoke on the real account (rules in GATES.md).
- Repack: `bash scripts/pack-release.sh` → `wa-mcp-0.9.0.tgz` + sha256. Version-drift guard proves the name.
- GOAL.md fully dispositioned: every box ticked-with-evidence or dispositioned-with-anchor; no silent boxes.
- Final report: checkbox count, gate table, tarball + sha256, ACCOUNTING deltas, VERIFY line count, BLOCKED contents, **"PUBLISH NOT PERFORMED"**.

## Claude CLI (Opus) — planning + verification, budget-aware

The owner's Anthropic plan has usage limits; opus tokens are spent deliberately, never mechanically. Rules:

- **Who does what**: zai (the herdr executing agent) does ALL mechanical implementation, tests, commits. The Anthropic CLI (`claude -p --model opus`, owner's ~/.claude config) is reserved for what needs its judgment: (a) phase-planning review, (b) documentation drafting, (c) independent verification review. Never dispatch opus for code edits, greps, or routine fixes.
- **Batch, don't drip**: one opus dispatch per phase-gate, not per task. Write the dispatch prompt ONCE, completely (context, constraints, exact questions, expected output shape), get one meaty answer. A dispatch that asks one small question is a wasted one.
- **Planning** (Phases 0–2 entry): before each phase, ONE `claude -p --model opus --permission-mode plan` dispatch: "here is the phase contract + current code state (paths listed); produce the ordered task breakdown, risk list, and the exact acceptance check per task." The orchestrator then slices that into one-task-at-a-time dispatches for zai.
- **Docs drafting** (Phase 5): cookbook + security-model + troubleshooting-matrix drafts in ONE or TWO opus dispatches each with a tight outline + source-file inventory attached; zai + orchestrator then verify every claim against file:line and land it.
- **Verification review** (Gate D): `claude -p --model opus --permission-mode plan` on the complete final diff per batch — but only at batch boundaries, not per commit. Where a cheaper independent reviewer suffices (grok, codex exec read-only), use it first and reserve opus for disputed/high-risk surfaces.
- **Token hygiene**: prefer `--permission-mode plan` (no side effects), pin narrow file lists in prompts, reuse session context where the CLI supports it, and record every opus dispatch (date, prompt summary, purpose) in `review/OPUS-USAGE.md` so spend is visible. If the plan's rate limits hit, fall back to zai + grok reviewers and note it — never block the pipeline on one reviewer.

## Process (non-negotiable, carried)

TDD RED→GREEN; zero comments in source; conventional commits, each leaves `vp check && vp test` green; coverage floors enforced; live rules unchanged (allowed chats: Test group + owner + Vasilisa; round-trips; pairing budget 3 + owner consent; mock engines default); one small task → zai executes → orchestrator validates mechanically → next; Telegram report every milestone/blocker; BLOCKED.md with proposed defaults when blocked.
