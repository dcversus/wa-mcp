# Tool reference

Generated from the MCP registry (`scripts/gen-docs.ts`) — 30 tools. Regenerate with `pnpm run docs:gen`.

### send_message

Send a WhatsApp text message. Accepts phone numbers, group JIDs, or any chat jid.

```json
{
  "type": "object",
  "required": ["chat_jid", "text"],
  "properties": {
    "chat_jid": {
      "type": "string",
      "description": "Recipient: phone number, group JID, or any chat JID"
    },
    "text": { "type": "string", "description": "Message text" }
  }
}
```

- `chat_jid` (string, required) — Recipient: phone number, group JID, or any chat JID
- `text` (string, required) — Message text
- required: `chat_jid`, `text`

### list_chats

List WhatsApp chats with unread counts and last-message previews.

```json
{
  "type": "object",
  "properties": {
    "limit": { "type": "number", "description": "Max chats to return (1-200, default 50)" },
    "archived": { "type": "boolean", "description": "Show archived chats instead" }
  }
}
```

- `limit` (number, optional) — Max chats to return (1-200, default 50)
- `archived` (boolean, optional) — Show archived chats instead

### list_messages

List messages of one chat, newest first.

```json
{
  "type": "object",
  "required": ["chat_jid"],
  "properties": {
    "chat_jid": { "type": "string" },
    "limit": { "type": "number" },
    "after": { "type": "string", "description": "ISO instant" },
    "before": { "type": "string", "description": "ISO instant" }
  }
}
```

- `chat_jid` (string, required)
- `limit` (number, optional)
- `after` (string, optional) — ISO instant
- `before` (string, optional) — ISO instant
- required: `chat_jid`

### search_messages

Full-text search across all stored WhatsApp messages.

```json
{
  "type": "object",
  "required": ["q"],
  "properties": {
    "q": { "type": "string", "description": "Search query (FTS operators AND/OR/quoted phrases)" },
    "chat_jid": { "type": "string", "description": "Restrict to one chat" },
    "limit": { "type": "number" }
  }
}
```

- `q` (string, required) — Search query (FTS operators AND/OR/quoted phrases)
- `chat_jid` (string, optional) — Restrict to one chat
- `limit` (number, optional)
- required: `q`

### get_message_context

Get the messages immediately before and after one message in its chat.

```json
{
  "type": "object",
  "required": ["message_id"],
  "properties": {
    "message_id": { "type": "string" },
    "radius": { "type": "number", "description": "Rows on each side (default 3)" }
  }
}
```

- `message_id` (string, required)
- `radius` (number, optional) — Rows on each side (default 3)
- required: `message_id`

### send_media

Send an image, video, audio, document or sticker. Media comes from base64, a bridge-local path or a URL.

```json
{
  "type": "object",
  "required": ["kind", "chat_jid", "media"],
  "properties": {
    "kind": { "type": "string", "description": "image | video | audio | document | sticker" },
    "chat_jid": { "type": "string" },
    "media": {
      "type": "object",
      "description": "Exactly one of base64, path (bridge media dir) or url",
      "properties": {
        "base64": { "type": "string" },
        "path": { "type": "string" },
        "url": { "type": "string" }
      }
    },
    "caption": { "type": "string" },
    "file_name": { "type": "string" }
  }
}
```

- `kind` (string, required) — image | video | audio | document | sticker
- `chat_jid` (string, required)
- `media` (object, required) — Exactly one of base64, path (bridge media dir) or url
- `caption` (string, optional)
- `file_name` (string, optional)
- required: `kind`, `chat_jid`, `media`

### get_chat

Get one chat's summary (name, unread count, last message).

```json
{ "type": "object", "required": ["chat_jid"], "properties": { "chat_jid": { "type": "string" } } }
```

- `chat_jid` (string, required)
- required: `chat_jid`

### send_reaction

React to a message with an emoji.

```json
{
  "type": "object",
  "required": ["chat_jid", "message_id", "emote"],
  "properties": {
    "chat_jid": { "type": "string" },
    "message_id": { "type": "string" },
    "emote": { "type": "string" }
  }
}
```

- `chat_jid` (string, required)
- `message_id` (string, required)
- `emote` (string, required)
- required: `chat_jid`, `message_id`, `emote`

### edit_message

Edit a message you sent.

```json
{
  "type": "object",
  "required": ["chat_jid", "message_id", "text"],
  "properties": {
    "chat_jid": { "type": "string" },
    "message_id": { "type": "string" },
    "text": { "type": "string" }
  }
}
```

- `chat_jid` (string, required)
- `message_id` (string, required)
- `text` (string, required)
- required: `chat_jid`, `message_id`, `text`

### forward_message

Forward a stored message to another chat.

```json
{
  "type": "object",
  "required": ["chat_jid", "message_id"],
  "properties": {
    "chat_jid": { "type": "string", "description": "Destination chat" },
    "message_id": { "type": "string", "description": "Stored message to forward" }
  }
}
```

- `chat_jid` (string, required) — Destination chat
- `message_id` (string, required) — Stored message to forward
- required: `chat_jid`, `message_id`

### mark_chat_read

Mark every unread message of one chat as read.

```json
{ "type": "object", "required": ["chat_jid"], "properties": { "chat_jid": { "type": "string" } } }
```

- `chat_jid` (string, required)
- required: `chat_jid`

### set_chat_state

Set chat flags: archived, pinned, muted until (ISO instant or null).

```json
{
  "type": "object",
  "required": ["chat_jid"],
  "properties": {
    "chat_jid": { "type": "string" },
    "archived": { "type": "boolean" },
    "pinned": { "type": "boolean" },
    "muted_until": { "type": "string", "description": "ISO instant, or null to unmute" }
  }
}
```

- `chat_jid` (string, required)
- `archived` (boolean, optional)
- `pinned` (boolean, optional)
- `muted_until` (string, optional) — ISO instant, or null to unmute
- required: `chat_jid`

### list_contacts

List or search stored WhatsApp contacts.

```json
{
  "type": "object",
  "properties": {
    "query": {
      "type": "string",
      "description": "Case-insensitive search over name, pushname and jid"
    },
    "limit": { "type": "number" }
  }
}
```

- `query` (string, optional) — Case-insensitive search over name, pushname and jid
- `limit` (number, optional)

### set_alias

Remember a contact under a short alias that other tools can resolve.

```json
{
  "type": "object",
  "required": ["alias", "jid"],
  "properties": { "alias": { "type": "string" }, "jid": { "type": "string" } }
}
```

- `alias` (string, required)
- `jid` (string, required)
- required: `alias`, `jid`

### get_unread_counts

Per-chat unread message counts (nonzero only, newest activity first).

```json
{ "type": "object", "properties": {} }
```

### update_profile

Update your WhatsApp profile name and/or about status.

```json
{
  "type": "object",
  "properties": {
    "name": { "type": "string" },
    "status": { "type": "string", "description": "About text" }
  }
}
```

- `name` (string, optional)
- `status` (string, optional) — About text

### set_privacy

Set one privacy setting. Keys: readReceipts, online, lastSeen, profilePic, status, groups, calls, messages.

```json
{
  "type": "object",
  "required": ["key", "value"],
  "properties": {
    "key": {
      "type": "string",
      "description": "readReceipts | online | lastSeen | profilePic | status | groups | calls | messages"
    },
    "value": { "type": "string", "description": "Allowed values depend on the key" }
  }
}
```

- `key` (string, required) — readReceipts | online | lastSeen | profilePic | status | groups | calls | messages
- `value` (string, required) — Allowed values depend on the key
- required: `key`, `value`

### block_unblock

Block or unblock a contact.

```json
{
  "type": "object",
  "required": ["jid", "block"],
  "properties": { "jid": { "type": "string" }, "block": { "type": "boolean" } }
}
```

- `jid` (string, required)
- `block` (boolean, required)
- required: `jid`, `block`

### get_blocklist

List blocked contacts.

```json
{ "type": "object", "properties": {} }
```

### get_media

Download the media of a stored message (image/video/audio/document/sticker) and return its local file metadata.

```json
{
  "type": "object",
  "required": ["message_id"],
  "properties": { "message_id": { "type": "string" } }
}
```

- `message_id` (string, required)
- required: `message_id`

### list_notification_rules

List configured notification rules.

```json
{ "type": "object", "properties": {} }
```

### add_notification_rule

Add a notification rule. Matchers: chat_jid, from_jid, unread_only. Templates substitute {{chat}}, {{sender}}, {{text}}.

```json
{
  "type": "object",
  "required": ["title"],
  "properties": {
    "title": { "type": "string", "description": "Title template" },
    "body": { "type": "string", "description": "Body template" },
    "chat_jid": { "type": "string", "description": "Only messages in this chat" },
    "from_jid": { "type": "string", "description": "Only messages from this sender" },
    "unread_only": { "type": "boolean", "description": "Skip your own outgoing messages" }
  }
}
```

- `title` (string, required) — Title template
- `body` (string, optional) — Body template
- `chat_jid` (string, optional) — Only messages in this chat
- `from_jid` (string, optional) — Only messages from this sender
- `unread_only` (boolean, optional) — Skip your own outgoing messages
- required: `title`

### delete_notification_rule

Delete a notification rule by id.

```json
{ "type": "object", "required": ["id"], "properties": { "id": { "type": "number" } } }
```

- `id` (number, required)
- required: `id`

### create_group

Create a WhatsApp group with a subject and initial participants.

```json
{
  "type": "object",
  "required": ["subject", "participants"],
  "properties": {
    "subject": { "type": "string" },
    "participants": {
      "type": "array",
      "items": { "type": "string" },
      "description": "Phone numbers or jids"
    }
  }
}
```

- `subject` (string, required)
- `participants` (array, required) — Phone numbers or jids
- required: `subject`, `participants`

### update_group_participants

Add, remove, promote or demote group participants.

```json
{
  "type": "object",
  "required": ["group_jid", "jids", "action"],
  "properties": {
    "group_jid": { "type": "string" },
    "jids": { "type": "array", "items": { "type": "string" } },
    "action": { "type": "string", "description": "add | remove | promote | demote" }
  }
}
```

- `group_jid` (string, required)
- `jids` (array, required)
- `action` (string, required) — add | remove | promote | demote
- required: `group_jid`, `jids`, `action`

### update_group_meta

Update a group's subject and/or description.

```json
{
  "type": "object",
  "required": ["group_jid"],
  "properties": {
    "group_jid": { "type": "string" },
    "subject": { "type": "string" },
    "description": { "type": "string" }
  }
}
```

- `group_jid` (string, required)
- `subject` (string, optional)
- `description` (string, optional)
- required: `group_jid`

### leave_group

Leave a group.

```json
{ "type": "object", "required": ["group_jid"], "properties": { "group_jid": { "type": "string" } } }
```

- `group_jid` (string, required)
- required: `group_jid`

### get_group_invite

Get a group's invite code.

```json
{ "type": "object", "required": ["group_jid"], "properties": { "group_jid": { "type": "string" } } }
```

- `group_jid` (string, required)
- required: `group_jid`

### transcribe_message

Transcribe a voice note or audio message to text (mock engine by default).

```json
{
  "type": "object",
  "required": ["message_id"],
  "properties": { "message_id": { "type": "string" } }
}
```

- `message_id` (string, required)
- required: `message_id`

### send_voice_note

Synthesize text to speech (mock engine) and send it as a push-to-talk voice note.

```json
{
  "type": "object",
  "required": ["text", "chat_jid"],
  "properties": { "text": { "type": "string" }, "chat_jid": { "type": "string" } }
}
```

- `text` (string, required)
- `chat_jid` (string, required)
- required: `text`, `chat_jid`
