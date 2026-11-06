# Per-platform install

`npx wa-mcp install [--target <platform>]` writes the registration and verifies
it by reading the file back. Hosts that can use a URL connect straight to the
running daemon. Nothing is spawned, and the entry has no file path to go stale.
Snippets below are the exact shapes the CLI writes
(`packages/cli/src/writers.ts`).

| Host           | Connects with                                | Trust                                | Tested live   |
| -------------- | -------------------------------------------- | ------------------------------------ | ------------- |
| Claude Code    | `https://127.0.0.1:27777/mcp`                | written to `~/.claude/settings.json` | yes (2.1.318) |
| Codex          | `http://…/mcp`, or `https://` with `--https` | `CODEX_CA_CERTIFICATE` in your shell | no            |
| pi             | `http://…/mcp`, or `https://` with `--https` | `NODE_EXTRA_CA_CERTS` in your shell  | no            |
| Antigravity    | `http://…/mcp`, or `https://` with `--https` | your system trust store              | no            |
| Claude Desktop | stdio process                                | not needed                           | no change     |
| Grok           | stdio process                                | not needed                           | no change     |

"Tested live" means a real host connected to a real daemon. For the others the
shape comes from that host's documentation.

`<token>` is the contents of `~/.wa-mcp/token`. Upgrading from an older install?
See [Migration](../migration.md#connecting-by-url-instead-of-spawning-a-process).

After each: `npx wa-mcp doctor` tests the HTTPS endpoint and names any entry
still spawning a process.

## Claude Code

`~/.claude.json` → `mcpServers.wa-mcp`:

```json
{
  "mcpServers": {
    "wa-mcp": {
      "type": "http",
      "url": "https://127.0.0.1:27777/mcp",
      "headers": { "Authorization": "Bearer <token>", "X-WA-Agent": "claude-code" }
    }
  }
}
```

Install also adds this to `~/.claude/settings.json`, so Claude Code trusts the
daemon's certificate:

```json
{ "env": { "NODE_EXTRA_CA_CERTS": "<dataDir>/tls/cert.pem" } }
```

It only adds that to the Claude Code process, and only this one certificate. If
`NODE_EXTRA_CA_CERTS` already names another file, in your shell or in that
settings file, install leaves it alone, connects over `http://` and tells you.
For https in that case, append `<dataDir>/tls/cert.pem` to your file and re-run.

Live channel delivery needs [the plugin](../cookbook/react-to-messages.md):
Claude Code only accepts channels from a stdio server.

Troubleshooting: `claude mcp list` should show `✔ Connected`.
`UNABLE_TO_VERIFY_LEAF_SIGNATURE` means the trust entry is missing, so re-run
install and start a new session. See
[Troubleshooting](../troubleshooting.md#mcp-connection).

## Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` →
`mcpServers.wa-mcp`:

```json
{
  "mcpServers": {
    "wa-mcp": {
      "command": "node",
      "args": ["<bin.mjs>", "--bridge-url", "http://127.0.0.1:27777", "--token", "<token>"],
      "env": { "WA_TOKEN": "<token>" }
    }
  }
}
```

This file only accepts `command` entries, so Desktop keeps a small relay process.
`<bin.mjs>` is your install's absolute
`node_modules/@wa-mcp/cli/node_modules/@wa-mcp/mcp-server/dist/bin.mjs`.

Troubleshooting: Desktop only reads the config at launch, so restart it after
`wa-mcp install`.

## Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.wa-mcp]
url = "http://127.0.0.1:27777/mcp"
http_headers = { "Authorization" = "Bearer <token>", "X-WA-Agent" = "codex" }
```

For https, export the CA where you start Codex, then re-run with `--https`:

```bash
export CODEX_CA_CERTIFICATE=~/.wa-mcp/tls/cert.pem
wa-mcp install --target codex --https
```

Troubleshooting: TOML tables are last-write-wins, so re-run
`wa-mcp install --target codex` after manual edits.

## Grok

`~/.grok/mcp.json` → `mcpServers.wa-mcp` (same stdio JSON as Claude Desktop).

Troubleshooting: Grok caches MCP state, so reload after install.

## Antigravity

`~/.gemini/antigravity/mcp_config.json` → `mcpServers.wa-mcp`:

```json
{
  "mcpServers": {
    "wa-mcp": {
      "serverUrl": "http://127.0.0.1:27777/mcp",
      "headers": { "Authorization": "Bearer <token>", "X-WA-Agent": "antigravity" }
    }
  }
}
```

For https, add `~/.wa-mcp/tls/cert.pem` to your system trust store and re-run with
`--https`.

Troubleshooting: Antigravity uses `serverUrl`, not `url`.

## Pi

`~/.pi/agent/mcp.json`, the shared `mcpServers` file pi-mcp-extension loads:

```json
{
  "mcpServers": {
    "wa-mcp": {
      "transport": "streamable-http",
      "lifecycle": "eager",
      "url": "http://127.0.0.1:27777/mcp",
      "headers": { "Authorization": "Bearer <token>", "X-WA-Agent": "pi" }
    }
  }
}
```

For https, start pi with `NODE_EXTRA_CA_CERTS=~/.wa-mcp/tls/cert.pem` and re-run
with `--https`.

`wa-mcp install --target pi` MERGES into the file (other servers are preserved)
and deletes the legacy `~/.pi/mcp/wa-mcp.json` single-server file if an older
install left one. `wa-mcp uninstall --target pi` removes only the `wa-mcp` key.

Troubleshooting: pi (pi-mcp-extension) never reads `~/.pi/mcp/`. If the connection
fails, confirm the entry landed in `~/.pi/agent/mcp.json`.

### Pi reacts to WhatsApp (extension)

`wa-mcp install --target pi` also installs the wa-mcp pi extension so a running
pi session can react to incoming messages:

1. copies the extension (one file, node builtins only) to
   `~/.wa-mcp/pi-extension-dist`;
2. appends that absolute path to the `packages` array in
   `~/.pi/agent/settings.json` (other entries kept; the old file is saved as
   `settings.json.bak-<timestamp>` first; re-running changes nothing).

Then point a subscription at the session spool and restart pi:

```bash
wa-mcp subs create --name Family --chat 120363000000000000@g.us --delivery session \
  --prompt "Summarise and draft a reply"
```

On `session_start` the extension tails `~/.wa-mcp/subs/*/session.jsonl`
(`WA_MCP_HOME` overrides `~/.wa-mcp`) and sends each new event to pi as a
follow-up user message:

```text
[wa-mcp] message from Mom in Family (chat_jid 1203…@g.us, message_id 3EB0…): dinner at 7? — your subscription asks: Summarise and draft a reply
```

Only events that arrive while pi runs are injected (no backlog replay). Events
whose `session` targets another agent (`claude:…`, `codex:…`) are skipped;
`active`, `pi:…` and untargeted events are delivered. The extension never reads
the bridge token. `wa-mcp install --target pi --dry-run` prints the plan;
`wa-mcp uninstall --target pi` removes the entry and the copy.
