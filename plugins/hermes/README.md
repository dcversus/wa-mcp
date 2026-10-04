# wa-mcp - hermes registration

`wa-mcp install --target hermes` writes the server entry to `~/.hermes/config.yaml`.

Config format: YAML - mcp_servers: wa-mcp: {command, args, env}
Expected entry shape:

```
command: node
args: [<bridge-args>]
env: { WA_TOKEN: "<bridge token>" }
```

## Skills sync

`wa-mcp install` mirrors `skills/wa-mcp/` (SKILL.md + references) to
`~/.wa-mcp/skills/wa-mcp`, `~/.claude/skills/wa-mcp` and
`~/.pi/skills/wa-mcp`. hermes has no native skills dir - point your client at the data-dir mirror.
