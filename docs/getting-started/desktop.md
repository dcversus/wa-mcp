# Desktop (web-first)

The whole flow runs in your browser — no terminal required after the app is
on your machine.

## 1. Start the bridge

Open the wa-mcp app (or `wa-mcp start` if you launched it from a terminal —
the UI does not require this). The bridge generates its token automatically.

## 2. Open the web UI

Visit `http://127.0.0.1:8080`. The UI bootstraps itself: it adopts the
ephemeral pairing token from `/health` with zero user action (ADR 0012) and
exchanges it for a stable UI token the first time it sees a paired account.

## 3. Pair your phone

The `#/pairing` page shows the QR code. Scan it with your phone
(WhatsApp → Linked devices).

No camera? Use the phone-number form on the same page: type your number,
press the button, and enter the 8-digit code on your phone
(WhatsApp → Linked devices → **Link with phone number instead**). The page
polls and flips to the connected state by itself.

## 4. Use it

- `#/chats` — browse history, send messages
- `#/logs` — every message in and out, with filters and live tail
- `#/contacts` — your WhatsApp contacts; add, rename, remove, sync
- `#/connections` — the agents wired to this WhatsApp, with disconnect
- `#/subscriptions` — choose which messages reach your agent and how
  (inbox file, agent session or a new agent each time)
- `#/profile` — name, about, privacy and blocked contacts
- `#/connection` — link status, today's stats, humanisation and send limits
- `#/settings` — bridge URL, transcription engine, BYOK keys (masked)
- `#/help` — how everything fits together, plus the full `wa-mcp` command
  reference

Every page has a `wa-mcp` command with the same capability — see `#/help`.

## What the browser never needs

- no CLI command to pair (both QR and code are in the UI)
- no token pasting (bootstrap is automatic)
- no config file editing (Settings covers engine + keys)

The terminal path exists for headless machines — see
[Headless CLI](./index.md) — but it is never required on a desktop.
