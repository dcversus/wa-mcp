# Configuration

All configuration is environment variables on the bridge process, plus the
BYOK config file `~/.wa-mcp/config.json` (see cookbook → media understanding).

## Core

| variable                 | default                              | meaning                                                                                                               |
| ------------------------ | ------------------------------------ | --------------------------------------------------------------------------------------------------------------------- |
| `WA_DATA_DIR`            | `~/.wa-mcp`                          | state root (auth/, store/, media/, subs/, token, qr.png, bridge.lock, config.json)                                    |
| `WA_BIND_HOST`           | `127.0.0.1`                          | HTTP bind address — keep loopback unless you understand the exposure                                                  |
| `WA_PORT`                | `8080`                               | HTTP port                                                                                                             |
| `WA_TOKEN`               | generated → `<dataDir>/token` (0600) | bearer token for every non-health endpoint                                                                            |
| `WA_UI_DIR`              | `<bridge>/dist/web`                  | web UI static directory                                                                                               |
| `WA_UI_BOOTSTRAP`        | unset                                | `0` restores the strict challenge flow for the web UI on paired daemons (default: zero-action bootstrap per ADR 0012) |
| `WA_LOG_LEVEL`           | `info`                               | pino level (logs to stderr, JSON)                                                                                     |
| `WA_CLI_NO_SERVICE_LOAD` | unset                                | `1` = CLI never auto-loads the launchd service on commands                                                            |

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

| variable        | default                 | meaning                                                |
| --------------- | ----------------------- | ------------------------------------------------------ |
| `WA_BRIDGE_URL` | `http://127.0.0.1:8080` | bridge URL for the stdio MCP server and CLI commands   |
| `WA_TOKEN`      | token file              | bearer token for CLI/stdio clients (same file default) |

## Client config targets

`wa-mcp install --target <platform>` writes and verifies:

| platform       | file                                                              |
| -------------- | ----------------------------------------------------------------- |
| claude-code    | `~/.claude.json` (`mcpServers.wa-mcp`)                            |
| claude-desktop | `~/Library/Application Support/Claude/claude_desktop_config.json` |
| cursor         | `~/.cursor/mcp.json`                                              |
| codex          | `~/.codex/config.toml` (`[mcp_servers.wa-mcp]`)                   |
| pi             | `~/.pi/mcp/wa-mcp.json`                                           |
| hermes         | `~/.hermes/config.yaml` (`mcp_servers:` block)                    |
| grok           | `~/.grok/mcp.json`                                                |
| antigravity    | `~/.gemini/antigravity/mcp_config.json`                           |

`--home <dir>` overrides the home root for sandbox testing.
