# Diagnostics

Tools for answering "what is the bridge doing right now?". For known failures and their fixes, see [Troubleshooting](./troubleshooting.md).

## `wa-mcp doctor`

```sh
wa-mcp doctor            # core checks
wa-mcp doctor --engines  # + media engine availability
```

Each check prints `ok` or `FAIL`. The command exits non-zero if any check fails. <!-- src: packages/cli/src/bin.ts:316-325 -->

| Check             | Passes when                                                      | Source                                         |
| ----------------- | ---------------------------------------------------------------- | ---------------------------------------------- |
| node version      | the Node major version meets the minimum                         | <!-- src: packages/cli/src/doctor.ts:26-31 --> |
| data dir writable | a probe file can be written to `dataDir`                         | <!-- src: packages/cli/src/doctor.ts:32-40 --> |
| bridge token      | `<dataDir>/token` exists with mode 0600 (not checked on Windows) | <!-- src: packages/cli/src/doctor.ts:41-57 --> |
| bridge health     | `GET <bridgeUrl>/health` returns 2xx                             | <!-- src: packages/cli/src/doctor.ts:58-71 --> |

The doctor requires Node major 22 (`cli/src/bin.ts:317`).

`--engines` adds one line per engine. Optional engines always report `ok`, as either `available` or `not-configured (optional) — <hint>`. Only the **selected** transcription engine can fail. <!-- src: packages/cli/src/doctor.ts:73-140 -->

| Engine                      | Optional?            | Hint when missing                                                         |
| --------------------------- | -------------------- | ------------------------------------------------------------------------- |
| ffmpeg (`WA_FFMPEG_BIN`)    | yes                  | `brew install ffmpeg`                                                     |
| pdftotext                   | yes                  | `brew install poppler`                                                    |
| openai (if selected)        | no                   | `wa-mcp config set transcription.api_key <key>`. The key is shown masked. |
| whisper-local (if selected) | no                   | `brew install whisper-cpp`; set `WA_WHISPER_MODEL` to a ggml `.bin`       |
| mlx (if selected)           | reported as optional | `pip install mlx-whisper`                                                 |

OCR (tesseract) isn't checked by `doctor --engines`.

## `/health`

The only unauthenticated JSON endpoint. It uses its own per-IP rate bucket (120/min). <!-- src: packages/bridge/src/http.ts:2390-2426 -->

```sh
curl -s http://127.0.0.1:8080/health | jq
```

| Field              | Meaning                                                                          |
| ------------------ | -------------------------------------------------------------------------------- |
| `status`           | engine state (`connected`, `reconnecting`, …)                                    |
| `connected`        | `status === "connected"`                                                         |
| `loggedIn`         | connected, or reconnecting with a paired account                                 |
| `pairingBlocked`   | the pairing budget is exhausted (see Troubleshooting → Pairing)                  |
| `pairingAttempts`  | `{ used, limit }`                                                                |
| `pairingToken`     | only present while unpaired                                                      |
| `uiBootstrapToken` | web UI bootstrap credential (see [Security](./security.md#auth-design-adr-0012)) |
| `channel`          | `baileys` or `cloud`                                                             |
| `credentialsValid` | cloud only: verify token present                                                 |
| `version`          | e.g. `0.9.0`                                                                     |
| `uptime`           | seconds since the HTTP server started                                            |
| `subscriptions`    | `{ count, dropped }`, where `dropped` counts failed inbox writes                 |
| `reconnects`       | reconnect counter                                                                |
| `lastDisconnectAt` | timestamp of the last disconnect                                                 |
| `contactsWarm`     | whether the contact cache is warm                                                |

Quick watch:

```sh
watch -n5 'curl -s http://127.0.0.1:8080/health | jq "{status,loggedIn,pairingBlocked,pairingAttempts,reconnects,subscriptions}"'
```

## Logs

The daemon writes **pino JSON lines to stderr**. The level comes from `WA_LOG_LEVEL` (default `info`). <!-- src: packages/bridge/src/bin.ts:175 --> Both `wa-mcp start` and the service units redirect output to `~/.wa-mcp/bridge.log`. <!-- src: packages/cli/src/bin.ts:366; packages/cli/src/service.ts:183, 215 -->

```sh
wa-mcp logs             # last 50 lines
wa-mcp logs --follow    # follow (polls every 500ms)
```

### Message log

`wa-mcp messages` is the WhatsApp message log — the same data as the web UI **Logs** page (`#/logs`), served by `GET /api/search`. It is a separate command so `wa-mcp logs` always means the daemon log (`logs --follow` used to be ambiguous between the two). <!-- src: packages/cli/src/messages.ts -->

```sh
wa-mcp messages                                            # newest messages, both directions
wa-mcp messages --chat Family --direction in --limit 20    # chat by name or jid
wa-mcp messages --person 358401112222@s.whatsapp.net --from 2026-10-01 --to 2026-10-07
wa-mcp messages --q invoice --follow                       # live tail (polls every 2s)
```

`/api/search` filters: `q` (optional — omit it to list everything), `chat_jid`, `from_jid`, `direction` (`in`|`out`), `since` / `until` (ISO date or epoch milliseconds, inclusive), `limit`, `offset`.

### Contacts

`wa-mcp contacts` lists your WhatsApp contacts — the same data as the web UI **Contacts** page (`#/contacts`), served by `GET /api/contacts`. Writes use the companion-device contact action WhatsApp Web uses (`addOrEditContact` / `removeContact`), so they sync to your account's address book, phone included. <!-- src: packages/cli/src/contacts.ts; packages/bridge/src/contact-sync.ts -->

```sh
wa-mcp contacts --q dana --saved                        # search name, username, alias or number
wa-mcp contacts add +358401234567 --name "Dana Scully" --username dana_s
wa-mcp contacts rename +358401234567 --name "Agent Scully"
wa-mcp contacts remove 358401234567@s.whatsapp.net
wa-mcp contacts sync --dry-run                           # preview the identity backfill; drop --dry-run to write
```

The daemon backfills contact identity at every start (and on `contacts sync` → `POST /api/contacts/sync[?dry_run=1]`): person chat titles fill `name`, inbound sender names fill `pushname`, and `<lid>@lid` rows fold into their phone-number row through the engine's lid mapping (`lid` column kept). It only fills blanks, never overwrites. Groups are not contacts, and a row with no name, phone or WhatsApp name is not listed. <!-- src: packages/bridge/src/store/contact-backfill.ts -->

| Route                                    | Body                              | Result                                                                                                                                                                    |
| ---------------------------------------- | --------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/contacts?q=&saved=true&limit=` | —                                 | `{contacts: [{jid, displayName, phone, name, pushname, username, lid, businessName, alias, source}], total}` — people only (groups, newsletters and broadcasts are chats) |
| `POST /api/contacts`                     | `{phone \| jid, name, username?}` | `201 {contact}`; a phone is resolved with `onWhatsApp` first — `422 NOT_ON_WHATSAPP` when it isn't registered                                                             |
| `PATCH /api/contacts/:phone-or-jid`      | `{name, username?}`               | `200 {contact}`                                                                                                                                                           |
| `DELETE /api/contacts/:phone-or-jid`     | —                                 | `200 {ok, removed}`; the saved name is cleared, the person's own WhatsApp name stays                                                                                      |

Errors: `400 VALIDATION_ERROR`, `503 NOT_CONNECTED` (writes need a live session), `502 CONTACT_SYNC_FAILED` / `CONTACT_LOOKUP_FAILED` (the engine rejected the app-state patch or lookup), `501` when no store is attached. Removals made on another device are not detected yet — the engine's `contacts.upsert` carries no removal flag.

### Connections

`wa-mcp connections` lists the agents wired to this daemon — the same data as the web UI **Connections** page (`#/connections`), served by `GET /api/connections`. The daemon reads the agent configs of the user it runs as: <!-- src: packages/bridge/src/connections.ts; packages/cli/src/connections.ts -->

- **Hooks** — `wa-mcp inbox drain` entries in `~/.claude/settings.json` (Claude Code) and `~/.codex/hooks.json` (Codex). Each entry is one connection; its subscription id comes from the inbox path (`…/subs/<id>/inbox.jsonl`). `disableAllHooks: true` shows it as disabled.
- **MCP** — a `wa-mcp` server entry in `~/.claude.json`, Claude Desktop's `claude_desktop_config.json`, `~/.cursor/mcp.json`, `~/.codex/config.toml` (`[mcp_servers.wa-mcp]`), `~/.pi/agent/mcp.json`, `~/.hermes/config.yaml`, `~/.grok/mcp.json` and `~/.gemini/antigravity/mcp_config.json`. `disabled: true` / `enabled = false` shows it as disabled.

```sh
wa-mcp connections                                   # AGENT  KIND  STATUS  SUBSCRIPTION
wa-mcp connections disconnect mcp cursor             # remove the wa-mcp server from Cursor's config
wa-mcp connections disconnect hooks claude --sub abc # remove only subscription abc's hook
```

| Route                                       | Result                                                                                                                                                                     |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/connections`                      | `{connections: [{kind, agent, label, configPath, detail, enabled, subId, inboxPath, subscription: {id, name, chatJid} \| null}], generatedAt}`                             |
| `DELETE /api/connections/:kind/:agent?sub=` | `200 {ok, removed}`; only wa-mcp entries are removed, everything else in the file is kept, and the previous file is saved as `<file>.bak-<time>`. `404` when not connected |

`detail` never carries secrets: env values and the values of token/key/secret/password arguments are shown as `[redacted]`.

pino levels: 30 = info, 40 = warn, 50 = error.

```sh
# warnings and errors only
tail -f ~/.wa-mcp/bridge.log | grep -E '"level":(40|50)'
# send failures (engine error logged verbatim)
tail -f ~/.wa-mcp/bridge.log | grep '"msg":"send failed"'
# connect / disconnect
tail -f ~/.wa-mcp/bridge.log | grep -Ei 'connection|disconnect|reconnect'
# pretty-print
tail -f ~/.wa-mcp/bridge.log | jq -c '{level,msg,code,err}'
```

`WA_LOG_LEVEL=debug` adds engine detail. Phone numbers are redacted to their last four digits. <!-- src: packages/bridge/src/bin.ts:63-65 -->

Filter pino JSON: `grep '"level":40'` warnings, `'"level":50'` errors, `grep connection` for open/close events.

## MCP transport

**stdio** (`packages/mcp-server`):

- JSON-RPC responses go to stdout, one per line. <!-- src: packages/mcp-server/src/bin.ts:131 -->
- After the client's first resource subscription, a pump opens `GET /api/mcp-notify` on the bridge. It forwards matching `notifications/*` frames to stdout as additional lines. <!-- src: packages/mcp-server/src/bin.ts:53-75 -->
- With no subscription, no pump runs and there are no notifications.

**HTTP** (`POST /mcp` on the bridge): <!-- src: packages/bridge/src/http.ts:1445-1495, 2553-2580 -->

1. `initialize` creates a session. The response carries `Mcp-Session-Id`.
2. Send that header on every later `POST /mcp`, so resource subscriptions attach to the session.
3. `GET /mcp` with the header opens an SSE stream. It begins with `: connected`, then sends `data: <notification>` frames. An unknown id returns 404 `SESSION_NOT_FOUND`.

```sh
TOKEN=$(cat ~/.wa-mcp/token)
curl -si -X POST http://127.0.0.1:8080/mcp \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}' | grep -i mcp-session-id
curl -N http://127.0.0.1:8080/mcp \
  -H "Authorization: Bearer $TOKEN" -H "Mcp-Session-Id: <id>"
```

Sessions are in-memory only; a restart clears them (`http.ts:1445`).n end.

## Event recording

`WA_RECORD_EVENTS=<dir>` appends every raw engine event to `<dir>/<event>.jsonl`, for replay fixtures. <!-- src: packages/bridge/src/lifecycle.ts:140; packages/bridge/src/ingest/event-recorder.ts:37-50 -->

- `creds.update` is never recorded.
- Keys such as `creds`, `authState`, `noiseKey`, `signedIdentityKey`, `signedPreKey` and `registrationId` are removed from every payload. <!-- src: packages/bridge/src/ingest/event-recorder.ts:4-13, 45 -->
- Recordings still contain real message content, so treat them as private.

See `scripts/fixtures/engine-events/README.md` for the replay harness.

```sh
WA_RECORD_EVENTS=/tmp/wa-events wa-mcp start
ls /tmp/wa-events   # messages.upsert.jsonl, connection.update.jsonl, …
```

## Store inspection

The store is SQLite at `~/.wa-mcp/store/store.db`. <!-- src: packages/bridge/src/bin.ts:216; packages/bridge/src/store/schema.ts:358 --> Open it read-only while the daemon runs:

```sh
sqlite3 -readonly ~/.wa-mcp/store/store.db
sqlite> .tables
sqlite> SELECT id, chat_jid, from_jid, kinds, all_chats FROM subscriptions;
sqlite> SELECT chat_jid, message_id, engine, kind, substr(text,1,60) FROM transcripts ORDER BY created_at DESC LIMIT 10;
sqlite> SELECT * FROM notification_rules;
sqlite> SELECT key, value FROM meta WHERE key LIKE 'send_count:%';   -- daily cap usage
```

Columns: id, chat_jid, sender_jid, sender_name, timestamp, content, media_type, media_path, quoted_message_id, mentions, is_from_me, is_unread (`schema.ts:26`).

**Inbox files:** `~/.wa-mcp/subs/<id>/inbox.jsonl` holds one JSON event per line. It rotates to `inbox.1.jsonl` at 2 MB, and `text` is capped at 280 characters. <!-- src: packages/bridge/src/subscriptions.ts:50; packages/bridge/src/inbox.ts:19-30 -->

```sh
tail -f ~/.wa-mcp/subs/<id>/inbox.jsonl | jq -c .
```

## Rate limits

Spread your probes out. A tight `curl` loop will hit 429 `RATE_LIMITED` (with `Retry-After`) before it shows you anything useful. <!-- src: packages/bridge/src/http.ts:2362-2380 -->

- `/api/subscriptions` and the rest of the authenticated API: 60/min per token.
- `/health` and the pairing routes (`/api/qr`, `/api/pairing-code`, `/api/ui-token`): 120/min per IP.
- UI-token traffic: 240/min. `/events`: no limit.

Sends also have their own 1s pacing and daily cap. See [Security → Rate limiting](./security.md#rate-limiting).

## Web UI smoke tools

Both scripts drive headless Chrome over CDP against a **live, paired** daemon.

| Script                                                                     | What it checks                                                                                                                                                                                                   |
| -------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `vp run webui-e2e` (`node scripts/webui-e2e.mjs [bridgeUrl] [chromePath]`) | Happy path: chats render → open chat → type and send → the sent bubble appears → the composer clears, with zero console errors. The target chat must exist in the store. <!-- src: scripts/webui-e2e.mjs:1-6 --> |
| `node scripts/webui-dogfood.mjs [bridgeUrl] [chromePath] [outPath]`        | Dogfood walk-through; writes a JSON report (default `/tmp/webui-dogfood-report.json`). <!-- src: scripts/webui-dogfood.mjs:6-9 -->                                                                               |

webui-dogfood covers settings, chats, sending, subscriptions.ongs here.
