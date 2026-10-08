# Per-platform install

`npx wa-mcp install [--target <platform>]` writes the registration and
verifies it by reading the file back. All platforms get the same server
spec: `node <abs>/packages/mcp-server/dist/bin.mjs --bridge-url
http://127.0.0.1:27777 --token <token>` with `WA_TOKEN` in env. Snippets
below are the exact shapes the CLI writes (`packages/cli/src/writers.ts` —
engine truth, not invention).

Replace `<token>` with the contents of `~/.wa-mcp/token`, and the bin
path with your install's absolute
`node_modules/@wa-mcp/cli/node_modules/@wa-mcp/mcp-server/dist/bin.mjs`.

After each: `npx wa-mcp doctor --target <platform>` (or plain `doctor`)
must show the registration row as `ok`.

## Claude Code

`~/.claude.json` → `mcpServers.wa-mcp`:

```json
{
  "mcpServers": {
    "wa-mcp": {
      "type": "stdio",
      "command": "node",
      "args": ["<bin.mjs>", "--bridge-url", "http://127.0.0.1:27777", "--token", "<token>"],
      "env": { "WA_TOKEN": "<token>" }
    }
  }
}
```

Troubleshooting: if the entry exists but the tool list is empty, the daemon
is down — `npx wa-mcp status`.

## Claude Desktop

`~/Library/Application Support/Claude/claude_desktop_config.json` →
`mcpServers.wa-mcp` (same JSON as Claude Code without the `"type"` field).

Troubleshooting: Desktop only reads the config at launch — restart it after
`wa-mcp install`.

## Cursor

`~/.cursor/mcp.json` → `mcpServers.wa-mcp` (same JSON as Claude Code
without the `"type"` field).

Troubleshooting: Cursor caches MCP state per workspace — reload the
window after install.

## Codex

`~/.codex/config.toml`:

```toml
[mcp_servers.wa-mcp]
command = "node"
args = ["<bin.mjs>", "--bridge-url", "http://127.0.0.1:27777", "--token", "<token>"]
```

Troubleshooting: TOML tables are last-write-wins — re-run
`wa-mcp install --target codex` after manual edits.

## Grok

`~/.grok/mcp.json` → `mcpServers.wa-mcp` (same JSON as Claude Code
without the `"type"` field).

Troubleshooting: same as Cursor — reload after install.

## Hermes

`~/.hermes/config.yaml`:

```yaml
mcp_servers:
  wa-mcp:
    command: node
    args: ["<bin.mjs>", "--bridge-url", "http://127.0.0.1:27777", "--token", "<token>"]
    env:
      WA_TOKEN: "<token>"
```

Troubleshooting: YAML indentation is two spaces, exactly as written above.

## Antigravity

`~/.gemini/antigravity/mcp_config.json` → `mcpServers.wa-mcp` with both a
stdio command AND `serverUrl`:

```json
{
  "mcpServers": {
    "wa-mcp": {
      "serverUrl": "http://127.0.0.1:27777/mcp",
      "command": "node",
      "args": ["<bin.mjs>", "--bridge-url", "http://127.0.0.1:27777", "--token", "<token>"],
      "env": { "WA_TOKEN": "<token>" }
    }
  }
}
```

Troubleshooting: antigravity uses `serverUrl` (HTTP), NOT `url` — the CLI
writes both shapes.

## Pi

`~/.pi/agent/mcp.json` — pi reads the shared `mcpServers` wrapper file the
agent extension loads:

```json
{
  "mcpServers": {
    "wa-mcp": {
      "command": "node",
      "args": ["<bin.mjs>", "--bridge-url", "http://127.0.0.1:27777", "--token", "<token>"],
      "env": { "WA_TOKEN": "<token>" },
      "transport": "stdio"
    }
  }
}
```

`wa-mcp install --target pi` MERGES into the wrapper (other servers are
preserved) and deletes the legacy `~/.pi/mcp/wa-mcp.json` single-server file
if an older install left one. `wa-mcp uninstall --target pi` removes only the
`wa-mcp` key.

Troubleshooting: pi (pi-mcp-extension) never reads `~/.pi/mcp/` — if the
connection fails, confirm the entry landed in `~/.pi/agent/mcp.json`.
