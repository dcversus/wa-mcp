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

- The daemon requires Node ≥22.5 (node:sqlite).
- LID-era accounts: resolve recipients through
  `signalRepository.lidMapping` (FULL jids only — see send.ts comments).
- Pairing attempts are budgeted (3 without pairing → pairing-blocked);
  WhatsApp's anti-abuse cooldown resets on every attempt.
