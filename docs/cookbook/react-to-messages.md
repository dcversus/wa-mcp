# React to WhatsApp messages from your agent

A **subscription** decides which incoming WhatsApp messages reach your agent
and how. Each one has: <!-- src: packages/shared/src/subscription-config.ts; packages/bridge/src/subs-dispatch.ts -->

- **chats** — one or more chat jids, or `*` for all chats
- **filter** — an optional `%like%` text pattern (SQL LIKE, case-insensitive:
  `%` is any text, `_` is one character, `\%` a literal percent; a pattern
  without wildcards matches anywhere in the text) and a **mention-only** flag
  (deliver only when the message @mentions this WhatsApp account)
- **prompt** — instructions stamped into every delivered event as `prompt`
- **delivery** — where matches go (below)

Your own messages are never delivered, and history sync older than the
subscription is skipped.

```bash
wa-mcp subs create --name Invoices --chat 120363428874442773@g.us --like %invoice% --mention-only --prompt "Triage the invoice"
wa-mcp subs
wa-mcp subs edit <subscription-id> --like "" --disable
wa-mcp subs test <subscription-id>
wa-mcp subs delete <subscription-id>
```

The web UI **Subscriptions** page (`#/subscriptions`) does the same, and the
`subscribe_events` MCP tool creates inbox subscriptions.

## Delivery modes

| Mode                | Flag                                                          | What happens to each match                                                                                                                                                                                   |
| ------------------- | ------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Inbox file          | `--delivery inbox` (default)                                  | One JSON line appended to `~/.wa-mcp/subs/<id>/inbox.jsonl` (rotated at 2 MB). Read it with `wa-mcp inbox drain`, or install a hook (below).                                                                 |
| Agent session       | `--delivery session [--session <id>]`                         | One JSON line appended to `~/.wa-mcp/subs/<id>/session.jsonl` with `session` set to the picked session id or `active`. The spool file is the contract; the session's hook picks it up.                       |
| New agent each time | `--delivery spawn --command <path> [--arg <a>]… [--env K=V]…` | The command starts detached with a clean context, `WAMCP_EVENT` (the event JSON), `WAMCP_SUB` (subscription id) and `WAMCP_PROMPT` in its environment. Start failures and non-zero exits go to `bridge.log`. |

`wa-mcp subs sessions` lists recent Claude Code (`~/.claude/projects`) and
Codex (`~/.codex/sessions`) sessions to pick from (`GET /api/sessions` —
file metadata only, never content).

```bash
wa-mcp subs create --name Desk --all-chats --delivery session --session claude:b41d09a0
wa-mcp subs create --name Bot --chat 358401112222@s.whatsapp.net --delivery spawn --command /usr/local/bin/claude --arg -p --env ANTHROPIC_MODEL=opus
```

Use `--arg=--flag` for arguments that start with `--`.

Every delivered line carries these fields (pretty-printed here):

```json
{
  "ts": "2026-10-08T10:00:00.000Z",
  "kind": "message",
  "chat": "120363428874442773@g.us",
  "chatName": "Team",
  "from": "358401112222@s.whatsapp.net",
  "fromName": "Dana",
  "fromMe": false,
  "id": "3EB0…",
  "text": "Invoice #42",
  "media": false,
  "subId": "abc123def456",
  "prompt": "Triage the invoice"
}
```

## 1. Claude Code (hooks)

Create an inbox subscription, then install the hooks:

```bash
wa-mcp subs create --name Team --chat 120363428874442773@g.us
wa-mcp install --hooks claude --sub <subscription-id>
```

`install --hooks claude` writes two entries into `~/.claude/settings.json`
(merged safely — your existing hooks are never touched, a timestamped backup
is written first):

- a `FileChanged` watch on the subscription's inbox file
- the same `FileChanged` hook runs `wa-mcp inbox drain` with `async: true` in the
  background; when new events arrive the drain exits `2`, which wakes Claude
  with the new-event summary as a system reminder — Claude then REACTS.

Remove them with:

```bash
wa-mcp install --hooks claude --remove
```

## 2. Codex (hooks.json)

The same command targets Codex's hook file:

```bash
wa-mcp install --hooks codex --sub <subscription-id>
```

This writes the equivalent `FileChanged` entry into `~/.codex/hooks.json`,
calling `wa-mcp inbox drain` (exit `2` signals new events).

## 3. Generic (no host hooks)

Watch the inbox file directly — every matching message appends one JSON line:

```bash
tail -F ~/.wa-mcp/subs/<subscription-id>/inbox.jsonl
```

Or use MCP-native push: an MCP client declares
`resources: { subscribe: true }` (wa-mcp already advertises it), calls
`resources/subscribe` with `wa://unread` or `wa://chats`, and receives
`notifications/resources/updated` frames on the push stream.

## Reading events out of the inbox

`wa-mcp inbox drain` is the reader commands and hooks share:

```bash
wa-mcp inbox drain --inbox ~/.wa-mcp/subs/<subscription-id>/inbox.jsonl
```

- exit `2` with `N new: <chat>: <snippet>` when new events arrived (and it
  advances the cursor)
- exit `0` with `inbox: 0 new` when nothing is new
- after inbox rotation it resets the cursor and reports the new lines

## Notification rules with delivery channels

`add_notification_rule`-style rules can name where a match goes:

```json
{
  "title": "ping {chat}",
  "body": "new message",
  "deliver": ["mcp", "file", "ui"],
  "sub_id": "<subscription-id>"
}
```

- `mcp` — the match is emitted as a `notifications/message` frame on the
  `/api/mcp-notify` stream (logger `wa-mcp.rules`)
- `file` — the match is delivered as a `kind: "rule"` event through the named
  subscription's delivery mode (`sub_id` required)
- `ui` — the match is emitted as a `wa.rule` event on the web UI event
  stream

## Web UI

The Subscriptions page at `#/subscriptions` lists every subscription (chats,
filter, delivery, on/off), and its form walks through name and chats, filter,
prompt and delivery. Inbox subscriptions show the drain and hook commands with
Copy buttons.

## Older subscriptions

Subscriptions created before this model are imported at daemon start with
the same id (so installed hooks keep their inbox path), named
`Imported <id>`, inbox delivery. `GET /api/subscriptions` still lists the old
rows; `POST /api/subscriptions` answers `410 Gone` — use `POST /api/subs2`.
