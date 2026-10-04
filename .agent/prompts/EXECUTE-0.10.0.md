# EXECUTE: wa-mcp 0.10.0 — "Deep Operations" — implemented, tested, committed. NOT published.

You are the implementing agent for the wa-mcp project. This prompt is your contract. Read it fully, then read GOAL-0.10.md fully, before touching anything.

## Mission

Take wa-mcp from "feature-complete 0.9.0" to "deep, production-grade 0.10.0": real-time agent subscriptions, full diagnostic observability, dual-channel parity, voice/video/document understanding, full parity with every capability found in the reference WhatsApp MCPs — and documentation an outside engineer can install from without asking a question. The owner's verdict on 0.9.0: **"current implementation is too raw."** This release closes that gap.

Nothing is published: no npm publish, no registry listings. Deliverable = private repo at **0.10.0** (bump version on day one), green CI, packed `wa-mcp-0.10.0.tgz` never shipped.

## The owner's five questions — code truth, each a work item

1. **Subscriptions/notifications to the agent?** — NO. `/events` SSE serves browsers; MCP clients get nothing pushed; `add_notification_rule` matches rules but delivers nowhere. → §A.
2. **Web UI tool-call diagnostics?** — NO. → §B.
3. **QR + code signin, CLI and web?** — PARTIAL (web has both; CLI has QR pair, no `--code`). → §C.
4. **Dual channel (official Meta Cloud API)?** — SKELETON (channel select + webhook receive only). → §D.
5. **Proper consistent documentation?** — PARTIAL (23 files, 63/63 tools, no cookbook/troubleshooting/security-model). → §F.

## Source of truth

1. `GOAL-0.10.md` — create FIRST from this prompt as the checkbox ledger (mirror GOAL.md structure). Every section below becomes numbered verifiable checkboxes. No scope beyond this prompt; ideas → `review/IDEAS.md`.
2. `GOAL.md` (0.9.0) — read-only history.
3. `review/BACKLOG-FULL.md` (1,029 items) + `review/ACCOUNTING.md` — the parity mine: every OUT-OF-SCOPE-0.9 row that is a real FEATURE (not packaging noise) is re-triaged here or explicitly re-deferred with reason. `review/INDEPENDENT-REVIEW2-*.md` — reviewer Low findings become checkboxes.
4. Engine truth from the fork's types + runtime probes, never assumptions.

## A. Real-time agent subscriptions — MCP-native first, host hooks as delivery, everything configurable (headline)

RESEARCH BASELINE (verified against the spec, 2025-06-18 + 2026-07-28 drafts): the protocol itself provides: `resources/subscribe` + `notifications/resources/updated` (resource-level push), `notifications/message` (logging/notification stream), `notifications/tools/list_changed`, server→client requests `sampling/createMessage` and `elicitation/create`, and a Triggers-and-Events WG working on standardized webhooks. Claude Code exposes hooks (`command`/`http`/`mcp_tool` types) on SessionStart/UserPromptSubmit/PostToolUse/Stop/Notification; Codex mirrors this in `~/.codex/config.toml` + hooks.json with `mcp_tool` hook type; Pi is our own agent (direct bridge). USE MAXIMUM NATIVE PROTOCOL FIRST, then host integration as CONFIGURABLE delivery.

- **A1 — MCP resources subscription (spec-native)**: expose WhatsApp data as MCP resources — `wa://chats`, `wa://chats/{jid}/messages`, `wa://chats/{jid}/unread`, `wa://status`, `wa://health` — with `resources/subscribe` honored and `notifications/resources/updated` pushed on change (new message → chats resource + that chat's messages resource). Server capability: `resources: { subscribe: true, listChanged: true }`. Clients that already speak MCP subscriptions get push for free — no custom protocol.
- **A2 — `notifications/message` channel**: spec-compliant logging/notification stream (the protocol's own push-notification method) for connection lifecycle + rule matches, severity-leveled; clients opt in via `logging/setLevel` where supported.
- **A3 — `wa-subscribe` MCP prompt + tools**: `subscribe_events`/`unsubscribe_events` tools (filters: chat_jid, from_jid, kind, include_media) driving BOTH the resource-subscription engine and the notification-rule engine; subscriptions registry per-session. Bounded queues, drop-oldest, `dropped` counters in /health; a slow agent NEVER blocks ingest.
- **A4 — Notification rules get DELIVERY** — `deliver: ["mcp","webhook","ui"]`: MCP push to connected agents; outbound **webhook** (HMAC-SHA256 signature, exponential-backoff retry, dead-letter after N, `WEBHOOK_ENABLED` opt-out — verygoodplugins I#150/PR#195 lessons baked in); web UI toast + log. Payload: canonical PN jids (PR#56), preserved message ids (PR#220), reaction events (PR#129).
- **A5 — Host hooks installer (`wa-mcp install --hooks <targets>`, everything configurable)**:
  - **Claude Code**: write a `hooks` block into `~/.claude/settings.json` (merge, never clobber): `Notification`/`SessionStart` hook type `http` or `command` pointing at the bridge's local relay (or type `mcp_tool` against our own server where the host supports it) so incoming WhatsApp events surface in the agent's own attention flow; per-event config (on_message, on_reaction, on_mention, on_question).
  - **Codex**: same via `~/.codex/hooks.json` / `config.toml` `[hooks]` tables (mcp_tool hook type: server "wa-mcp", tool e.g. `wa_relay_event`).
  - **Pi / Hermes / any HTTP consumer**: document + test the SSE + webhook surfaces as the generic path (Pi already talks to the daemon directly).
  - All hook installs are idempotent, reversible (`wa-mcp install --hooks --remove`), config-file documented, and NEVER require a terminal step for the web-first flow (hooks are an opt-in power-user path, documented as such).
- **A6 — SSE `?stream=messages`** documented as the HTTP-client subscription surface (contract test) + `notifications/tools/list_changed` emitted when tools change at runtime.
- **A7 — Optional elicitation probe**: document + design (ADR) how `elicitation/create` could let the server ask the owner mid-conversation ("Vasilisa asks: reply now?") — implement ONLY if the client landscape supports it; otherwise ADR-defer with evidence.
- TDD: fake MCP client (stdio + HTTP) receives `notifications/resources/updated` ≤2s after synthetic upsert; resources/list+read contract; subscribe/unsubscribe filter matrix; webhook signature/retry/dead-letter; backpressure with stalling client; hook-installer writes valid settings.json/hooks.json shapes (fixture files, read-back verified, idempotent re-run).

## B. Observability — tool-call ledger + diagnostics UI

- **Ledger table**: every MCP `tools/call` + every mutating `/api/*` (ts, tool/route, redacted args, duration, status, error, request-id); 7d retention (env-tunable); bodies at rest ONLY with `WA_DIAG_LOG_BODIES=1`.
- **`#/diagnostics` page**: live tail, filter by tool/chat/status, per-tool p50/p95, error-rate panel, restart-safe from the table. Zero-framework discipline.
- **`#/events` page**: raw bridge event inspector (same safe-set as SSE), pause/capture.
- **/health deep fields**: active subscriptions, webhook queue depth + last-delivery status, ledger size, per-tool p95.
- TDD: ledger row per call through the real mcp-server; redaction test; page renders from seeded ledger.

## C. Sign-in symmetry — QR + code, CLI + web

- CLI: `wa-mcp pair` renders QR (block + PNG, cp1252-safe) AND `--code` flow (requestPairingCode → print 8 digits → wait). Unit-tested with fake daemon; ONE live verify (budget 3, owner consent first).
- Web: QR (exists) + "use a code instead" toggle wired to get_pairing_code.
- Absolute: no terminal step after first install, ever (owner rule). CLI pair documented as the headless-server path.
- TDD: bridge code-route tests (mock engine), CLI --code tests, web toggle e2e.

## D. Dual channel — Meta Cloud API parity

- Formal `Channel` interface (send matrix, media, read-state, presence, groups) + **conformance suite both channels pass** (mock Cloud transport).
- Cloud: send text/media/template, mark read, media download, phone-number-id resolution; webhook delivery-status → read-state rows.
- `doctor` reports active channel + both configs' validity. `WA_CHANNEL=cloud|baileys` reversible switch, ADR for the trade-offs. Live Cloud stays owner-gated (WABA creds → BLOCKED.md).

## E. Voice / video / document understanding

- Engines: mock / openai-BYOK / mlx / **whisper.cpp local (optional dep, structured fallback when absent)**.
- **BYOK config**: `wa-mcp config set transcription.api_key …` (0600 data-dir) + web Settings field; missing key + openai → structured error with setup instructions.
- **Transcripts persist** (messages column/sidecar) and surface in `list_messages` — history without re-transcribing.
- **Video messages → transcript** (ffmpeg audio extract; already a dep). **PDF** (pdftotext/pdf.js optional) + **DOCX** text extraction into the transcript surface. **Document MIME + FileName on send** (lharries PR#342/PR#353: correct MIME types, downloadable old media — fix the 403-on-old-sent-media class). Optional OCR (`WA_OCR_ENGINE=tesseract`, default none).
- `wa-mcp doctor --engines`: availability + config validity per engine. TDD per type with fixtures.

## F. Documentation — claude-CLI (Opus) driven

- **Planning AND drafting via the Anthropic CLI**: the implementing agent dispatches to `claude -p --model opus` (owner's ~/.claude config, max effort) for the docs IA plan, then the cookbook, security-model page, and troubleshooting matrix drafts; every factual claim then gets a file:line verification pass by the implementing agent before landing. The claude CLI never commits directly.
- VitePress IA: 3 getting-started paths (desktop web-first / headless CLI / Docker), generated configuration reference (EVERY env var — new env-doc-coverage script, CI-wired), cookbook (polls, subscriptions, dual-channel, BYOK transcription, imports, headless QR/code), troubleshooting matrix seeded from BLOCKED.md + every review finding, generated tool reference (name/description/schema/annotation/example), security model (token + pairing + ADR 0012 + 0.10 addendum), diagnostics guide, ROADMAP page (lharries PR#47 pattern).
- ADR 0013+ written BEFORE their code: subscriptions, ledger privacy, channel contract, engine factory, group-admin ops.
- CLAUDE.md/AGENTS.md: how to add a tool/engine, how to run gates.

## G. Parity sweep from the census (what the other WhatsApp MCPs have that we lack)

Each: capability-probe FIRST (engine truth), then implement or ACCOUNTING-row with probe evidence. Sources cited per item.

- **Group admin ops** (kahflane/biliboss): promote/demote participants, group settings (description, subject, announce/lock, invite-link revoke). We have create/leave/update-meta only.
- **Chat organization setters**: pin/unpin chat (kahflane), archive/unarchive (PR#60-class), mute/unmute + `muted_only`/`unmuted_only` + mute-status in list_chats (PR#78 read-side exists; setters don't), star/unstar message, mark chat UNREAD (we have mark-read only).
- **Albums/carousel**: multi-image album send + album-preserving forward (PR#127/PR#129) — engine-truth probe first (Baileys album API).
- **Forum topics / communities** (PR#125/PR#126/PR#139): list/create/edit topics, manage_topics admin right — probe the fork's community API; NA-ENGINE with evidence if absent.
- **Scheduled media** (PR#205): scheduler accepts media payloads, not just text.
- **Unicode-safe search** (PR#181): Cyrillic/emoji search correctness test matrix.
- **WhatsApp Business capture** (PR#264): business-account service messages (DHL/banks/OTP) ingest as first-class typed events — probe.
- **Buttons/lists delivery** (NA-ENGINE today: engine-dropped for non-Business): re-probe on the pinned fork; if Business-only, document the constraint in the tool schema (structured error for non-Business senders).
- **Semantic recall** (FelixIsaac PR#56): optional embedding-based message recall (`WA_RECALL_ENGINE=none|openai`), off by default — memory-layer feature, design in an ADR first.
- **Multi-account** (PR#88/PR#357): stays EXCLUDED for 0.10 (single-account daemon model) — but document the multi-INSTANCE pattern (one daemon per account, per-port, per data-dir) as the supported path, with a doctor check.
- **MCPL protocol** (PR#120): re-triage — implement only if the spec has stabilized; else explicit deferral row.
- **Event-driven agent mode** (lharries PR#175/PR#176): an OPTIONAL autonomous agent loop (subscription → LLM → reply) as a plugin/skill, OFF by default, owner-gated keys — design doc + ADR first, implementation last (Phase G2, only if Phases A–F are green).
- Pin/star/mute/archive parity matrix test: for each setter, a fixture-store round-trip test + live verify where the engine allows.

## H. Hardening carry-overs (reviewer tail)

- All reviewer Low findings triaged (checkbox or ACCOUNTING row).
- `search_messages` param naming aligned (q vs query) across schema+docs.
- `scheduled` legacy table → cleanup migration v15 (data-preserving).
- `merge-lid-chats` full-fidelity rewrite (deleted/edited/reactions/polls/labels survive).
- Message-id lookup chat-scoping audit (every route taking a message id).
- Load test: 10k messages ingest <30s with FTS on. Chaos test: kill mid-batch-send → no double-sends, no lost scheduled rows.
- Docker packaging round (the 15 deferred container rows): multi-stage image, HTTP-transport QR pairing in-container (PR#145 pattern — no terminal step in Docker either), docker-compose with volume-mounted data dir (PR#10-class persistence), image-size budget <400MB (FelixIsaac 837MB lesson), CI docker build job.

## Process (non-negotiable, from 0.9.0)

TDD RED→GREEN with evidence; zero comments in source; live-probe verification before every wrap (mock-green ≠ working — proven three times); one small task → mechanical validation → next; conventional commits, each leaves `vp check && vp test` green; coverage floors 80/80/90 (coverage:gate wired); GOAL-0.10 ticks need VERIFY.md evidence lines; live rules unchanged (allowed chats, round-trips, ISO timestamps, pairing budget 3 + consent, mock engines default); BLOCKED.md with proposed defaults.

## Phasing (gates → review/GATES-0.10.md)

- **A0**: GOAL-0.10.md ledger authored; version bumped to 0.10.0; owner scope approval.
- **A** subscriptions + webhook delivery. **B** observability. **C** sign-in symmetry. **D** dual-channel contract. **E** media understanding. **F** documentation (claude-Opus driven). **G** parity sweep (§G, probe-first). **G2** event-driven agent mode (conditional). **H** hardening + Docker + full gate re-run + repack + fresh-container + live smoke.

## Final report format (unchanged)

Checkbox count (checked/total), gate table A→H, CI run links, `wa-mcp-0.10.0.tgz` name + sha256, ACCOUNTING deltas (every re-triaged OUT-OF-SCOPE row listed), VERIFY.md line count, BLOCKED.md contents, and: **"PUBLISH NOT PERFORMED"** with every deferred publish action.
