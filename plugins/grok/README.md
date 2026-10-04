# wa-mcp - grok registration

`wa-mcp install --target grok` writes the server entry to `~/.grok/mcp.json`.

Config format: JSON - mcpServers.wa-mcp {command, args, env}
Expected entry shape:

```
command: node
args: [<bridge-args>]
env: { WA_TOKEN: "<bridge token>" }
```

## Skills sync

`wa-mcp install` mirrors `skills/wa-mcp/` (SKILL.md + references) to
`~/.wa-mcp/skills/wa-mcp`, `~/.claude/skills/wa-mcp` and
`~/.pi/skills/wa-mcp`. grok has no native skills dir - point your client at the data-dir mirror.
