# wa-mcp plugin for Claude Desktop

Claude Desktop reads MCP servers from `claude_desktop_config.json` — run
`wa-mcp install --target claude-desktop` to write the wa-mcp stdio entry
(command + args + env). Desktop's config only accepts `command` entries, so it
keeps a small relay process where other hosts connect by URL.

This plugin directory carries no additional files for Claude Desktop:
Desktop has no slash-commands or skills dirs. The web UI (bridge `#/pairing`,
`#/chats`) covers the rest.
