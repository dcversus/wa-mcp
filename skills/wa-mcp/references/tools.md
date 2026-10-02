# wa-mcp tool reference

All tools take JSON arguments and return `{ content: [{ type: "text", text }] }`. Transport: stdio (`wa-mcp-mcp-server`) or `POST /mcp` on the bridge. Auth: bearer `WA_TOKEN`.

## Messaging

### send_message

input schema: `{ chat_jid: string, text: string }` — both required. Chat may be a phone number, group jid, or any chat jid; the bridge normalizes and validates (400 `INVALID_JID` when unresolvable).

### send_media

input schema: `{ kind: "image"|"video"|"audio"|"document"|"sticker", chat_jid: string, media: { base64? | path? | url? }, caption?: string, file_name?: string }`. `path` is confined to the bridge media dir. Size cap 20MB (413 `TOO_LARGE`).

### send_reaction

`{ chat_jid, message_id, emote }` — emote is a single emoji string.

### edit_message

`{ chat_jid, message_id, text }` — edits a message you sent.

### forward_message

`{ chat_jid, message_id }` — forwards a stored message; source resolved from the store.

### send_voice_note

`{ text, chat_jid }` — TTS (mock engine) sent as push-to-talk audio.

## Reading

### list_chats

`{ limit?: number (1-200, default 50), archived?: boolean }` → chats with `unreadCount` and `lastMessage`.

### list_messages

`{ chat_jid: string, sender?: string, after?: ISO, before?: ISO, limit?: number, offset?: number }` — newest first; `after`/`before` are instants.

### search_messages

`{ q: string, chat_jid?: string, limit?: number }` — FTS with AND/OR and `"quoted phrases"`; falls back to LIKE safely.

### get_message_context

`{ message_id: string, radius?: number }` — before/target/after window.

### get_chat

`{ chat_jid }` — one chat summary or "chat not found".

### get_unread_counts

`{}` → per-chat nonzero counts, newest activity first.

### get_media

`{ message_id }` — downloads the message's media; returns `{ path, mime, size }` so you can read the local file.

## Chats & groups

### mark_chat_read

`{ chat_jid }` — marks every unread message of the chat read.

### set_chat_state

`{ chat_jid, archived?: boolean, pinned?: boolean, muted_until?: string|null }` — at least one flag.

### create_group

`{ subject: string, participants: string[] }` — participants are phone numbers or jids.

### update_group_participants

`{ group_jid, jids: string[], action: "add"|"remove"|"promote"|"demote" }` — 400 on other actions.

### update_group_meta

`{ group_jid, subject?: string, description?: string }` — at least one.

### leave_group

`{ group_jid }`.

### get_group_invite

`{ group_jid }` → `{ invite_code }`.

## Contacts & profile

### list_contacts

`{ query?: string, limit?: number }` — case-insensitive over name/pushname/jid.

### set_alias

`{ alias, jid }` — remember a contact under a short alias.

### update_profile

`{ name?: string, status?: string }` — at least one.

### set_privacy

`{ key: "readReceipts"|"online"|"lastSeen"|"profilePic"|"status"|"groups"|"calls"|"messages", value: string }` — allowed values per key are validated by the bridge (400 `VALIDATION_ERROR` lists them).

### block_unblock

`{ jid, block: boolean }`.

### get_blocklist

`{}` → `{ blocklist: [...] }`.

## Ops

### list_notification_rules / delete_notification_rule

`{}` / `{ id: number }`.

### add_notification_rule

`{ title: string, body?: string, chat_jid?: string, from_jid?: string, unread_only?: boolean }` — templates substitute `{{chat}}`, `{{sender}}`, `{{text}}`.

### transcribe_message

`{ message_id }` → `{ text, language?, engine, cached }`. Engines: `mock` (default, `WA_TRANSCRIBE_ENGINE`); openai/whisper planned.
