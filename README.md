# wa-mcp

[![ci](https://github.com/dcversus/wa-mcp/actions/workflows/ci.yml/badge.svg)](https://github.com/dcversus/wa-mcp/actions/workflows/ci.yml)
[![npm](https://img.shields.io/npm/v/wa-mcp)](https://www.npmjs.com/package/wa-mcp)
[![node](https://img.shields.io/badge/node-%E2%89%A526-339933)](https://nodejs.org)
[![license](https://img.shields.io/badge/license-MIT-blue)](LICENSE)

**WhatsApp as a local MCP server.** One single-user daemon holds your WhatsApp
session (Baileys) and exposes **74 MCP tools** over stdio and HTTP, a built-in
web UI, a `wa-mcp` CLI — and your agents react to messages in real time.

```
WhatsApp ⇄ bridge daemon (Baileys fork, node:sqlite, loopback-only)
               ├─ MCP stdio + POST /mcp  → 74 tools (Claude Code, Codex, Grok,
               │                            Antigravity, Claude Desktop, Pi)
               ├─ HTTP /api/* + SSE       → web UI (logs, chats, settings)
               ├─ subscriptions + inboxes → agents react to incoming messages
               └─ wa-mcp CLI              → install · doctor · pair · start
```

## Quickstart

```bash
npx wa-mcp install              # register the MCP server in your agents
npx wa-mcp start                # daemon on 127.0.0.1:27777
npx wa-mcp pair                 # scan the QR (or: --code <phone-number>)
npx wa-mcp doctor               # token, registrations, health — all green?
```

Then open Claude Code (or Codex/Grok/Antigravity/Claude Desktop/Pi) and ask it
to list chats or send a message. Web UI: `http://127.0.0.1:27777/`.

Requires Node ≥26 (`node:sqlite`). ffmpeg (optional) enables voice-note
transcription and TTS.

## Highlights

- **74 MCP tools** — messaging (text/media/polls/reactions/edit/forward/
  location/contacts/scheduled/templates), reads (chats/messages/context/
  full-text search/digests/catch-up), group management, contacts + aliases + labels,
  profile/privacy/blocklist, newsletters, autoreply, notification rules,
  subscriptions with agent inbox files, media understanding, export.
- **Six agent adapters, one daemon** — `wa-mcp install --target <platform>`
  writes the right config for Claude Code, Claude Desktop, Codex, Pi, Grok
  and Antigravity; per-agent send attribution and agent-filtered logs.
- **Agents that react** — subscribe a chat; events spool to an inbox the
  agent drains, land live inside **pi** sessions via the bundled pi
  extension, or arrive as **live Claude Code channels**: with `channel: true`
  each subscribed chat becomes a channel in the running session (install the
  plugin: `claude plugin marketplace add dcversus/wa-mcp`).
- **Voice notes as `/voice` dictation** — `wa-mcp voice install` drops
  `rec`/`sox` shims so Claude Code's own speech-to-text transcribes your
  WhatsApp voice notes when you hold the dictation key — no transcription
  engine, no API key, works in docker/alpine.
  [Cookbook: voice dictation](https://github.com/dcversus/wa-mcp/blob/main/docs/cookbook/voice-dictation.md).
- **Web UI** — every message in and out with filters and live tail,
  conversations with media bubbles, contacts, subscriptions, agents,
  profile/privacy, connection settings, pairing.
- **Safety floor** — loopback bind, bearer auth on every route, 1 MB body
  cap, rate limits, daily send cap, `WA_SENDS_DISABLED` kill switch,
  path-confined media, pairing-attempt budget.
- **Store** — SQLite (WAL) + FTS5 full-text search; polls, reactions, edits,
  revokes and read-state persisted.

## Documentation

- [Getting started](https://github.com/dcversus/wa-mcp/blob/main/docs/getting-started/index.md)
  · [Per-platform install](https://github.com/dcversus/wa-mcp/blob/main/docs/getting-started/platforms.md)
- [Tool reference (all 74)](https://github.com/dcversus/wa-mcp/blob/main/docs/reference/tools.md)
- [Configuration](https://github.com/dcversus/wa-mcp/blob/main/docs/configuration.md)
  · [Troubleshooting](https://github.com/dcversus/wa-mcp/blob/main/docs/troubleshooting.md)
  · [FAQ](https://github.com/dcversus/wa-mcp/blob/main/docs/faq.md)
- Cookbook: [React to messages](https://github.com/dcversus/wa-mcp/blob/main/docs/cookbook/react-to-messages.md)
  · [Media understanding](https://github.com/dcversus/wa-mcp/blob/main/docs/cookbook/media-understanding.md)
  · [Voice dictation](https://github.com/dcversus/wa-mcp/blob/main/docs/cookbook/voice-dictation.md)
- [Security](https://github.com/dcversus/wa-mcp/blob/main/docs/security.md) · [ADRs](https://github.com/dcversus/wa-mcp/tree/main/docs/adr)

## Security

Loopback-first design; constant-time bearer tokens; media path confinement;
send kill-switch. Full model and reporting:
[SECURITY.md](https://github.com/dcversus/wa-mcp/blob/main/SECURITY.md).

## Development

```bash
pnpm install
pnpm exec vp check && pnpm exec vp test && pnpm run -r build
pnpm run webui-e2e        # browser use-case gate (daemon up)
```

See [CONTRIBUTING.md](https://github.com/dcversus/wa-mcp/blob/main/CONTRIBUTING.md)
(TDD policy, conventions) and [AGENTS.md](https://github.com/dcversus/wa-mcp/blob/main/AGENTS.md)
(agent-facing guide).

## Credits

Built on the shoulders of the WhatsApp-MCP community — every upstream item was
catalogued and dispositioned during development (census archived in git
history):
**lharries/whatsapp-mcp** (reference architecture), **verygoodplugins/whatsapp-mcp**,
**chigwell/telegram-mcp** (patterns), **FelixIsaac/whatsapp-mcp-extended**,
**jonzarecki/wa-mcp**, **delltrak/wamcp**, and the issue/PR authors catalogued
there. Engine: [Baileys](https://github.com/WhiskeySockets/Baileys) via the
`companion-reg-refresh` fix fork
([ADR 0011](https://github.com/dcversus/wa-mcp/blob/main/docs/adr/0011-engine-pairing-fix.md)).

## License

[MIT](https://github.com/dcversus/wa-mcp/blob/main/LICENSE) — wa-mcp contributors.
