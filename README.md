# wa-mcp

WhatsApp as a local MCP server: a **single-user daemon** (Baileys session,
Node ≥26, zero runtime deps in the core) exposing **74 MCP tools** over
stdio and HTTP, with a built-in web UI — logs, contacts, agent
connections, subscriptions, profile, connection settings and help — and a
`wa-mcp` CLI with the same capabilities.

```
WhatsApp ⇄ bridge daemon (Baileys fork, node:sqlite store)
                ├─ MCP stdio + POST /mcp   → 74 tools
                ├─ HTTP /api/* + SSE       → web UI (vanilla, served by the bridge)
                └─ CLI wa-mcp              → install / doctor / pair / start / stop
```

## Quickstart

```bash
# from the release tarball
npm install ./wa-mcp-0.1.0.tgz
npx wa-mcp start                      # daemon on 127.0.0.1:27777
npx wa-mcp install --target claude-code   # or: codex grok pi antigravity claude-desktop
npx wa-mcp doctor                     # verifies token, registrations, health
npx wa-mcp pair                       # QR in the terminal, or --code <phone>
```

Requires Node ≥26 (`node:sqlite`). Full per-platform setup:
[docs/getting-started/platforms](docs/getting-started/platforms.md).

**Upgrading:** the default port changed from 8080 to 27777 in 0.1.0. Installs that pass a port explicitly — the launchd/systemd service
(`--port 8080`) and every MCP host entry written by `wa-mcp install`
(`--bridge-url http://127.0.0.1:8080`) — keep working unchanged. To move to
27777, run `wa-mcp install --service` and `wa-mcp install` again without
`--port`; to stay on 8080, keep passing `--port 8080` (or `WA_PORT=8080`).
See [configuration → upgrading](docs/configuration.md#upgrading-the-default-port).

## What you get

- **74 MCP tools** — messaging (text/media/poll/reaction/edit/forward/
  location/contact/scheduled/templates), reads (chats/messages/context/
  search/digest/catch-up), groups (create/invite/participants/meta),
  contacts + aliases + labels, profile/privacy/blocklist, newsletters,
  autoreply, notification rules, subscriptions with agent inbox files,
  media understanding (transcribe/TTS, document reading), export.
- **Web UI** — Logs (every message in and out, filters, live tail; a chat
  name opens the conversation), Contacts (your WhatsApp contacts, edited
  exactly like WhatsApp Web; a contact opens the conversation, with media
  bubbles and replies), Connections, Subscriptions, Profile (name, about,
  privacy, blocked), Connection (link by QR or phone code, today's stats,
  humanisation and send limits) and Help. Served by the bridge at
  `http://127.0.0.1:27777/`.
- **Safety floor** — loopback bind, bearer auth (401 matrix), 1 MB body
  cap, rate limits, daily send cap + `WA_SENDS_DISABLED` kill switch,
  path-confined media, pairing-attempt budget (anti-abuse cooldown aware).
- **Store** — SQLite (WAL) with FTS5 search; polls, reactions, edits,
  revokes and read-state persisted.
- **Events** — SSE `/events`; the web UI consumes a bounded live feed.

## Security

Loopback-first design; bearer tokens (constant-time); media path
confinement; send kill-switch. Full model + reporting:
[SECURITY.md](SECURITY.md) and [docs/security.md](docs/security.md).

## Documentation

- Getting started + per-platform install: `docs/getting-started/`
- Tool reference (generated from the registry): `docs/reference/tools.md`
- Configuration, migration, troubleshooting, FAQ: `docs/`
- ADRs 0001–0011: `docs/adr/`

## Development

```bash
pnpm install
vp check && vp test && pnpm run -r build
pnpm run webui-e2e        # browser use-case gate (daemon up)
```

See [CONTRIBUTING.md](CONTRIBUTING.md) (TDD policy, conventions) and
[AGENTS.md](AGENTS.md) (agent-facing guide).

## Credits

Built on the shoulders of the WhatsApp-MCP community — every upstream item
is dispositioned in [review/ACCOUNTING.md](review/ACCOUNTING.md):

- **lharries/whatsapp-mcp** — 127 issues + 235 PRs (the reference
  architecture; Go bridge + Python MCP lineage)
- **verygoodplugins/whatsapp-mcp** — 38 issues + 223 PRs
- **chigwell/telegram-mcp** — 52 issues + 200 PRs (patterns: aliases,
  event feed, transcription engines, annotations)
- **FelixIsaac/whatsapp-mcp-extended** — 25 issues + 59 PRs
- **jonzarecki/wa-mcp** — 31 PRs (catch-up/digest workflows)
- **delltrak/wamcp** — 17 PRs (TS+Baileys reference, channels pattern)
- **operation-hp/WA-MCP**, **aserranoni**, **fabienbutz**, **Jochem**,
  **kahflane**, **biliboss**, **NIXKnight**, **MuhammadMustafa18**,
  **ste-bah**, **OmarYousef95**, **Shloimy15e**, **eddmann**

Engine: [Baileys](https://github.com/WhiskeySockets/Baileys) via the
`companion-reg-refresh` fix fork (ADR 0011).

## License

[MIT](LICENSE) — wa-mcp contributors.
