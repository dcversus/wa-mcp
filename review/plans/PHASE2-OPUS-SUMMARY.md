Permission allow rule (.claude/settings.local.json): Write(**) is not matched by file permission checks — only Edit(path) rules are. Use Edit(**) instead (Edit rules cover all file-editing tools).
I've written the Phase 2 plan to `/Users/dcversus/.claude/plans/you-are-planning-phase-resilient-map.md`. It has 13 tasks, T105–T117, numbered after the queued T104. Each task lists its RED test names, what they assert, an acceptance check and its dependencies. No code has been changed.

**What I found in the code that shapes the plan**
- **Neither MCP transport can push today.** `handleRpcMessage` (`packages/mcp-server/src/server.ts:190`) only returns one response per request. The stdio server is a separate process that relays to the bridge over HTTP, so it never sees bridge events. The bridge's `serveMcp` (`http.ts:1324`) is a POST-only endpoint with no session. So N1 needs an event stream from the bridge plus a way for each transport to forward it.
- **The latest schema migration is V17,** so subscriptions become V18 and `deliver` becomes V19.

**Key decisions**
1. **One subscription registry, owned by the bridge.** It's a SQLite table plus a `subscriptions.ts` module behind `/api/subscriptions`. The web UI, MCP tools and CLI all go through that HTTP API; none of them touch the table or `~/.wa-mcp/subs` directly.
2. **The bridge decides what to push.** A new authenticated stream, `GET /api/mcp-notify`, sends ready-made MCP notifications. Stdio forwards them to stdout, filtered by what that session subscribed to. HTTP forwards them on a new `GET /mcp` stream, using an `Mcp-Session-Id` returned by `initialize`. The event-to-notification mapping lives in one tested function.
3. **Hooks only call a command.** `wa-mcp inbox drain --sub <id>` reads from a saved position in the file, prints a summary, and exits 2 when there are new events. The Claude and Codex hook entries just run it, so the logic is TypeScript tests rather than shell.

**Order:** T105 registry → T106 inbox writer → T107 bridge wiring and `/health` → T108 notification mapping and stream → T109 MCP subscribe and the `subscribe:true` flip (no dependencies, can run in parallel) → T110 forwarding in both transports → T111 `tools/list_changed` → T112 MCP tools → T113 CLI subscribe and drain → T115 hook installer → T114 web UI (it reuses T115's hook snippet) → T116 `deliver` on rules → T117 cookbook (a test checks its commands and hook JSON against the real code) and ledger close-out.

**Highest-risk integration points**
1. **One registry behind three surfaces.** The bridge is the only writer and validation lives in one place. Every surface's tests check the HTTP calls it makes, and T114's acceptance check is that a subscription made in the UI shows up in the CLI.
2. **Inbox rotation under load.**
   - The daemon is the only writer and appends synchronously. One test does 1000 interleaved appends and checks no line is split.
   - On rotation the old file is renamed and a new one is created at the same path straight away, so file watchers keep working.
   - Readers track a byte position and reset it when the file shrinks.
   - Failed writes increase the `dropped` count in `/health` instead of breaking event handling.
3. **Merging hooks into users' real `settings.json`.** We find our own entries only by the `wa-mcp inbox drain` marker. A timestamped backup is written before every change, and a file that won't parse aborts with nothing written. Tests cover running the installer twice and removing it without touching user entries.

Two things still need checking:
- **Claude Code hook names.** I wrote the plan assuming the `FileChanged` event, the `asyncRewake` field and the exit-2 behaviour, without checking them against current docs. T115 starts by confirming the schema and saving it as a test fixture; if the names differ, only the renderer changes.
- **`tools/list_changed` (T111).** The tool list is static today, so this notification would rarely fire. It's planned as a small check that only emits when the visible tool set actually changes.

Separately, several MCP connectors (Notion, Google Drive, Gmail and others) need re-authorising in claude.ai settings, and the Telegram plugin failed to connect. None of them were needed for this plan.
