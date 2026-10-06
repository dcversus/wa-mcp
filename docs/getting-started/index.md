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

No camera? Pair with an 8-digit code instead — same flow, phone-first:

```sh
wa-mcp pair --code +447700900123
```

Enter the printed code on your phone (WhatsApp → Linked devices → **Link with phone number instead**); the command waits and reports `paired: bridge connected to WhatsApp` once the phone accepts. In the web UI the same option is the phone-number form on the `#/pairing` page — no terminal needed. The code path never touches the pairing-attempt budget differently from QR: one link is one attempt either way.

## First send

```sh
wa-mcp status             # bridge connected?
wa-mcp doctor             # node, data dir, token, health
```

Then ask your assistant to `send_message` with a phone number (or group jid) and text. Safety rails apply: sends are paced, capped per day (`WA_DAILY_CAP`), and can be stopped dead with `WA_SENDS_DISABLED=1`.
