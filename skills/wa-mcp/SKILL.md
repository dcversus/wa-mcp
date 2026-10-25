---
name: wa-mcp
description: Use when the user asks to send/read/search WhatsApp messages, manage chats/groups/contacts, or pair a device
---

# wa-mcp — WhatsApp over MCP

All tools talk to the local bridge at `WA_BRIDGE_URL` (default `http://127.0.0.1:8080`) with `WA_TOKEN` as bearer. Without a token every call returns 401.

## Quickstart

1. `wa-mcp install` — writes MCP client configs (claude-code, claude-desktop, codex, pi, grok, antigravity).
2. `wa-mcp start` then scan the QR (bridge prints it; also at `#/pairing` in the web UI).
3. `wa-mcp doctor` — verify node, data dir, token, bridge health.
4. `send_message` with a phone number or group jid.

## Safety

- Never bulk-send; the bridge paces sends and caps per day (`WA_DAILY_CAP`).
- Respect allowlist discipline: confirm the recipient with the user before first contact.
- `WA_SENDS_DISABLED=1` is a kill switch — sends will 403.

## Tools

### Messaging

- `send_message` — send a text to a chat (chat_jid + text).
- `send_media` — send image/video/audio/document/sticker from base64, bridge-local path or URL.
- `send_reaction` — react to a message (chat, message_id, emote).
- `edit_message` — edit one of your sent messages.
- `forward_message` — forward a stored message to another chat.
- `send_voice_note` — synthesize text and send as a push-to-talk voice note.

### Reading

- `list_chats` — chats with unread counts and last-message preview.
- `list_messages` — messages of one chat, newest first (filter by sender/after/before).
- `search_messages` — full-text search across all stored messages.
- `get_message_context` — messages immediately before/after one message.
- `get_chat` — one chat's summary.
- `get_unread_counts` — per-chat unread counts.
- `get_media` — download a message's media to the local media dir.

### Chats & groups

- `mark_chat_read` — mark all unread messages of a chat read.
- `set_chat_state` — archive/pin/mute a chat.
- `create_group` — create a group with participants.
- `update_group_participants` — add/remove/promote/demote.
- `update_group_meta` — change group subject/description.
- `leave_group` — leave a group.
- `get_group_invite` — fetch a group's invite code.

### Contacts & profile

- `list_contacts` — search stored contacts.
- `set_alias` — remember a contact under an alias.
- `update_profile` — set your profile name/about.
- `set_privacy` — set one privacy setting (readReceipts, online, lastSeen, profilePic, status, groups, calls, messages).
- `block_unblock` — block or unblock a contact.
- `get_blocklist` — list blocked contacts.

### Ops

- `list_notification_rules` / `add_notification_rule` / `delete_notification_rule` — notification rules.
- `transcribe_message` — transcribe a voice note to text.
- `subscribe_events` with `channel: true` delivers a chat live into the Claude Code session as channel notifications (reply via send_message with meta.chat_id); each subscribed chat is its own channel.
- voice notes can also arrive as `/voice` dictation in Claude Code: `wa-mcp voice install` puts rec/sox shims on PATH so holding the dictation key transcribes the next WhatsApp voice note (`wa-mcp voice test` verifies; docs/cookbook/voice-dictation.md).

Full reference with input schemas: `references/tools.md`. Errors and fixes: `references/troubleshooting.md`.
