# wa-mcp - codex registration

`wa-mcp install --target codex` writes the server entry to `~/.codex/config.toml`.

Config format: TOML - [mcp_servers.wa-mcp] url + http_headers
Expected entry shape:

```
url = "http://127.0.0.1:27777/mcp"
http_headers = { "Authorization" = "Bearer <bridge token>", "X-WA-Agent" = "codex" }
```

For https, `export CODEX_CA_CERTIFICATE=~/.wa-mcp/tls/cert.pem` and run install with `--https`.

## Skills sync

`wa-mcp install` mirrors `skills/wa-mcp/` (SKILL.md + references) to
`~/.wa-mcp/skills/wa-mcp`, `~/.claude/skills/wa-mcp` and
`~/.pi/skills/wa-mcp`. codex has no native skills dir - point your client at the data-dir mirror.
