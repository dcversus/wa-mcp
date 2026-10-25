# Configuration

All configuration is environment variables on the bridge process, plus the
BYOK config file `~/.wa-mcp/config.json` (see cookbook → media understanding).

## Core

| variable                 | default                              | meaning                                                                                                               |
| ------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `WA_DATA_DIR`            | `~/.wa-mcp`                          | state root (auth/, store/, media/, subs/, token, qr.png, bridge.lock, config.json)                                    |
| `WA_BIND_HOST`           | `127.0.0.1`                          | HTTP bind address — keep loopback unless you understand the exposure                                                  |
| `WA_PORT`                | `27777`                              | HTTP port (`--port <n>` on the bridge and CLI does the same)                                                          |
| `WA_TOKEN`               | generated → `<dataDir>/token` (0600) | bearer token for every non-health endpoint                                                                            |
| `WA_UI_DIR`              | `<bridge>/dist/web`                  | web UI static directory                                                                                               |
| `WA_UI_BOOTSTRAP`        | unset                                | `0` restores the strict challenge flow for the web UI on paired daemons (default: zero-action bootstrap per ADR 0012) |
| `WA_LOG_LEVEL`           | `info`                               | pino level (logs to stderr, JSON)                                                                                     |
| `WA_CLI_NO_SERVICE_LOAD` | unset                                | `1` = CLI never auto-loads the launchd service on commands                                                            |

## Upgrading: the default port

Upgrading: the default port changed from 8080 to 27777 in 0.1.0. Installs that pass a port explicitly — the launchd/systemd service
(`--port 8080`) and every MCP host entry written by `wa-mcp install`
(`--bridge-url http://127.0.0.1:8080`) — keep working unchanged. To move to
27777, run `wa-mcp install --service` and `wa-mcp install` again without
`--port`; to stay on 8080, keep passing `--port 8080` (or `WA_PORT=8080`).

Why 27777: it is unassigned by IANA, free of the usual dev-server ports
(3000, 5000, 8000, 8080) and distinct from claude-mem's 37777.

## Connection & pairing

| variable               | default                    | meaning                                                                                        |
| ---------------------- | -------------------------- | ---------------------------------------------------------------------------------------------- |
| `WA_DEVICE_NAME`       | `wa-mcp`                   | device name shown on your phone                                                                |
| `WA_SYNC_FULL_HISTORY` | off (`1`/`true` to enable) | ask the phone for full history at pairing                                                      |
| `WA_RECONNECT_ALERT_N` | `5`                        | emit an alert after N reconnect cycles (connection-quality signal)                             |
| `WA_STALENESS_MS`      | `30000`                    | connection considered stale after this many ms without a signal                                |
| `WA_RECORD_EVENTS`     | unset                      | directory — record raw engine events as JSON fixtures (debugging; creds.update never recorded) |

## Send safety

| variable            | default | meaning                                |
| ------------------- | ------- | -------------------------------------- |
| `WA_DAILY_CAP`      | `200`   | daily send cap (persistent, UTC-keyed) |
| `WA_SENDS_DISABLED` | unset   | `1` = kill switch, all sends 403       |

### Connection settings (humanisation and send limits)

Stored in the daemon's store and changed at runtime from the web UI
**Connection** page (`#/connection`), `wa-mcp settings set`, or
`PUT /api/connection-settings`. Both features are **off by default**; while
off, sends behave exactly as without them. <!-- src: packages/shared/src/connection-settings.ts; packages/bridge/src/send/humanize.ts; packages/bridge/src/send/safety.ts -->

| setting                       | default | meaning                                                                                                   |
| ----------------------------- | ------- | --------------------------------------------------------------------------------------------------------- |
| `humanisation.enabled`        | `false` | wait before each message as if typing it                                                                  |
| `humanisation.minDelayMs`     | `1500`  | base delay (0–120000)                                                                                     |
| `humanisation.delayPerCharMs` | `60`    | added per character of text or caption (0–1000)                                                           |
| `humanisation.maxDelayMs`     | `8000`  | cap on the delay (0–120000, ≥ min); the result then gets ±20% random jitter                               |
| `humanisation.typingStatus`   | `true`  | show "typing…" ("recording…" for voice notes) while waiting, refreshed every 10 s, stopped before sending |
| `sendLimits.enabled`          | `false` | enforce the limits below (anti-ban)                                                                       |
| `sendLimits.perMinute`        | `30`    | sends in any rolling minute (1–1000)                                                                      |
| `sendLimits.perHour`          | `120`   | sends in any rolling hour (1–20000)                                                                       |
| `sendLimits.perDay`           | `500`   | sends in any rolling 24 h (1–100000)                                                                      |
| `sendLimits.perChatPerDay`    | `null`  | sends to one chat in any rolling 24 h; `null` = no per-chat cap                                           |

Humanisation applies to `/api/send` (and so to every MCP send tool), autoreplies and
scheduled messages; reactions, edits, deletes and status posts go out at once.
Limits apply to every send that draws from the daily budget. Over a limit the
send is refused with `429 SEND_LIMIT_REACHED`, a `Retry-After` header and a
message such as `daily send limit reached (500)`. Shutting the daemon down
cancels a send still waiting out its delay (`503 SHUTTING_DOWN`).

```bash
wa-mcp settings
wa-mcp settings set --humanise on --min-delay 1000 --max-delay 6000 --typing on
wa-mcp settings set --limits on --per-minute 20 --per-day 300 --per-chat-day 40
```

## Media auto-download

| variable                       | default                   | meaning                                                    |
| ------------------------------ | ------------------------- | ---------------------------------------------------------- |
| `WA_AUTO_DOWNLOAD`             | on (`0`/`false` disables) | auto-download incoming media to disk                       |
| `WA_AUTO_DOWNLOAD_SKIP_STATUS` | on (`false` disables)     | never auto-save status/receipt media                       |
| `WA_ALLOWED_EXTENSIONS`        | all allowed               | comma list restricting auto-download to these extensions   |
| `WA_MIN_FREE_MB`               | `500`                     | skip auto-download when free disk drops under this many MB |
| `WA_MEDIA_DIR`                 | `<dataDir>/media`         | where downloaded media is stored                           |

## Transcription / TTS engines

| variable               | default                            | meaning                                                                                                    |
| ---------------------- | ---------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `WA_TRANSCRIBE_ENGINE` | `mock`                             | `mock` / `openai` / `mlx` / `whisper-local` (config.json `transcription.engine` is the fallback; env wins) |
| `WA_OPENAI_API_KEY`    | unset                              | openai engine key (or config.json `transcription.api_key`)                                                 |
| `WA_OPENAI_BASE_URL`   | `https://api.openai.com/v1`        | any OpenAI-compatible endpoint                                                                             |
| `WA_OPENAI_MODEL`      | `whisper-1`                        | model name                                                                                                 |
| `WA_MLX_BIN`           | `mlx_whisper`                      | mlx engine binary path                                                                                     |
| `WA_WHISPER_BIN`       | `whisper-cli`                      | whisper.cpp binary path                                                                                    |
| `WA_WHISPER_MODEL`     | unset (required for whisper-local) | ggml `.bin` model path                                                                                     |
| `WA_FFMPEG_BIN`        | `ffmpeg`                           | ffmpeg path (video frames, audio extraction)                                                               |
| `WA_MCP_SERVER_BIN`    | _unset_                            | override the stdio MCP server binary the `wa-mcp mcp` command spawns (tests)                               |
| `WA_TTS_ALLOW_MOCK`    | unset                              | `1` = allow the mock TTS engine (otherwise structured error)                                               |
| `WA_OCR_ENGINE`        | `none`                             | `tesseract` enables OCR of images in `read_document`                                                       |
| `WA_OCR_LANG`          | `eng`                              | tesseract language                                                                                         |

## Dual channel (Cloud API skeleton)

| variable                   | default                    | meaning                                                                               |
| -------------------------- | -------------------------- | ------------------------------------------------------------------------------------- |
| `WA_CHANNEL`               | `baileys`                  | channel surface: `baileys` (default) or `cloud` (skeleton; live Cloud is owner-gated) |
| `WA_CLOUD_ACCESS_TOKEN`    | unset (required for cloud) | Cloud API access token                                                                |
| `WA_CLOUD_PHONE_NUMBER_ID` | unset (required for cloud) | Cloud API phone number ID                                                             |
| `WA_CLOUD_VERIFY_TOKEN`    | unset (required for cloud) | webhook verify token                                                                  |
| `WA_CLOUD_APP_SECRET`      | unset (required for cloud) | app secret (webhook signature check)                                                  |
| `WA_CLOUD_API_VERSION`     | `v22.0`                    | Cloud API version                                                                     |

Selecting `cloud` without all four required credentials returns named
per-variable errors — nothing silently falls back.

## MCP server / CLI clients

| variable        | default                  | meaning                                                              |
| --------------- | ------------------------ | -------------------------------------------------------------------- |
| `WA_BRIDGE_URL` | `http://127.0.0.1:27777` | bridge URL for the stdio MCP server and CLI commands                 |
| `WA_TOKEN`      | token file               | bearer token for CLI/stdio clients (same file default)               |
| `WA_AGENT`      | MCP `clientInfo` name    | agent slug the stdio MCP server stamps on its sends (`--agent` wins) |
| `WA_MCP_HOME`   | `~/.wa-mcp`              | data dir the pi extension tails (`<dir>/subs/*/session.jsonl`)       |

The stdio MCP server sends an `x-wa-agent` header with every bridge call so the
Logs page can show exactly what one agent did. `wa-mcp install` writes
`--agent <platform>` into each host entry; without it the slug comes from the
host's MCP `initialize` handshake (`claude-code`, `claude-ai` → `claude-desktop`,
`grok-cli` → `grok`, `codex-mcp-client` → `codex`, …). Web UI and CLI sends
are recorded as `ui`.

## Client config targets

`wa-mcp install --target <platform>` writes and verifies:

| platform       | file                                                              |
| -------------- | ----------------------------------------------------------------- |
| claude-code    | `~/.claude.json` (`mcpServers.wa-mcp`)                            |
| claude-desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| codex          | `~/.codex/config.toml` (`[mcp_servers.wa-mcp]`)                   |
| pi             | `~/.pi/mcp/wa-mcp.json`                                           |
| grok           | `~/.grok/mcp.json`                                                |
| antigravity    | `~/.gemini/antigravity/mcp_config.json`                           |

`--home <dir>` overrides the home root for sandbox testing.
