# Independent code review — wa-mcp 0.9.0 (from orchestrator, on owner's order)

You are reviewing wa-mcp: a TypeScript Vite+ monorepo WhatsApp MCP server (packages: bridge, mcp-server, cli, web-ui, shared). Engine: @whiskeysockets/baileys fork (doryani-ai/Baileys#fix/companion-reg-refresh).

Scope (be thorough, cite file:line):
1. CODE QUALITY: architecture, module boundaries, dead code, duplication, type safety (strict tsc, noUncheckedIndexedAccess), error handling (no swallowed errors — we found several in live testing).
2. SECURITY (GOAL §10): loopback bind default, bearer token on every endpoint, media path-traversal guard + symlink resolution, rate limits + body caps, query-token on browser-element routes (/api/media, /events), XSS in web-ui (escapeHtml coverage — check EVERY innerHTML/insertion), secrets handling (token file 0600, no tokens in logs).
3. CORRECTNESS RISKS: the recent live-fix areas — LID/PN canonicalization (send/send.ts resolveLidJid + canonicalChatJid), ingest protocol-message skip (store/messages.ts), poll option extraction, single-flight reconnect, pairing budget.
4. TEST GAPS: unit tests that mock the engine (mock-blindness caused 3 live bugs) — where would E2E/contract tests catch more?
5. CLEANUP: anything that should be deleted/refactored before a 0.9.0 release claim.

Output: review/INDEPENDENT-REVIEW-ANTHROPIC.md with findings grouped Critical/High/Medium/Low, each with file:line + why it matters + suggested fix. Do NOT modify source code — review only. Commit nothing.
