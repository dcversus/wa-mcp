# React to WhatsApp messages from your agent

wa-mcp gives an agent three ways to notice and react to incoming WhatsApp
messages. All three manage the same subscription registry.

## 1. Claude Code (hooks)

Create a subscription, then install the hooks:

```bash
wa-mcp subscribe --chat 120363428874442773@g.us --kind message
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
- `file` — the match appends a `kind: "rule"` line to the named
  subscription's inbox (`sub_id` required)
- `ui` — the match is emitted as a `wa.rule` event on the web UI event
  stream

## Web UI

The Subscriptions panel at `#/subscriptions` creates and removes
subscriptions, shows each inbox path, and offers a copyable hook snippet.
