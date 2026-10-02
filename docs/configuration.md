# Configuration

All configuration is environment variables on the bridge process.

| variable               | default                              | meaning                                                              |
| ---------------------- | ------------------------------------ | -------------------------------------------------------------------- |
| `WA_DATA_DIR`          | `~/.wa-mcp`                          | state root (auth/, store/, media/, token, qr.png, bridge.lock)       |
| `WA_BIND_HOST`         | `127.0.0.1`                          | HTTP bind address — keep loopback unless you understand the exposure |
| `WA_PORT`              | `8080`                               | HTTP port                                                            |
| `WA_TOKEN`             | generated → `<dataDir>/token` (0600) | bearer token for every non-health endpoint                           |
| `WA_DEVICE_NAME`       | `wa-mcp`                             | device name shown on your phone                                      |
| `WA_SYNC_FULL_HISTORY` | off (`1`/`true` to enable)           | ask the phone for full history at pairing                            |
| `WA_DAILY_CAP`         | `200`                                | daily send cap (persistent, UTC-keyed)                               |
| `WA_SENDS_DISABLED`    | unset                                | `1` = kill switch, all sends 403                                     |
| `WA_TRANSCRIBE_ENGINE` | `mock`                               | transcription engine (`mock` only in 0.9; openai/whisper planned)    |
| `WA_UI_DIR`            | `<bridge>/dist/web`                  | web UI static directory                                              |
| `WA_LOG_LEVEL`         | `info`                               | pino level (logs to stderr, JSON)                                    |

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
