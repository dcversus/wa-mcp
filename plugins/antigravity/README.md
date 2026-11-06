# wa-mcp - antigravity registration

`wa-mcp install --target antigravity` writes the server entry to `~/.gemini/antigravity/mcp_config.json`.

Config format: JSON - mcpServers.wa-mcp {serverUrl, headers}
Expected entry shape:

```
serverUrl: http://127.0.0.1:27777/mcp
headers: { Authorization: "Bearer <bridge token>", X-WA-Agent: antigravity }
```

For https, add `~/.wa-mcp/tls/cert.pem` to your system trust store and run install with `--https`.

## Skills sync

`wa-mcp install` mirrors `skills/wa-mcp/` (SKILL.md + references) to
`~/.wa-mcp/skills/wa-mcp`, `~/.claude/skills/wa-mcp` and
`~/.pi/skills/wa-mcp`. antigravity has no native skills dir - point your client at the data-dir mirror.
