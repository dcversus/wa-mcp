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
