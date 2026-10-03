# Migration

## From lharries-layout / Go-fork stores

The store schema (ADR 0007) is a superset of both upstream layouts: the
messages table carries the same 13 columns (id, chat_jid, sender_jid,
sender_name, timestamp ISO-8601, content, media_type, media_path,
quoted_message_id, mentions, is_from_me, is_unread, reactions) plus `raw`
(full proto JSON). Foreign-layout import is a store-layer path — row counts
and resolvable sender names are compared as part of the store contracts.

## LID ↔ phone-number chat split (LID-era accounts)

LID-addressed accounts store incoming messages keyed by `…@lid` while
outbound sends may be keyed by `…@s.whatsapp.net` — one person, two chat rows.
Current main resolves BOTH directions at ingest/send through the engine's
`signalRepository.lidMapping` (full-jid contract, see `src/send/send.ts`
comments), so new fragmentation cannot occur.

For rows already split, a one-time merge exists:

```
vp run merge-lid-chats --data-dir ~/.wa-mcp
```

Per LID chat, in one transaction: messages move into the canonical PN chat
(`INSERT OR IGNORE` — duplicate ids keep the original), read_state counts
merge, chat metadata newer-wins, the LID chat row is deleted. Chats without a
reverse mapping (`lid-mapping-<lid>_reverse.json` in the auth dir) are left
untouched. Run a second time after more mappings appear.
