# EXECUTE: wa-mcp 0.10.0 — "Deep Operations" — implemented, tested, committed. NOT published.

You are the implementing agent for the wa-mcp project. This prompt is your contract. Read it fully, then read GOAL-0.10.md fully, before touching anything.

## Mission

Take wa-mcp from "feature-complete 0.9.0" to "deep, production-grade 0.10.0": real-time agent subscriptions, full diagnostic observability, dual-channel parity, voice/video understanding, and documentation that an outside engineer can install from without asking a question. The owner's verdict on 0.9.0: **"current implementation is too raw."** This release closes that gap.

Nothing is published: no npm publish, no registry listings. Deliverable = private repo at 0.10.0, green CI, packed tarball never shipped.

## The owner's five questions — answered with today's code truth, each becomes a work item

1. **Subscriptions/notifications to the agent from incoming messages?** — NO. `/events` SSE serves browsers only; MCP clients get nothing pushed. `add_notification_rule` matches rules but has NO delivery channel — matched notifications go nowhere. → §A fixes this for real.
2. **Web UI full history/diagnostics of tool calls?** — NO. Zero tool-call surface in the web UI. → §B.
3. **CLI + web UI sign-in with QR AND code?** — PARTIAL. Web UI: QR yes + pairing code display yes. CLI: `wa-mcp pair` exists — verify QR render + add `--code` flow. → §C.
4. **Dual channel (official Meta Cloud API)?** — SKELETON. `channels/cloud` selects the channel and receives webhooks; sending, media, and read-state through Cloud API are not at parity with the Baileys channel. → §D.
5. **Proper and consistent documentation?** — PARTIAL. 23 docs files, 63/63 tools referenced, but getting-started assumes knowledge, no cookbook, no troubleshooting matrix, ADRs lag the new subsystems. → §E.

## Source of truth

1. `GOAL-0.10.md` — you create this FIRST (from this prompt) as the checkbox ledger, mirroring GOAL.md's structure. Every item below becomes a numbered, verifiable checkbox. Never invent scope beyond this prompt; bright ideas → `review/IDEAS.md`.
2. `GOAL.md` (0.9.0) — read-only history. Do not re-litigate.
3. `review/INDEPENDENT-REVIEW2-*.md` — three reviewer reports; their Low findings and anything deferred lands here as explicit checkboxes or is ACCOUNTING'd out.
4. Engine truth from the fork's types and runtime probes, never assumptions.

## A. Real-time agent subscriptions (the headline feature)

- **MCP `notifications/message` push**: when an MCP client sends `notifications/initialized`, the server subscribes it to the bridge event bus and pushes `notifications/message` frames (spec-compliant: method, params with message envelope) for inbound messages. Honor a client capability declaration — only push to clients that opt in via the init handshake or a `subscribe` tool call.
- **`subscribe_events` / `unsubscribe_events` MCP tools**: filter by chat_jid, from_jid, kind (message/reaction/poll/read/receipt/error), include_media flag. Subscription registry survives reconnects (stdio transport: reconnect = new session = new registry, document that).
- **Notification rules get DELIVERY**: matched rules fire into (a) MCP push for connected agents, (b) an outbound **webhook** (owner-configurable URL, HMAC signature, retry with backoff, dead-letter after N), (c) the web UI toast + log. `add_notification_rule` gains `deliver: ["mcp","webhook","ui"]`.
- **SSE for agents**: `/events?stream=messages` documented as the HTTP-client subscription surface (already exists — document + test contract).
- Backpressure: bounded queue per subscriber, drop-oldest with a `dropped` counter surfaced in /health; slow agent must never block the ingest path.
- TDD: fake MCP client (ws/stdio) receives a pushed frame within 2s of a synthetic upsert; filter matrix; webhook delivery with signature verification test; backpressure test with a stalling client.

## B. Observability — tool-call + event diagnostics in the web UI

- **Tool-call ledger**: every MCP `tools/call` and every `/api/*` mutation is recorded (timestamp, tool/route, arguments-redacted, duration, result-status, error text, correlated request-id). New table + retention (default 7d, env-tunable). NEVER log message bodies at rest by default — configurable `WA_DIAG_LOG_BODIES=1` for debug.
- **Web UI Diagnostics page** (`#/diagnostics`): live tail of the tool-call ledger, filter by tool/chat/status, per-tool latency percentiles, error-rate panel, restart-safe (reads the ledger table). Zero-framework discipline stays (no React/Vue; existing patterns).
- **Event inspector**: `#/events` page listing the raw bridge event bus (same safe-set as SSE) with pause/capture.
- **`/health` deep fields**: subscriptions active, webhook queue depth, ledger size, per-tool p95 from the ledger.
- TDD: ledger row per call (integration through the mcp-server), redaction test (bodies never persisted unless enabled), diagnostics page renders from a seeded ledger.

## C. Sign-in everywhere — QR + code, CLI + web, symmetric

- **CLI**: `wa-mcp pair` renders QR (terminal block + PNG path, cp1252-safe) AND accepts `--code 12345678` (requests an 8-digit code via the engine's requestPairingCode, prints it, waits for link). Verify live once (budget: 3 attempts max, owner consent before any registration).
- **Web UI**: pairing page shows QR (exists) AND a "use a code instead" toggle that requests + displays the code (bridge route exists: get_pairing_code tool; wire the page).
- **Both flows must never expect a terminal step after first install** (owner rule, absolute): the web UI remains the primary surface; CLI pair is for headless servers, documented as such.
- TDD: code-flow bridge route tests (mock engine), CLI pair --code unit tests with a fake daemon, web pairing toggle e2e.

## D. Dual channel — Meta Cloud API parity (channel interface completion)

- Define the `Channel` interface contract formally (send matrix, media, read-state, presence, group ops) with a conformance test suite BOTH channels must pass (mock transport for Cloud).
- Cloud API: send text/media/template, mark read, download media, phone-number-id resolution. Webhook ingest already exists — extend to delivery-status → read-state rows.
- `wa-mcp doctor` reports the active channel + config validity for both.
- Channel switch is a documented, reversible operation (env `WA_CHANNEL=cloud|baileys`), with an ADR explaining the trust/latency/feature trade-offs.
- Live Cloud testing stays OWNER-GATED (WABA creds in BLOCKED.md); everything else ships behind the mock conformance suite.

## E. Voice & media understanding (the owner's PS, made concrete)

- **Voice messages**: transcription pipeline exists (mock/openai-BYOK/mlx). Add:
  - `whisper.cpp` LOCAL engine (optional dependency, `WA_TRANSCRIBE_ENGINE=whisper-local`, model path env; falls back with a structured error if the binary is absent — never a hard dependency).
  - **BYOK config surface**: `wa-mcp config set transcription.api_key …` (stored 0600 in the data dir, never in the repo) + the same via web UI Settings page. No key + engine=openai → clear structured error with setup instructions.
  - `transcribe_voice` auto-persist: transcripts land in the messages table (new column or transcript sidecar) and surface in `list_messages` output (`transcript` field) — agents read history without re-transcribing.
- **Video messages**: `transcribe_message` accepts video notes (extract audio via ffmpeg → engine) — ffmpeg is ALREADY a dependency (PTT path). Same engine factory, same persistence.
- **Document messages**: PDF/text extraction (pdf.js or pdftotext optional dep) into the same transcript surface. DOCX plain-text extraction.
- **Caption + OCR for images**: optional (Tesseract via an engine flag) — ship behind `WA_OCR_ENGINE=none|tesseract`, default none.
- Every engine is optional-or-BYOK, each with a doctor check (`wa-mcp doctor --engines`) reporting availability + config validity. TDD with fixture media per type.

## F. Documentation — "an engineer installs without asking"

- **VitePress site overhaul**: information architecture — Getting Started (3 paths: desktop web-first / headless CLI / Docker), Configuration reference (EVERY env var, every flag, generated table from the config schema), Cookbook (send a poll, run an agent with subscriptions, dual-channel setup, BYOK transcription, import from lharries/gofork), Troubleshooting matrix (symptom → cause → fix, seeded from every BLOCKED.md + review finding), MCP tool reference (generated from tools.ts — name, description, schema, annotation, example call), Security model page (token, pairing, ADR 0012 + the 0.10 trust-boundary addendum), Diagnostics guide (the new §B surface).
- **ADR catch-up**: 0013+ for subscriptions architecture, tool-call ledger (privacy trade-off), dual-channel contract, transcription engine factory. ADRs are written BEFORE the code they describe.
- **CLAUDE.md / AGENTS.md** updated: the repo's own contributor docs explain how to add a tool (schema → bridge route → tests → docs → doc-coverage), how to add an engine, how to run the gates.
- `docs:build` green, doc-coverage 100% of tools, and a NEW doc-coverage for env vars (every env var in code appears in the configuration reference — script, CI-wired).
- **This release's docs are PLANNED AND WRITTEN with the Anthropic CLI (claude -p, Opus plan)**: the implementing agent MUST dispatch documentation drafting to `claude -p --model opus` (or the claude CLI with the owner's ~/.claude config, max effort) for: the cookbook, the security model page, and the troubleshooting matrix — then verify factual accuracy against the code itself (every claim gets a file:line check by the implementing agent). Human-reviewable drafts land in docs/ via the agent; the claude CLI never commits directly.

## G. Hardening carry-overs (close the reviewers' tail)

- Every remaining Low finding from all three review reports: triaged into checkboxes here or explicitly ACCOUNTING'd.
- The `search_messages` param naming (`q` vs `query`) — align schema + docs.
- Leftover empty `scheduled` table → cleanup migration (v15) with a data-preserving check.
- `merge-lid-chats` dropping deleted/edited/reactions/poll/labels (codex-M) → full-fidelity migration rewrite.
- Message-id-only lookups: complete the chat-scoping sweep (runtime-M1 follow-up audit: every route taking a message id).
- Load test: 10k messages ingested through the store in <30s with FTS on (M3 regression guard).
- Chaos test: daemon killed mid-batch-send → restart → no double-sends (scheduler idempotency), no lost scheduled rows.

## Process (non-negotiable, carried from 0.9.0)

- TDD strictly: RED → GREEN per checkbox, RED evidence in commits, zero comments in source, docs explain.
- Live testing rules unchanged (allowed chats, round-trip asserts, VERIFY.md with ISO timestamps, pairing budget 3 + owner consent, mock engines by default).
- One small task → agent executes → orchestrator (Hermes) validates mechanically → next. Live-probe verification before every wrap: the 0.9.0 review round proved mock-green ≠ working.
- Conventional commits; every commit leaves vp check + vp test green; coverage floors 80/80/90 enforced (coverage:gate is wired).
- GOAL-0.10.md checkboxes earn ticks only with VERIFY.md evidence lines (test name + output, or live note with timestamp).
- When blocked: BLOCKED.md entry with proposed default, continue non-blocking work.

## Phasing (gates hard, gate records to review/GATES-0.10.md)

- Phase A0: GOAL-0.10.md ledger authored + owner approval of scope (this prompt printed to the owner is the offer).
- Phase A: subscriptions + webhook delivery (§A) — the headline.
- Phase B: observability (§B).
- Phase C: sign-in symmetry (§C).
- Phase D: dual-channel contract + cloud parity behind mocks (§D).
- Phase E: voice/video/document understanding (§E).
- Phase F: documentation (§F, claude-CLI-driven planning+drafting with verification).
- Phase G: hardening carry-overs (§G) + full gate re-run + repack + fresh-container + live smoke.

## Final report format (unchanged)

Checkbox count, gate table A→G, tarball name + sha256, ACCOUNTING deltas, VERIFY.md line count, BLOCKED.md contents, and: "PUBLISH NOT PERFORMED" with every deferred publish action listed.
