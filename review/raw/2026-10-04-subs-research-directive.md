# 2026-10-04 — owner directive: subscriptions & notifications research (verbatim)

"For the subscriptions and notifications i would recommend do some research and use maximum what mcp protocol provides itself + configuration for installing some hooks to claude / codex / pi (or use some existed agent messaging options what avaiable, everything should be configurable"

## Research outcome (orchestrator, 2026-10-04, verified against spec sources)
- MCP 2025-06-18 (our PROTOCOL_VERSION, server.ts:91): resources/subscribe + notifications/resources/updated; notifications/message; notifications/tools/list_changed; sampling/createMessage; elicitation/create (new in this version). Triggers-and-Events WG (webhooks) = draft, watch only.
- Claude Code hooks: settings.json "hooks" key, types command/http/mcp_tool, events SessionStart/UserPromptSubmit/PreToolUse/PostToolUse/Notification/Stop.
- Codex: ~/.codex/config.toml [mcp_servers] + hooks.json, mcp_tool hook type (server + tool + templated input).
- Pi: our own agent — direct bridge/SSE consumer.
- Goal §A rewritten: A1 resources subscription (wa:// resources) + A2 notifications/message + A3 subscribe tools + A4 rule delivery (mcp/webhook/ui) + A5 hook installers (claude/codex/pi, idempotent, reversible) + A6 SSE + tools/list_changed + A7 elicitation probe. Committed.
