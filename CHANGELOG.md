# Changelog

## 0.1.0 (unreleased)

Phase A–K feature set. Private repo; packed tarball, nothing published.

### Default port: 8080 → 27777

- The bridge, CLI, stdio MCP server and web UI now default to `127.0.0.1:27777` (single-sourced as `DEFAULT_PORT` in `@wa-mcp/shared`). 8080 stays fully supported with `--port 8080` / `WA_PORT=8080`.
- `wa-mcp install` always writes the explicit bridge URL into MCP host configs; Antigravity's `serverUrl` now follows it instead of a hardcoded `:8080`.
- Existing installs that pass an explicit port (service files, host configs) are unaffected; see configuration → upgrading.

### Agents page truth + agent-filtered logs

- `GET /api/connections` reports `installed` per agent (app bundle / CLI probe; `null` when unknowable); the Agents page sorts installed agents first and badges the rest **App not installed**. `wa-mcp connections` does the same.
- **View logs** opens `#/logs?agent=<slug>`: the Logs page gains an **Agent** filter, `/api/search` an `agent` param and `wa-mcp messages` an `--agent` flag. An agent's log = its MCP sends (the stdio server stamps `x-wa-agent` from `--agent`/`WA_AGENT` or the MCP `clientInfo`; `wa-mcp install` now writes `--agent <platform>`) plus deliveries from its hook-linked subscriptions, recorded in the new `agent_activity` table (migration v25).

### First public release line: 0.1.0

- The whole product is versioned **0.1.0** (the internal pre-release line was retired): every package.json, the bridge SERVER payload, MCP `SERVER_INFO`, device label, web UI, CHANGELOG and docs now carry 0.1.0, enforced by the version-drift guard which additionally fails on any stale pre-release version mention in repo-owned files. Historical ledgers were rewritten to match (owner directive).
- Node floor raised to **≥26** (latest LTS line): root `engines.node`, `doctor` min-node check, CI matrix (ubuntu/macos/windows × node 26), docker install-test images (`node:26`), and docs. The no-publish CI guard and ADR-0010's publish ban are superseded — the repo is public and the npm release is owner-authorized.

### Live channels in Claude Code

- `subscribe_events` gains `channel: true`: matching messages are delivered to the session as Claude Code channel notifications (`notifications/claude/channel` — the contract pinned from claude 2.1.310 and the whatsapp-claude-plugin reference). Each subscribed chat = one channel; Claude replies with `send_message` using `meta.chat_id`.
- Isolation by construction: the bridge broadcasts channel frames on `/api/mcp-notify`, and each stdio server forwards only frames for subscriptions created in that process and tagged with its `--agent`.
- New `wa-mcp mcp` command runs the bundled stdio server (what hosts and the plugin spawn). The Claude Code plugin ships as a marketplace-installable channel plugin: `.claude-plugin/marketplace.json` (category `channels`), `plugins/claude-code/` manifest + `.mcp.json` launcher + `/wa-mcp:wa-channel` onboarding command; versions covered by the drift guard.
- Cookbook: [React to messages → Live channels in Claude Code](https://github.com/dcversus/wa-mcp/blob/main/docs/cookbook/react-to-messages.md).

### WhatsApp voice notes as /voice dictation

- New `wa-mcp voice` command family: `voice install` writes POSIX-sh `rec` + `sox` shims (0755, marker-guarded, `--force` to replace foreign ones) plus a 0600 env file (`~/.wa-mcp/voice-shim.env`); `voice uninstall` reverses; `voice test` probes the shims and serves one note end-to-end through the exact Claude Code recorder argv.
- The shims make Claude Code's `/voice` dictation transcribe WhatsApp voice notes: on Linux (including docker/alpine) Claude Code falls back to spawning SoX `rec` when its native audio module cannot capture, and streams that process's stdout (raw signed 16-bit LE PCM, 16 kHz, mono) to its claude.ai speech-to-text. The shim fetches the next unplayed voice note from the bridge instead of recording — the transcript lands in the prompt like dictated speech. Contract pinned from the claude 2.1.310 binary (probes `sox`/`rec --version`; argv `-q --buffer 1024 -t raw -r 16000 -e signed -b 16 -c 1 - silence 1 0.1 3% 1 2.0 3%`; SIGTERM stop).
- Bridge: `GET /api/voice/next` (peek `{pending, next}`) and `GET /api/voice/next.pcm` (oldest-first FIFO over inbound audio/video messages with stored media, cursor `voice_dictation_cursor` in `meta`; 204 when empty; 422 ENGINE_UNAVAILABLE naming the ffmpeg install; missing files are skipped, not blocking). ffmpeg (bridge side) converts ogg/opus to PCM — no engine config, no API key.
- Docs: new cookbook page (flow, docker/alpine networking, claude.ai-auth + language requirements, error-string troubleshooting); wa-mcp skill mentions the flow.

### pi reacts to WhatsApp

- New `@wa-mcp/pi-extension` package: a zero-dependency pi extension that tails `~/.wa-mcp/subs/*/session.jsonl` from `session_start` and injects each new event into the live pi session via `sendUserMessage(…, { deliverAs: "followUp" })`. Partial lines wait, rotation is followed, malformed lines are skipped, errors are logged once to stderr and never crash pi; events targeted at another agent's session are skipped.
- `wa-mcp install --target pi` copies it to `~/.wa-mcp/pi-extension-dist` and appends that path to `~/.pi/agent/settings.json` `packages` (backup first, idempotent); `uninstall --target pi` reverses it. `wa-mcp install --dry-run` prints the plan and writes nothing.

### Bridge

- Baileys session daemon: pairing (ASCII + PNG + web QR), persistent auth (0700/0600), exponential-backoff reconnect, single-instance lock, graceful shutdown, `WA_DEVICE_NAME`.
- Typed event bus over the engine's `BaileysEventMap`; SSE `/events` with heartbeats.
- HTTP API: health (quality fields + contactsWarm), chats, messages (+filters/instants, full-fidelity fields, truncation metadata), context, global search, send (text + 5 media kinds + reaction/edit/forward/location/contact/poll/album/link-preview/status/buttons/list), media download/stream/view, read receipts, presence, chat state, contacts (+avatars, background warmup), aliases (+favorites, non-ASCII), manual unread, groups (create/participants/meta/settings/invite/leave/join-requests/ephemeral), calls reject, labels, newsletters, scheduler, templates, autoreply, restrict rules, export/bulk, history backfill, catch-up digest, profile/privacy/blocklist, notifications CRUD, transcribe (mock/openai/mlx), tts — all bearer-authed, scoped pairing token (ADR 0012), Host/Origin guard, body-capped, rate-limited (health/events off the API bucket), structured errors.

### Store

- SQLite (node:sqlite) WAL store: messages (+raw proto), chats, contacts, events, poll options/votes, read state, media files, aliases, scheduled, templates, autoreply rules, notification rules, transcripts, meta.
- Migrations v1–v14 (reactions sender-keyed model, poll votes, labels, newsletters, disappearing settings, sync watermark); FTS5 search (accent-insensitive, injection-safe) with sync triggers; read state; foreign-layout import path.

### MCP

- Zero-dep JSON-RPC 2.0 server: stdio and `POST /mcp` transports; resources (`wa://chats|unread|health`).
- 74-tool registry: messaging (incl. link preview, status broadcast, buttons/list interactive), media pipeline (download/view/transcribe/TTS), reading, chats/groups (join requests, ephemeral), contacts, labels, newsletters, scheduler, templates, autoreply, restrict rules, profile/privacy/blocklist, notifications, search/digest/export, history backfill — with MCP tool annotations (readOnly/destructive/idempotent).
- wa:// resources (sync-status, config, chats, unread, health) exposed over resources/list + resources/read with subscribe support.

### CLI

- `wa-mcp install|doctor|status|start|stop|restart|logs|uninstall|update|skills|pair|config|inbox|hook` — 6 platform config writers with read-back verification, sandbox `--home`, doctor check table, skills + slash-command install, inbox drain reader (JSONL cursor, exit-code protocol for host hooks).

### Web UI

- Vanilla SPA: pairing (QR poll, phone code, copy link), chats + chat detail + send with media bubbles and day separators, unread inbox with mark-read, contacts/aliases, groups, native-style profile page (name/phone/about from the auth state, editable, privacy controls with read→write key mapping, blocklist), subscriptions manager (per-chat toggles with filter + count, hook snippets, advanced raw form), live events feed, status dashboard (structured stat formatting, no more [object Object]), settings (localStorage token + bridge URL). Served by the bridge; shell unauthenticated, API bearer-authed with resilient token exchange (failure classification: terminal 403, retry-after 429; stale-token self-heal after daemon restarts).

### Media

- resolve (base64/path/url with traversal guard + 20MB cap), per-message download (raw-proto backed), magic-byte MIME sniffing, transcripts table (mock engine), mock TTS.

### Docs & governance

- 12 ADRs, VitePress site (getting started, generated tool reference, configuration, security, development), CHANGELOG.
- ACCOUNTING.md: 1,029 census items dispositioned; `accounting:check` in CI. `docs:coverage`: all 74 registry tools documented.
- CI: check/build/test matrix (3 OS × node 20/22), security job (audit high+, gitleaks, no-publish guard, accounting check). Nothing published.

### Onboarding round (2026-10-02)

- Pairing: `POST /api/pairing-code` + `get_pairing_code` MCP tool (real codes issued live); `wa-mcp pair` subcommand — ANSI terminal QR (qrcode, small) with the wa.me link as a copy/paste line, `--code <phone>` path, 180s timeout.
- Engine: `baileys` pinned to the companion_reg_refresh fork (ADR 0011) — upstream rc14 ignores the mid-pairing registration rotation, so fresh codes were rejected server-side.
- Web UI: first-run deadlock fixed (main.ts was never wired to the render pipeline); `#/pairing` renders in place with the token form inline — no redirect; CDP headless-Chrome smoke wired (`scripts/webui-smoke.mjs`).
- Reconnect: QR-pool exhaustion (close 428) auto-reissues a fresh QR with backoff — no manual restart; lifecycle tests made hermetic (no leaked real reconnect timers).
- Build: bridge `vp pack` no longer wipes the served web assets — `pnpm run -r build` always ends with `bridge/dist/web` present (copy-dist after pack, web-ui ordered first via devDep).
- Platform: node floor raised — the store is `node:sqlite`; a fresh-container install test validates the tarball end-to-end.
- Quality: `vp test --coverage` with enforced per-package line thresholds (bridge 80 / mcp-server 80 / shared 90; actuals 82.89 / 88.36 / 97.77), wired into CI's test job.
- Packaging: release tarball reproducible via `scripts/pack-release.sh` (final: sha256 cc8b9ed6…); fresh-container install test green against it.

### Independent-review + hardening sweep (2026-10-03/04)

- Security (both independent reviews closed — 4 Criticals, 5 Highs, 3 Mediums): scoped pairing token + Host/Origin DNS-rebind guard + ui-token exchange (ADR 0012); stored-XSS escape + CSP everywhere; unhandled-rejection hardening; /api/qr strict allowlist + realpath containment; SSE credential filtering; SSRF guard on URL media fetch; sender-verified delete/edit tombstones; sender-keyed reactions model; poll votes decode + persist; transactional migrations; resume/reconnect single-flight teardown; mock TTS refuses real sends.
- Reliability: staleness watchdog, app-state 409 conflict auto-resync, /health quality fields, 3-failure alert, stdio EOF clean exit, contact warmup at startup, rate-bucket starvation fixes (health/events off the API bucket; pairing page stops polling QR when logged in).
- Features: fetch_history (cursor-paged engine backfill + ingest), catch_up digest, digest_group + 3 MCP Prompts, export_chat/export_unread (JSONL/MD/TXT), bulk_clear, get_login_qr, view_media (base64/scene-samples), download_media, transcribe engines (openai/mlx), TTS engine factory, per-engine input normalization, auto-download rules, WA_ALLOWED_EXTENSIONS, labels (probe-verified fork CRUD), newsletters (probe-verified follow/unfollow/send), group join-requests, ephemeral settings, reject_call, scheduled media payloads, alias favorites + Cyrillic resolution, WA_SYNC_FULL_HISTORY, disappearing-message tracking, backup retention, lharries/Go-fork store import.
- Probes (engine truth, dispositioned not faked): labels SUPPORTED (implemented); newsletters SUPPORTED (implemented); username lookup NA-ENGINE-PARTIAL; member-labels NA-ENGINE-PARTIAL (inbound-only).
- Import command: wa-mcp import --from lharries|gofork (built-artifact verified).
- Tooling: exports-discipline lint (no deep src imports), webui-e2e gate, annotations serialized + live-verified.
