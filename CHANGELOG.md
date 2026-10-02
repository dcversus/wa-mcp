# Changelog

## 0.9.0 (unreleased)

Phase A–K feature set. Private repo; packed tarball, nothing published.

### Bridge

- Baileys session daemon: pairing (ASCII + PNG + web QR), persistent auth (0700/0600), exponential-backoff reconnect, single-instance lock, graceful shutdown, `WA_DEVICE_NAME`.
- Typed event bus over the engine's `BaileysEventMap`; SSE `/events` with heartbeats.
- HTTP API: health, chats, messages (+filters/instants), context, search, send (text + 5 media kinds + reaction/edit/forward/location/contact/poll), media download/stream, read receipts, presence, chat state, contacts, aliases, unread, groups (create/participants/meta/settings/invite/leave), profile/privacy/blocklist, notifications CRUD, transcribe, tts — all bearer-authed, body-capped, rate-limited, structured errors.

### Store

- SQLite (node:sqlite) WAL store: messages (+raw proto), chats, contacts, events, poll options/votes, read state, media files, aliases, scheduled, templates, autoreply rules, notification rules, transcripts, meta.
- Migrations v1–v6; FTS5 search (accent-insensitive, injection-safe) with sync triggers; read state; foreign-layout import path.

### MCP

- Zero-dep JSON-RPC 2.0 server: stdio and `POST /mcp` transports; resources (`wa://chats|unread|health`).
- 22-tool registry: messaging, media, reading, chats/groups, contacts, profile/privacy/blocklist, notifications, transcribe/voice.
- wa:// resources exposed over resources/list + resources/read.

### CLI

- `wa-mcp install|doctor|status|start|stop|skills` — 8 platform config writers with read-back verification, sandbox `--home`, doctor check table, skills + slash-command install.

### Web UI

- Vanilla SPA: pairing (QR poll), chats + chat detail + send, unread inbox with mark-read, settings (localStorage token), health dashboard. Served by the bridge; shell unauthenticated, API bearer-authed.

### Media

- resolve (base64/path/url with traversal guard + 20MB cap), per-message download (raw-proto backed), magic-byte MIME sniffing, transcripts table (mock engine), mock TTS.

### Docs & governance

- 10 ADRs, VitePress site (getting started, generated tool reference, configuration, security, development), CHANGELOG.
- ACCOUNTING.md: 1,029 census items dispositioned; `accounting:check` in CI. `docs:coverage`: all 30 registry tools documented.
- CI: check/build/test matrix (3 OS × node 20/22), security job (audit high+, gitleaks, no-publish guard, accounting check). Nothing published.

### Onboarding round (2026-10-02)

- Pairing: `POST /api/pairing-code` + `get_pairing_code` MCP tool (real codes issued live); `wa-mcp pair` subcommand — ANSI terminal QR (qrcode, small) with the wa.me link as a copy/paste line, `--code <phone>` path, 180s timeout.
- Engine: `baileys` pinned to the companion_reg_refresh fork (ADR 0011) — upstream rc14 ignores the mid-pairing registration rotation, so fresh codes were rejected server-side.
- Web UI: first-run deadlock fixed (main.ts was never wired to the render pipeline); `#/pairing` renders in place with the token form inline — no redirect; CDP headless-Chrome smoke wired (`scripts/webui-smoke.mjs`).
- Reconnect: QR-pool exhaustion (close 428) auto-reissues a fresh QR with backoff — no manual restart; lifecycle tests made hermetic (no leaked real reconnect timers).
- Build: bridge `vp pack` no longer wipes the served web assets — `pnpm run -r build` always ends with `bridge/dist/web` present (copy-dist after pack, web-ui ordered first via devDep).
- Platform: node floor raised to `>=22.5.0` — the store is `node:sqlite`; fresh-container install test passes on node:22 (nested bundled-dep resolution fixed in the docker harness).
- Quality: `vp test --coverage` with enforced per-package line thresholds (bridge 80 / mcp-server 80 / shared 90; actuals 82.89 / 88.36 / 97.77), wired into CI's test job.
- Packaging: release tarball reproducible via `scripts/pack-release.sh` (sha256 325a60d7…); docker install test green against it.
