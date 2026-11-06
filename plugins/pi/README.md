# wa-mcp - pi registration

`wa-mcp install --target pi` writes the server entry to `~/.pi/agent/mcp.json`.

Config format: JSON - mcpServers.wa-mcp {transport, lifecycle, url, headers}
Expected entry shape:

```
transport: streamable-http
lifecycle: eager
url: http://127.0.0.1:27777/mcp
headers: { Authorization: "Bearer <bridge token>", X-WA-Agent: pi }
```

For https, start pi with `NODE_EXTRA_CA_CERTS=~/.wa-mcp/tls/cert.pem` and run install with `--https`.

## Skills sync

`wa-mcp install` mirrors `skills/wa-mcp/` (SKILL.md + references) to
`~/.wa-mcp/skills/wa-mcp`, `~/.claude/skills/wa-mcp` and
`~/.pi/skills/wa-mcp`. pi has no native skills dir - point your client at the data-dir mirror.
