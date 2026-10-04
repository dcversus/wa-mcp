# wa-mcp - codex registration

`wa-mcp install --target codex` writes the server entry to `~/.codex/config.toml`.

Config format: TOML - [mcp_servers.wa-mcp] command + args
Expected entry shape:

```
command: node
args: [<bridge-args>]
env: { WA_TOKEN: "<bridge token>" }
```

## Skills sync

`wa-mcp install` mirrors `skills/wa-mcp/` (SKILL.md + references) to
`~/.wa-mcp/skills/wa-mcp`, `~/.claude/skills/wa-mcp` and
`~/.pi/skills/wa-mcp`. codex has no native skills dir - point your client at the data-dir mirror.
