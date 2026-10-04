# wa-mcp - pi registration

`wa-mcp install --target pi` writes the server entry to `~/.pi/mcp/wa-mcp.json`.

Config format: JSON - single-server spec {command, args, env}
Expected entry shape:

```
command: node
args: [<bridge-args>]
env: { WA_TOKEN: "<bridge token>" }
```

## Skills sync

`wa-mcp install` mirrors `skills/wa-mcp/` (SKILL.md + references) to
`~/.wa-mcp/skills/wa-mcp`, `~/.claude/skills/wa-mcp` and
`~/.pi/skills/wa-mcp`. pi has no native skills dir - point your client at the data-dir mirror.
