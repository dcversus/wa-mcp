# wa-mcp - antigravity registration

`wa-mcp install --target antigravity` writes the server entry to `~/.gemini/antigravity/mcp_config.json`.

Config format: JSON - mcpServers.wa-mcp {command, args, env, serverUrl}
Expected entry shape:

```
command: node
args: [<bridge-args>]
env: { WA_TOKEN: "<bridge token>" }
```

## Skills sync

`wa-mcp install` mirrors `skills/wa-mcp/` (SKILL.md + references) to
`~/.wa-mcp/skills/wa-mcp`, `~/.claude/skills/wa-mcp` and
`~/.pi/skills/wa-mcp`. antigravity has no native skills dir - point your client at the data-dir mirror.
