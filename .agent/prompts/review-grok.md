# Independent code review — wa-mcp 0.9.0 (from orchestrator, on owner's order)

You are reviewing wa-mcp: a TypeScript Vite+ monorepo WhatsApp MCP server (packages: bridge, mcp-server, cli, web-ui, shared). Engine: @whiskeysockets/baileys fork.

Scope (be adversarial, cite file:line):
1. RELIABILITY: reconnect logic, race conditions in ingest/store, error paths that could crash the daemon, resource leaks (sockets, timers, file handles).
2. DATA INTEGRITY: store schema + migrations (SQLite), LID/PN chat canonicalization edge cases, poll/vote decode, tombstones.
3. SECURITY: auth matrix (bearer + query-token), path traversal, XSS surface in packages/web-ui/src (every template string reaching innerHTML), SSRF on url-based media sends.
4. PACKAGING/DISTRIBUTION: CLI install flow, doctor checks, tarball contents, engines field.
5. Anything RAW or half-finished that would embarrass a 0.9.0 release.

Output: review/INDEPENDENT-REVIEW-GROK.md with findings grouped Critical/High/Medium/Low, each with file:line + why it matters + suggested fix. Do NOT modify source code — review only. Commit nothing.
