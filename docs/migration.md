# Migration

## Connecting by URL instead of spawning a process

Hosts used to run `node …/mcp-server/dist/bin.mjs`, which relayed to the daemon.
Now they connect to the daemon directly at `https://127.0.0.1:27777/mcp`. See
[per-platform install](./getting-started/platforms.md) for what each host gets.

**Nothing breaks until you choose to move.** The port is unchanged and still
answers plain HTTP, so old entries keep working after you upgrade.

To move:

```bash
npm i -g wa-mcp@latest
wa-mcp restart            # the daemon creates <dataDir>/tls and starts serving TLS
wa-mcp install            # replaces the wa-mcp entry in each host's config
wa-mcp doctor             # "mcp https" and "mcp entries" should both be ok
```

Then restart your agents. Install replaces only our own entry, and if you renamed the
connector in the host it keeps that name. Other servers and settings stay as they were.

If the daemon runs as a login service, replace `wa-mcp restart` above with the two
commands below. The service file pins the Node and package paths it was installed with,
so a plain restart brings the old daemon back. On Linux, also run the `systemctl` command
each one prints.

```bash
wa-mcp uninstall --service
wa-mcp install --service
```

**What changes on disk**

| File                                    | Change                                                   |
| --------------------------------------- | -------------------------------------------------------- |
| `<dataDir>/tls/cert.pem`, `key.pem`     | new (the key is 0600)                                    |
| `~/.claude.json`                        | `wa-mcp` becomes `type: http`                            |
| `~/.claude/settings.json`               | adds `env.NODE_EXTRA_CA_CERTS`, unless it is already set |
| `~/.codex/config.toml`                  | `[mcp_servers.wa-mcp]` becomes `url` + `http_headers`    |
| `~/.gemini/antigravity/mcp_config.json` | `wa-mcp` becomes `serverUrl` + `headers`                 |
| `~/.pi/agent/mcp.json`                  | `wa-mcp` becomes `streamable-http`                       |
| Claude Desktop, Grok                    | no change                                                |

**If you use Claude Code channels**

Channels need a stdio server, and `wa-mcp` in `~/.claude.json` is now a URL. If you
start Claude Code with `--dangerously-load-development-channels server:wa-mcp`,
switch to the plugin form, `plugin:wa-mcp@wa-mcp`, or stay on stdio with
`wa-mcp install --target claude-code --stdio`. `subscribe_events` with
`channel: true` over a URL entry returns an error saying this.

**Behaviour changes on `/mcp`**

Only clients you wrote yourself would notice these:

| Request                                 | Before                               | Now                     |
| --------------------------------------- | ------------------------------------ | ----------------------- |
| notification or response                | `200` with `{}`                      | `202` with no body      |
| unknown `Mcp-Session-Id` on POST        | a new session was silently created   | `404`: initialize again |
| `GET /mcp` with no session id           | `404`                                | `400`                   |
| `DELETE /mcp` with a session id         | not routed                           | `204`                   |
| `subscribe_events` with `channel: true` | subscription created, events dropped | error                   |

**Going back**

```bash
wa-mcp install --stdio    # writes the old entries, for every host or one --target
```

`WA_TLS=0` on the daemon turns TLS off entirely. Re-run `wa-mcp install` with the
same variable set, so entries get `http://`.

**Containers**

Nothing is required. Health checks and any plain-HTTP client keep working on the
same port, and the certificate is created in the data dir. If the data dir can't
hold it, the daemon logs a warning and serves plain HTTP.

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

## Import command (T83)

`wa-mcp import --from lharries|gofork --path <dir> [--data-dir ~/.wa-mcp] [--dry-run]`

### lharries layout

Per-chat JSON files: `chats/<jid>.json` → `{ jid, name, messages: [{ id,
timestamp (ISO), sender ("me" = from-me), text }] }`.

### Go-fork layout

Single SQLite: `store.db` with `chats (jid, name)` and `messages (id,
chat_jid, timestamp (epoch seconds), from_me, sender, content)`.

### Field mapping

| source field                          | ours                             |
| ------------------------------------- | -------------------------------- |
| jid / chat_id                         | chats.jid                        |
| name                                  | chats.name                       |
| messages[].id                         | messages.id                      |
| timestamp ISO / epoch-s               | messages.timestamp (ISO-8601)    |
| sender ("me"→NULL) / sender + from_me | messages.sender_jid + is_from_me |
| text / content                        | messages.content                 |
| full source row                       | messages.raw                     |

Idempotent (`INSERT OR IGNORE`); media is referenced, not copied.
