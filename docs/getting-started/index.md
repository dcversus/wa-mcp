# Getting started

## Install

```sh
wa-mcp install            # writes client configs for all detected platforms
wa-mcp install --target codex   # or one platform: claude-code, claude-desktop, codex, pi, grok, antigravity
```

Every write is read back and verified. Re-running updates in place.

## Pair

```sh
wa-mcp start              # bridge spawns detached
wa-mcp pair               # shows a QR code in the terminal
```

Scan the QR with your phone (WhatsApp → Linked devices), or open the web UI at `#/pairing` — the same QR, with a countdown. The session persists in `~/.wa-mcp/auth/` — restarts do not re-pair.

Like WhatsApp Web, the daemon only asks WhatsApp for a QR code while you're there to scan it: when you open the pairing page or run `wa-mcp pair`, never on its own at boot. Each request gets one batch of codes (the first lives 60 s, the next ones 20 s each). If they all expire unscanned, linking stops — click **Show a new QR code** or run `wa-mcp pair` again. Every request counts as one link attempt, because WhatsApp's anti-abuse limits treat repeated attempts as suspicious; set `WA_AUTO_PAIR=1` only if you need the old behavior of registering at boot.

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

## Everything from the terminal

Every web UI page has a `wa-mcp` command with the same capability, so a
headless machine loses nothing. `wa-mcp` with no arguments prints the full
reference (the web UI's **Help** page shows the same list). <!-- src: packages/shared/src/cli-reference.ts -->

```bash
wa-mcp chats --q team
wa-mcp send --chat +358401112222 --text "on my way"
wa-mcp messages --chat Team --direction in --limit 20
wa-mcp media transcribe 3EB0C431D5F1
wa-mcp contacts sync
wa-mcp profile privacy last contacts
wa-mcp profile block +44 7700 900123
wa-mcp settings set --humanise on --limits on --per-day 300
wa-mcp pair --resume
```

`wa-mcp unlink --yes` signs this computer out of WhatsApp.
