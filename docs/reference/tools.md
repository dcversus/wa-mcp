# Tool reference

Generated from the MCP registry (`scripts/gen-docs.ts`) — 62 tools. Regenerate with `pnpm run docs:gen`.

### get_login_qr

Get the current WhatsApp login QR code + pairing instructions. Returns NOT_PAIRING once connected.

```json
{ "type": "object", "properties": {} }
```

### send_message

Send a WhatsApp message: plain text, link card, status broadcast, buttons or a list.

```json
{
  "type": "object",
  "required": ["text"],
  "properties": {
    "chat_jid": {
      "type": "string",
      "description": "Recipient: phone number, group JID, or any chat JID (required unless status_broadcast is true)"
    },
    "text": { "type": "string", "description": "Message text" },
    "reply_to_message_id": {
      "type": "string",
      "description": "Quote this message id (the reply renders with quoted context)"
    },
    "mentions": {
      "type": "array",
      "description": "JIDs to @-mention (rendered as mentions, not plain text)",
      "items": { "type": "string" }
    },
    "link_preview": {
      "type": "boolean",
      "description": "Send text as a link card — the bridge forces an engine link preview; pair with url or embed a URL in text"
    },
    "url": {
      "type": "string",
      "description": "URL to preview when link_preview is true (defaults to the first URL in text)"
    },
    "status_broadcast": {
      "type": "boolean",
      "description": "Post the text to your status (status@broadcast) instead of a chat — chat_jid not required"
    },
    "buttons": {
      "type": "array",
      "description": "Quick-reply buttons under the text. Renders for WhatsApp Business accounts only.",
      "items": {
        "type": "object",
        "required": ["label"],
        "properties": { "label": { "type": "string", "description": "Button label" } }
      }
    },
    "interactive": {
      "type": "object",
      "description": "Rich button message (title, body, footer). Renders for WhatsApp Business accounts only.",
      "properties": {
        "title": { "type": "string", "description": "Message title (content text)" },
        "description": { "type": "string", "description": "Body appended under the title" },
        "footer": { "type": "string", "description": "Footer line above the buttons" },
        "buttons": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["label"],
            "properties": { "label": { "type": "string" } }
          }
        }
      }
    },
    "location": {
      "type": "object",
      "description": "Send a location pin instead of text.",
      "properties": {
        "latitude": { "type": "number", "description": "Degrees latitude" },
        "longitude": { "type": "number", "description": "Degrees longitude" },
        "label": { "type": "string", "description": "Optional place name" }
      }
    },
    "contact": {
      "type": "object",
      "description": "Send a contact card (vcard) instead of text.",
      "properties": {
        "name": { "type": "string", "description": "Display name for the card" },
        "phones": {
          "type": "array",
          "description": "Phone numbers embedded in the vcard",
          "items": { "type": "string" }
        }
      }
    },
    "poll": {
      "type": "object",
      "description": "Send a poll instead of text. The bridge validates 2-12 unique non-empty options.",
      "properties": {
        "question": { "type": "string", "description": "Poll question" },
        "options": { "type": "array", "items": { "type": "string" } },
        "selectableCount": { "type": "number", "description": "Selectable options (default all)" }
      }
    },
    "list": {
      "type": "object",
      "description": "List message with sections and rows. Renders for WhatsApp Business accounts only.",
      "properties": {
        "title": { "type": "string", "description": "List title" },
        "description": { "type": "string", "description": "List subtitle" },
        "sections": {
          "type": "array",
          "items": {
            "type": "object",
            "required": ["title", "rows"],
            "properties": {
              "title": { "type": "string", "description": "Section title" },
              "rows": {
                "type": "array",
                "items": {
                  "type": "object",
                  "required": ["title"],
                  "properties": {
                    "title": { "type": "string", "description": "Row title" },
                    "description": { "type": "string", "description": "Row subtitle" }
                  }
                }
              }
            }
          }
        }
      }
    }
  }
}
```

- `chat_jid` (string, optional) — Recipient: phone number, group JID, or any chat JID (required unless status_broadcast is true)
- `text` (string, required) — Message text
- `reply_to_message_id` (string, optional) — Quote this message id (the reply renders with quoted context)
- `mentions` (array, optional) — JIDs to @-mention (rendered as mentions, not plain text)
- `link_preview` (boolean, optional) — Send text as a link card — the bridge forces an engine link preview; pair with url or embed a URL in text
- `url` (string, optional) — URL to preview when link_preview is true (defaults to the first URL in text)
- `status_broadcast` (boolean, optional) — Post the text to your status (status@broadcast) instead of a chat — chat_jid not required
- `buttons` (array, optional) — Quick-reply buttons under the text. Renders for WhatsApp Business accounts only.
- `interactive` (object, optional) — Rich button message (title, body, footer). Renders for WhatsApp Business accounts only.
- `location` (object, optional) — Send a location pin instead of text.
- `contact` (object, optional) — Send a contact card (vcard) instead of text.
- `poll` (object, optional) — Send a poll instead of text. The bridge validates 2-12 unique non-empty options.
- `list` (object, optional) — List message with sections and rows. Renders for WhatsApp Business accounts only.
- required: `text`

### list_chats

List WhatsApp chats with unread counts and last-message previews.

```json
{
  "type": "object",
  "properties": {
    "limit": { "type": "number", "description": "Max chats to return (1-200, default 50)" },
    "offset": { "type": "number", "description": "Skip this many chats (pagination)" },
    "archived": { "type": "boolean", "description": "Show archived chats instead" }
  }
}
```

- `limit` (number, optional) — Max chats to return (1-200, default 50)
- `offset` (number, optional) — Skip this many chats (pagination)
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
    "offset": {
      "type": "number",
      "description": "Skip this many rows (pagination; meta.nextOffset)"
    },
    "after": { "type": "string", "description": "ISO instant" },
    "before": { "type": "string", "description": "ISO instant" }
  }
}
```

- `chat_jid` (string, required)
- `limit` (number, optional)
- `offset` (number, optional) — Skip this many rows (pagination; meta.nextOffset)
- `after` (string, optional) — ISO instant
- `before` (string, optional) — ISO instant
- required: `chat_jid`

### search_messages

Full-text search across all stored WhatsApp messages.

```json
{
  "type": "object",
  "required": ["query"],
  "properties": {
    "query": {
      "type": "string",
      "description": "Search query (FTS operators AND/OR/quoted phrases); legacy alias: q"
    },
    "chat_jid": { "type": "string", "description": "Restrict to one chat" },
    "limit": { "type": "number" }
  }
}
```

- `query` (string, required) — Search query (FTS operators AND/OR/quoted phrases); legacy alias: q
- `chat_jid` (string, optional) — Restrict to one chat
- `limit` (number, optional)
- required: `query`

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

### catch_up

Catch-up digest across all chats since a date: active chats, message counts, questions and media.

```json
{
  "type": "object",
  "required": ["since"],
  "properties": { "since": { "type": "string", "description": "ISO timestamp to catch up from" } }
}
```

- `since` (string, required) — ISO timestamp to catch up from
- required: `since`

### digest_group

Summarize one chat since a date: message counts, top participants, open questions and media.

```json
{
  "type": "object",
  "required": ["chat_jid", "since"],
  "properties": {
    "chat_jid": { "type": "string", "description": "Chat or group JID" },
    "since": { "type": "string", "description": "ISO timestamp to summarize from" }
  }
}
```

- `chat_jid` (string, required) — Chat or group JID
- `since` (string, required) — ISO timestamp to summarize from
- required: `chat_jid`, `since`

### fetch_history

Ask WhatsApp to sync older messages for one chat; they arrive asynchronously into the store.

```json
{
  "type": "object",
  "required": ["chat_jid"],
  "properties": {
    "chat_jid": { "type": "string", "description": "Chat JID to backfill" },
    "count": { "type": "number", "description": "Approximate message count (default 25)" }
  }
}
```

- `chat_jid` (string, required) — Chat JID to backfill
- `count` (number, optional) — Approximate message count (default 25)
- required: `chat_jid`

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

### delete_message

Delete a message for everyone (WhatsApp revoke). The local row is tombstoned.

```json
{
  "type": "object",
  "required": ["chat_jid", "message_id"],
  "properties": {
    "chat_jid": { "type": "string", "description": "Chat containing the message" },
    "message_id": { "type": "string", "description": "Message id to delete" }
  }
}
```

- `chat_jid` (string, required) — Chat containing the message
- `message_id` (string, required) — Message id to delete
- required: `chat_jid`, `message_id`

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

### set_presence

Send a presence or typing signal: composing/recording/paused for one chat, or available/unavailable globally.

```json
{
  "type": "object",
  "required": ["presence"],
  "properties": {
    "chat_jid": {
      "type": "string",
      "description": "Chat to direct the typing signal at (optional for available/unavailable)"
    },
    "presence": {
      "type": "string",
      "description": "one of available, unavailable, composing, recording, paused",
      "enum": ["available", "unavailable", "composing", "recording", "paused"]
    }
  }
}
```

- `chat_jid` (string, optional) — Chat to direct the typing signal at (optional for available/unavailable)
- `presence` (string, required) — one of available, unavailable, composing, recording, paused
- required: `presence`

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

### get_pairing_code

Request a pairing code to link a device (bridge must be in qr/connecting state).

```json
{
  "type": "object",
  "required": ["phone"],
  "properties": {
    "phone": { "type": "string", "description": "Phone number, 8-15 digits after stripping" }
  }
}
```

- `phone` (string, required) — Phone number, 8-15 digits after stripping
- required: `phone`

### restrict_sending

Manage per-target send rules (T82). action=add requires target + mode (block|allow, optional expires_at ISO); action=list lists rules; action=remove requires id.

```json
{
  "type": "object",
  "required": ["action"],
  "properties": {
    "action": { "type": "string", "enum": ["add", "list", "remove"] },
    "target": { "type": "string", "description": "JID pattern; trailing * matches any suffix" },
    "mode": { "type": "string", "enum": ["block", "allow"] },
    "expires_at": { "type": "string", "description": "ISO timestamp after which the rule lapses" },
    "id": { "type": "number", "description": "Rule id (action=remove)" }
  }
}
```

- `action` (string, required)
- `target` (string, optional) — JID pattern; trailing * matches any suffix
- `mode` (string, optional)
- `expires_at` (string, optional) — ISO timestamp after which the rule lapses
- `id` (number, optional) — Rule id (action=remove)
- required: `action`

### autoreply_set

Manage autoreply rules. action=add requires match (regex) + reply; list lists; remove/toggle require id (toggle also uses enabled).

```json
{
  "type": "object",
  "required": ["action"],
  "properties": {
    "action": { "type": "string", "enum": ["add", "list", "remove", "toggle"] },
    "match": { "type": "string", "description": "Regex matched case-insensitively" },
    "reply": { "type": "string" },
    "id": { "type": "number" },
    "enabled": { "type": "boolean" }
  }
}
```

- `action` (string, required)
- `match` (string, optional) — Regex matched case-insensitively
- `reply` (string, optional)
- `id` (number, optional)
- `enabled` (boolean, optional)
- required: `action`

### create_template

Create or update a message template with {{var}} placeholders.

```json
{
  "type": "object",
  "required": ["name", "body"],
  "properties": {
    "name": { "type": "string" },
    "body": { "type": "string", "description": "Template body; {{var}} placeholders allowed" }
  }
}
```

- `name` (string, required)
- `body` (string, required) — Template body; {{var}} placeholders allowed
- required: `name`, `body`

### list_templates

List saved message templates.

```json
{ "type": "object", "properties": {} }
```

### send_template

Render a saved template for a chat and send it. Missing variables are reported without sending.

```json
{
  "type": "object",
  "required": ["chat_jid", "name"],
  "properties": {
    "chat_jid": { "type": "string" },
    "name": { "type": "string", "description": "Template name" },
    "vars": { "type": "object", "description": "Placeholder values, e.g. { \"name\": \"V\" }" }
  }
}
```

- `chat_jid` (string, required)
- `name` (string, required) — Template name
- `vars` (object, optional) — Placeholder values, e.g. { "name": "V" }
- required: `chat_jid`, `name`

### schedule_message

Schedule a text message for later delivery (daemon scheduler tick).

```json
{
  "type": "object",
  "required": ["chat_jid", "text", "send_at"],
  "properties": {
    "chat_jid": { "type": "string" },
    "text": { "type": "string" },
    "send_at": { "type": "string", "description": "ISO timestamp" }
  }
}
```

- `chat_jid` (string, required)
- `text` (string, required)
- `send_at` (string, required) — ISO timestamp
- required: `chat_jid`, `text`, `send_at`

### list_scheduled

List scheduled messages, optionally by status (pending|sent|failed|cancelled).

```json
{
  "type": "object",
  "properties": {
    "status": { "type": "string", "enum": ["pending", "sent", "failed", "cancelled"] }
  }
}
```

- `status` (string, optional)

### export_chat

Export one chat's messages as jsonl, markdown or plain text (media referenced by type only).

```json
{
  "type": "object",
  "required": ["chat_jid"],
  "properties": {
    "chat_jid": { "type": "string" },
    "format": { "type": "string", "enum": ["jsonl", "md", "txt"] }
  }
}
```

- `chat_jid` (string, required)
- `format` (string, optional)
- required: `chat_jid`

### export_unread_messages

Export every unread message across chats as JSONL with chat attribution.

```json
{
  "type": "object",
  "properties": { "format": { "type": "string", "enum": ["jsonl", "md", "txt"] } }
}
```

- `format` (string, optional)

### bulk_clear

Clear the unread markers on multiple chats at once.

```json
{
  "type": "object",
  "required": ["chat_jids"],
  "properties": { "chat_jids": { "type": "array", "items": { "type": "string" } } }
}
```

- `chat_jids` (array, required)
- required: `chat_jids`

### label_add

Create a label (name + color) in the daemon's label registry.

```json
{
  "type": "object",
  "required": ["name"],
  "properties": {
    "name": { "type": "string" },
    "color": { "type": "string", "description": "Hex color, default #000000" }
  }
}
```

- `name` (string, required)
- `color` (string, optional) — Hex color, default #000000
- required: `name`

### label_list

List labels — all registry labels, or (with chat_jid) the labels carried by one chat.

```json
{
  "type": "object",
  "properties": { "chat_jid": { "type": "string", "description": "Scope to one chat's labels" } }
}
```

- `chat_jid` (string, optional) — Scope to one chat's labels

### label_assign

Attach a label to a chat.

```json
{
  "type": "object",
  "required": ["chat_jid", "label_id"],
  "properties": { "chat_jid": { "type": "string" }, "label_id": { "type": "number" } }
}
```

- `chat_jid` (string, required)
- `label_id` (number, required)
- required: `chat_jid`, `label_id`

### label_remove

Delete a label from the registry (and every chat carrying it).

```json
{ "type": "object", "required": ["id"], "properties": { "id": { "type": "number" } } }
```

- `id` (number, required)
- required: `id`

### download_media

Force-download a media message (if not already stored) and return the local file path.

```json
{
  "type": "object",
  "required": ["message_id"],
  "properties": { "message_id": { "type": "string" } }
}
```

- `message_id` (string, required)
- required: `message_id`

### view_media

Return media content to the model: images as base64 (size-capped), videos sampled to <=8 frames via ffmpeg.

```json
{
  "type": "object",
  "required": ["chat_jid", "message_id"],
  "properties": { "chat_jid": { "type": "string" }, "message_id": { "type": "string" } }
}
```

- `chat_jid` (string, required)
- `message_id` (string, required)
- required: `chat_jid`, `message_id`

### transcribe_voice

Transcribe a voice note. Engines: WA_TRANSCRIBE_ENGINE=mock (default) | openai (any OpenAI-compatible endpoint). Live engines only with owner go-ahead.

```json
{
  "type": "object",
  "required": ["chat_jid", "message_id"],
  "properties": { "chat_jid": { "type": "string" }, "message_id": { "type": "string" } }
}
```

- `chat_jid` (string, required)
- `message_id` (string, required)
- required: `chat_jid`, `message_id`

### newsletter_follow

Follow a WhatsApp newsletter channel.

```json
{
  "type": "object",
  "required": ["jid"],
  "properties": { "jid": { "type": "string", "description": "Newsletter JID" } }
}
```

- `jid` (string, required) — Newsletter JID
- required: `jid`

### newsletter_unfollow

Unfollow a WhatsApp newsletter channel.

```json
{ "type": "object", "required": ["jid"], "properties": { "jid": { "type": "string" } } }
```

- `jid` (string, required)
- required: `jid`

### newsletter_send

Send a text bulletin to a newsletter channel you own.

```json
{
  "type": "object",
  "required": ["jid", "text"],
  "properties": {
    "jid": { "type": "string", "description": "Newsletter JID" },
    "text": { "type": "string" }
  }
}
```

- `jid` (string, required) — Newsletter JID
- `text` (string, required)
- required: `jid`, `text`

### newsletter_list

List followed newsletters from the daemon registry.

```json
{ "type": "object", "properties": {} }
```

### get_contact

Get one contact's detail by JID (name, pushname, business name, phone).

```json
{
  "type": "object",
  "required": ["jid"],
  "properties": {
    "jid": { "type": "string" },
    "with_photo": { "type": "boolean", "description": "Resolve the avatar URL too" }
  }
}
```

- `jid` (string, required)
- `with_photo` (boolean, optional) — Resolve the avatar URL too
- required: `jid`

### get_picture_url

Fetch a chat/contact profile picture URL (preview size).

```json
{ "type": "object", "required": ["jid"], "properties": { "jid": { "type": "string" } } }
```

- `jid` (string, required)
- required: `jid`

### get_poll_votes

Poll results: question + per-option vote counts and voter lists.

```json
{
  "type": "object",
  "required": ["chat_jid", "message_id"],
  "properties": { "chat_jid": { "type": "string" }, "message_id": { "type": "string" } }
}
```

- `chat_jid` (string, required)
- `message_id` (string, required)
- required: `chat_jid`, `message_id`

### cancel_scheduled

Cancel a pending scheduled message.

```json
{ "type": "object", "required": ["id"], "properties": { "id": { "type": "number" } } }
```

- `id` (number, required)
- required: `id`
