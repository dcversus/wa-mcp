# wa-mcp plugin for Claude Code

The `wa-mcp skills install` command wires this plugin's parts:

- `~/.claude/commands/wa-mcp.md` — the `/wa-mcp` slash command (this file's source lives here as `commands.md`).
- `~/.claude/skills/wa-mcp/` — the skill (SKILL.md + references), copied from `skills/wa-mcp/`.

MCP server registration is written by `wa-mcp install --target claude-code` into `~/.claude.json`.

Re-run `wa-mcp skills install` after updating this directory to refresh the installed copies.
