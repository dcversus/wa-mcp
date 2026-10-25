# AGENTS.md — guide for coding agents working in this repo

## What this is

wa-mcp: a 100% TypeScript WhatsApp MCP server. pnpm monorepo, Vite+ toolchain
(`vp check|test|build`), zero runtime deps in the bridge core, no publishing
(contract; a CI grep guard enforces it).

## Architecture map

- `packages/bridge` — the daemon: Baileys session, HTTP API (`/api/*`), SSE
  `/events`, MCP over `POST /mcp`, store (node:sqlite), media, pairing
  (QR/pairing-code/pairing-budget), channels/ (§18 dual-channel foundation).
- `packages/mcp-server` — zero-dep JSON-RPC 2.0 MCP server (stdio + HTTP);
  the tool registry in `src/tools.ts` is the surface list.
- `packages/cli` — `wa-mcp` bin: install/doctor/status/start/stop/pair/skills.
- `packages/web-ui` — vanilla SPA served by the bridge from `bridge/dist/web`
  (copy-dist runs after every bridge build; hash-changed bundles replace, not
  accumulate).
- `packages/shared` — jid utils + validation shared by bridge and cli.
- `packages/pi-extension` — pi extension (node builtins only) that tails
  `~/.wa-mcp/subs/*/session.jsonl` and injects each event into the live pi
  session via `sendUserMessage` (follow-up). `wa-mcp install --target pi`
  copies its `dist` to `~/.wa-mcp/pi-extension-dist` and lists it in
  `~/.pi/agent/settings.json` `packages`.

## Engine fork pin

`baileys` is pinned to `github:doryani-ai/Baileys#fix/companion-reg-refresh`
(ADR 0011). rc14 ignores the mid-pairing `companion_reg_refresh` rotation, so
fresh codes were rejected server-side. The fork's quirks matter:
`pollCreationMessageV3` (selectableCount dispatch), LID-era addressing
(`isLidUser/isPnUser` in jid-utils.js require FULL jids), protocolMessage
REVOKE/MESSAGE_EDIT handling. Read the fork source before assuming behavior.

## Test conventions

Strict TDD: failing-test commit with exact assertion evidence, then GREEN.
Mocks emulate the engine's real output protos. Timer-heavy tests get 15s
timeouts. `vp test --coverage` enforces bridge/mcp-server ≥80%, shared ≥90%
lines.

## Ledger files and how they interlock

- `GOAL.md` — the 229-box contract. Ticked ONLY with a `— VERIFY: <anchor>`
  inline; pending boxes carry `— PENDING: live/ci` markers.
- `review/VERIFY.md` — append-only evidence ledger; every PASS cites its task
  and gate. TICK a GOAL box only after a VERIFY line exists.
- `review/GATES.md` — phase records (A–J); each cites its VERIFY lines.
- `review/ACCOUNTING.md` — 1,029-item census from 14 upstream repos,
  dispositioned; `pnpm run accounting:check` enforces counts (CI).
- `review/BLOCKED.md` — external blockers (CI billing, pairing lockout) with
  proposed defaults.
  Rule: evidence lives in VERIFY; GOAL references it; nothing is claimed
  without it.

## Current operational notes

- The daemon requires Node ≥26 (node:sqlite; latest LTS line).
- LID-era accounts: resolve recipients through
  `signalRepository.lidMapping` (FULL jids only — see send.ts comments).
- Pairing attempts are budgeted (3 without pairing → pairing-blocked);
  WhatsApp's anti-abuse cooldown resets on every attempt.

## How to add an MCP tool

1. `packages/mcp-server/src/tools.ts` — insert the tool object in registry
   order (the ordered name arrays in `tests/tools.test.ts` and
   `tests/server.test.ts` match SOURCE ORDER; insert at the matching
   position, not the end). Read-only tools wrap with
   `annotate(tool, { readOnlyHint: true })`.
2. Handler shape: `bridgeFetch(toolCtx, "/api/…")` + `textResult(payload)` —
   input validation via `requireString`.
3. Extend the ordered name arrays in both test files
   (`tools.test.ts`, `server.test.ts`) + any count assertions.
4. `pnpm run docs:gen` regenerates `docs/reference/tools.md`;
   `pnpm run docs:coverage` must report the new count.
5. If the tool mutates subscription/registry state, emit
   `notifications/tools/list_changed` (see T111).

## How to add a transcription/OCR engine

1. `packages/bridge/src/media/transcribe.ts` — implement
   `TranscriptionEngine`; throw `MediaError("ENGINE_NOT_CONFIGURED", …)` for
   missing config (message must name the env var / config key) and
   `MediaError("ENGINE_UNAVAILABLE", …)` for missing binaries (message must
   name the install command).
2. Add the name to `SUPPORTED_TRANSCRIPTION_ENGINES` and the factory
   (`createTranscriptionEngine`) — config.json values flow through
   `resolveTranscriptionSettings` (env wins over file).
3. External binaries: spawn via injectable `spawnFn` for tests, always clean
   temp dirs in `finally`, cap sizes.
4. `doctor --engines` (`packages/cli/src/doctor.ts`): optional engines never
   fail the check; a SELECTED engine with a missing binary/model fails with
   the fix hint.
5. Update `docs/cookbook/media-understanding.md` (drift-guard:
   `packages/cli/tests/t130-media-docs.test.ts` asserts the engine list
   matches the doc) + the env table in `docs/configuration.md`
   (`pnpm run env-doc-coverage` enforces).

## How to run the gates

- `vp check` — format + lint + types (must exit 0)
- `vp test` — full suite (all packages)
- `vp test --coverage` — coverage floors (bridge/mcp-server ≥80, shared ≥90)
- `pnpm run docs:coverage` — every MCP tool documented
- `pnpm run env-doc-coverage` — every env var documented
- `pnpm run accounting:check` — census counts
- `pnpm run docs:build` — VitePress build (dead links fail)
- `scripts/webui-e2e.mjs` — browser e2e against the live daemon
- Live smoke rules: `review/GATES.md` (Test group + owner + Vasilisa only,
  spaced sends, never auto-retry pairing)
