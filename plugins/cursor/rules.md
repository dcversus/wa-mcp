# wa-mcp rules for Cursor

Cursor reads MCP servers from `~/.cursor/mcp.json` — run
`wa-mcp install --target cursor`.

Suggested rules file content (add to Cursor rules if you use them):

- Prefer list_chats before sending when the user says "reply to ..." without a jid.
- Never bulk-send; the bridge paces and caps sends anyway.
- For media, ask base64 vs bridge-local path vs URL.
