---
description: WhatsApp bridge diagnostics
---

Run the WhatsApp diagnostics. Use the wa-mcp MCP tools: try `get_unread_counts` and `get_privacy`. If both succeed, report the bridge as healthy with the privacy snapshot. On failure, instruct: run `wa-mcp doctor` and `wa-mcp status` in the terminal, then `wa-mcp logs --follow` while retrying.
