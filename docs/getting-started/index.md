# Getting started

## Install

```sh
wa-mcp install            # writes client configs for all detected platforms
wa-mcp install --target cursor   # or one platform: claude-code, claude-desktop, cursor, codex, pi, hermes, grok, antigravity
```

Every write is read back and verified. Re-running updates in place.

## Pair

```sh
wa-mcp start              # bridge spawns detached; QR prints to stderr
```

Scan the QR with your phone (WhatsApp → Linked devices). The session persists in `~/.wa-mcp/auth/` — restarts do not re-pair. The same QR is available in the web UI at `#/pairing`.

## First send

```sh
wa-mcp status             # bridge connected?
wa-mcp doctor             # node, data dir, token, health
```

Then ask your assistant to `send_message` with a phone number (or group jid) and text. Safety rails apply: sends are paced, capped per day (`WA_DAILY_CAP`), and can be stopped dead with `WA_SENDS_DISABLED=1`.
