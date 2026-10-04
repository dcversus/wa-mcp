# Phase 2: Simple agent notifications (N1–N6), task plan

## Context

Rule matching in `notifications.ts` works, but its results are never delivered anywhere. Both MCP transports only answer requests. `handleRpcMessage` (`packages/mcp-server/src/server.ts:190`) returns one response per request. Stdio `bin.ts` is a separate process that relays to the bridge over HTTP and receives no events. Bridge `serveMcp` (`http.ts:1324`) is a stateless POST with no session and no GET stream. Agents therefore can't be pushed WhatsApp activity.

Phase 2 adds four delivery paths, all fed by one subscription registry:

- MCP push
- per-subscription JSONL inbox files
- three ways to subscribe: web UI, MCP tools, CLI
- agent hook installers

Nothing heavier than that is in scope.

## Architecture decisions (fixed for all tasks)

1. **One registry, one owner.** The bridge owns subscriptions: a `subscriptions` SQLite table added as migration V18 in `store/schema.ts`, plus a `packages/bridge/src/subscriptions.ts` module. The web UI, MCP tools and CLI all go through the same HTTP API (`/api/subscriptions` with GET, POST and DELETE `/:id`). No surface writes the table or `~/.wa-mcp/subs` directly.
2. **One process writes inbox files.** Only the daemon appends. It uses synchronous `appendFileSync` from the event-bus handler, so lines can't interleave. Rotation: once `size + line > cap`, rename `inbox.jsonl` to `inbox.1.jsonl` (keep one generation) and write the current line to a new `inbox.jsonl`. `dropped` counts lines that failed to write (I/O error, missing dir, oversize line). It is reported in `/health` as `subscriptions: {count, dropped}`.
3. **The bridge decides what to push; transports only forward it.** A new authenticated SSE route, `GET /api/mcp-notify`, emits complete MCP notification objects (`{method, params}`): resource updates, `notifications/message` for lifecycle events and rule matches, and `tools/list_changed`. Both transports forward these:
   - **Stdio:** `bin.ts` opens the stream and writes to stdout only for URIs this session subscribed to.
   - **HTTP:** `GET /mcp` with an `Mcp-Session-Id` opens SSE. The POST `initialize` response mints that session id.

   The mapping from bridge events to notifications therefore lives in one tested function.
4. **Hooks stay thin.** A new CLI subcommand, `wa-mcp inbox drain --sub <id>`, reads from a byte-offset cursor in `subs/<id>/cursor`. If the file is now smaller than the cursor (it was rotated), it resets to 0. It prints a summary and exits 2 when there are new events, otherwise 0. The Claude and Codex hook entries just call this command, so all the logic is testable TypeScript rather than shell.

Event-to-resource mapping:

| Bridge event | Resource updated |
|---|---|
| `messages.upsert` | `wa://unread`, `wa://chats` |
| `chats.*` | `wa://chats` |
| `connection.update` | `wa://health`, `wa://sync-status` |

## Cadence (every task)

- Commit the RED test first, with the failing assertion text in the commit body. Then commit GREEN.
- `vp check` and `vp test` must both pass after each task. Add no comments in source.
- Append a VERIFY line in `review/VERIFY.md`. Tick a GOAL box only after its VERIFY line exists.
- Numbering continues after the queued T104: T105 through T117.

## Tasks

### T105: Subscription registry (store + module)

- **Files:** `bridge/src/store/schema.ts` (V18: `subscriptions(id TEXT PK, chat_jid, from_jid, kinds TEXT json, include_media INT, all_chats INT, created_at)`), new `bridge/src/subscriptions.ts`, `bridge/tests/t105-subscriptions.test.ts`.
- **RED:** `createSubscription persists filters, creates subs/<id>/ dir, and listSubscriptions/deleteSubscription round-trip`
  - The id matches `/^[a-z0-9]{8,}$/`.
  - `<dataDir>/subs/<id>/` exists after create.
  - Delete removes the row and leaves the dir.
  - A second store opened on the same db file sees the row.
- **RED:** `matchSubscription filters by chat_jid, from_jid, kind, include_media`
  - 4 fixture upserts produce exactly the expected subset.
  - Uses a real `messages.upsert` proto shape from `tests/fixtures`.
- **Accept:** `vp test packages/bridge/tests/t105-subscriptions.test.ts` passes, and `vp test` passes.
- **Deps:** none.

### T106: Inbox writer with rotation and dropped counter

- **Files:** new `bridge/src/inbox.ts`, `bridge/tests/t106-inbox.test.ts`.
- **RED:** `appendInbox writes one JSONL line {ts,kind,chat,from,text,media}`
  - Uses an upsert fixture.
  - `text` is capped at 280 chars.
  - `media` is true for an imageMessage.
- **RED:** `rotates at cap: inbox.1.jsonl holds old lines, inbox.jsonl restarts, no line split`
  - Cap is 1 KB, with 50 appends.
  - Every line in both files parses with `JSON.parse`.
  - The combined count of the newest lines is correct.
  - At most 2 files exist.
- **RED:** `1000 synchronous appends from interleaved subscriptions produce zero torn lines`
- **RED:** `write failure increments dropped instead of throwing`
  - The subscription dir is made read-only or removed.
  - `inbox.dropped()` returns 1.
- **Accept:** the new test file passes; `vp test` passes.
- **Deps:** T105 (needs the subscription id/dir).

### T107: Bridge wiring: bus → inbox, `/api/subscriptions`, `/health.subscriptions`

- **Files:** `bridge/src/http.ts` (routes in the existing `path ===` dispatch style next to `/api/notifications` at about line 3101), the place where the bus is created (`lifecycle.ts`), `bridge/tests/t107-subscriptions-http.test.ts`.
- **RED:** `POST /api/subscriptions → 201 {id, inboxPath}; GET lists it; DELETE /:id → 204`
  - `inboxPath` ends with `/subs/<id>/inbox.jsonl`.
  - Calls without a bearer token get 401.
- **RED:** `emitting messages.upsert on the bus appends to matching subscription inbox only`
- **RED:** `/health reports subscriptions {count, dropped}`
- **Accept:** `curl -s localhost:8080/health | jq .subscriptions` returns `{"count":0,"dropped":0}` on the dev daemon.
- **Deps:** T105, T106.

### T108: Notification mapper + `/api/mcp-notify` stream

- **Files:** new `bridge/src/mcp-notify.ts` (pure function `toMcpNotifications(event, ruleMatches)`), `http.ts` SSE route (copy the `/events` pattern at about line 2349: heartbeat, unsubscribe on close), `bridge/tests/t108-mcp-notify.test.ts`.
- **RED:** `messages.upsert maps to resources/updated for wa://unread and wa://chats`
- **RED:** `connection.update maps to notifications/message level info with data.state, and to resources/updated wa://health`
- **RED:** `creds.update maps to nothing`
  - This is a security regression guard and uses the same safe-set as `SAFE_EVENT_NAMES`.
- **RED:** `rule match maps to notifications/message level notice with logger "wa-mcp.rules", data {ruleId,title,body}`
- **RED:** `GET /api/mcp-notify streams the mapped JSON-RPC notification lines, requires auth`
- **Accept:** the new test passes; `vp test` passes.
- **Deps:** T107 (bus wiring point).

### T109: MCP session model, subscribe/unsubscribe, capability flip

- **Files:** `mcp-server/src/server.ts` (adds an optional `ServerContext.session: {subscriptions:Set<string>}`), `mcp-server/tests/t109-subscribe.test.ts`.
- **RED:** `initialize advertises resources.subscribe === true`
- **RED:** `resources/subscribe {uri:"wa://unread"} → {} and adds to session; unknown uri → -32602`
- **RED:** `resources/unsubscribe removes; idempotent`
- **RED:** `shouldForward(session, notification) passes resources/updated only for subscribed uris, always passes notifications/message and tools/list_changed`
- **Accept:** the new test passes. Update any existing assertion on `subscribe:false` (grep `subscribe: false` in tests) in the same GREEN commit.
- **Deps:** none (pure). It can run in parallel with T105–T108, but merge it after T108.

### T110: Transport forwarding (stdio + HTTP `GET /mcp` SSE)

- **Files:** `mcp-server/src/bin.ts` (opens `/api/mcp-notify` with the token, filters with `shouldForward`, writes to stdout), `bridge/src/http.ts` `serveMcp` (mints an `Mcp-Session-Id` header in the initialize response, keeps an in-memory `Map<sessionId, session>`, adds a `GET /mcp` SSE route), `mcp-server/tests/t110-stdio-push.test.ts`, `bridge/tests/t110-mcp-sse.test.ts`.
- **RED (stdio):** `after resources/subscribe wa://unread, a bridge upsert yields a notifications/resources/updated line on stdout`
  - Uses a fake fetch that serves an SSE body.
  - Asserts the exact JSON line.
  - Unsubscribed URIs produce no line.
- **RED (http):** `POST initialize returns Mcp-Session-Id; GET /mcp with that header streams notifications for subscribed uris; unknown session → 404`
- **Accept:**
  - Run the new tests.
  - Live check: `claude mcp` with wa-mcp; subscribe via MCP Inspector; sending yourself a message shows `notifications/resources/updated`.
- **Deps:** T108, T109.

### T111: `tools/list_changed`

- **Files:** `bridge/src/mcp-notify.ts`, `bridge/tests/t111-tools-changed.test.ts`.
- **RED:** `a change in the visible tool-name set emits exactly one notifications/tools/list_changed; an unchanged set emits none`
  - The bridge hashes the tool-name list on connection-state and channel changes.
  - The test uses an injected registry.
- **Accept:** the new test passes.
- **Deps:** T108.

### T112: MCP tools `subscribe_events` / `unsubscribe_events`

- **Files:** `mcp-server/src/tools.ts` (registered with annotations: subscribe is `readOnlyHint:false, idempotentHint:false`; unsubscribe is `destructiveHint:false, idempotentHint:true`), `mcp-server/tests/t112-subscribe-tools.test.ts`, `docs/reference/tools.md`, plus the tool-parity doc if it counts tools.
- **RED:** `subscribe_events {chat_jid, kind:["message"], include_media:false} POSTs /api/subscriptions and returns text containing inboxPath and id`
- **RED:** `unsubscribe_events {id} DELETEs /api/subscriptions/<id>`
- **RED:** `tools/list contains both with annotations`
  - Also bump any tool-count assertion from 71 to 73.
- **Accept:** the new test passes; `pnpm run accounting:check` passes if the tool count is ledgered.
- **Deps:** T107.

### T113: CLI `subscribe` / `unsubscribe` / `inbox drain`

- **Files:** `cli/src/bin.ts`, new `cli/src/subscribe.ts`, `cli/tests/t113-subscribe.test.ts`.
- **RED:** `wa-mcp subscribe --chat <jid> --kind message prints id and inbox path` (fake fetch).
- **RED:** `--all with --chat is rejected (exit 1)`
- **RED:** `inbox drain exits 2 with "N new: <chat>: <snippet>" summary, advances cursor; second run exits 0`
- **RED:** `drain after rotation (file size < cursor) resets and reports new lines`
- **Accept:** `node packages/cli/dist/bin.mjs subscribe --chat 1203...@g.us` against the dev daemon creates the dir, then `inbox drain` returns `$?` = 0 when there are no new events.
- **Deps:** T107 (API) and T106 (line format).

### T114: Web UI subscription panel

- **Files:** `web-ui/src/api.ts` (`listSubscriptions`, `createSubscription`, `deleteSubscription`), `web-ui/src/pages.ts` (a `subscriptionsPage` html function: chat multiselect, kind/media toggles, list showing inbox path plus a copyable hook snippet), `router.ts`, `web-ui/tests/t114-subscriptions.test.ts`.
- **RED:** `createSubscription posts selected chats and renders inbox path`
- **RED:** `hook snippet contains "wa-mcp inbox drain --sub <id>" and is HTML-escaped`
- **RED:** `delete button calls DELETE and removes row`
- **Accept:**
  - The new test passes; `vp build` passes and copy-dist runs.
  - Manually: the panel at `localhost:8080/#/subscriptions` creates a subscription that the CLI `GET` lists.
- **Deps:** T107. The hook snippet text comes from T115's renderer, so either land T115 first or import the shared constant afterwards.

### T115: Hook installer `install --hooks claude|codex [--remove]`

- **Files:** new `cli/src/hooks.ts` (`renderClaudeHooks(subId)`, `renderCodexHooks(subId)`, `mergeHooks(existing, ours)`, `removeHooks(existing)`), `cli/src/bin.ts` (branch before the generic `install`, like `--service`), `cli/tests/t115-hooks.test.ts`.
- Ownership: every entry we write carries a marker in its command string, `wa-mcp inbox drain`. Merge and remove use only that marker to identify our entries.
- **RED:** `merge preserves unrelated hooks, permissions, env, and key order in an existing settings.json`
  - The fixture has a user PostToolUse hook and its own FileChanged hook.
  - Both survive byte-equivalent after a JSON reparse.
- **RED:** `install twice is idempotent (exactly one wa-mcp entry per event)`
- **RED:** `writes settings.json.bak-<ts> before modifying; refuses (exit 1, no write) on unparseable JSON`
- **RED:** `--remove deletes only wa-mcp entries and empty arrays we created; user entries untouched`
- **RED:** `claude render: FileChanged matcher = inbox.jsonl path; asyncRewake entry runs drain and relies on exit 2`
- **RED:** `codex writes ~/.codex/hooks.json equivalent with same merge guarantees`
- **Accept:**
  - The new test passes.
  - Live check: `wa-mcp install --hooks claude --sub <id>` against a copy of the real settings, run with `--home /tmp/h`, then `jq` diff with the original. The only additions are the wa-mcp entries.
- **Deps:** T113 (drain command).

### T116: `deliver: ["mcp","file","ui"]` on notification rules

- **Files:** `store/schema.ts` (V19: `notification_rules.deliver TEXT DEFAULT '["mcp"]'`, `notification_rules.sub_id TEXT`), `notifications.ts` (`createRule` / `rowToRule`, `RuleMatch.deliver`), `http.ts` (`/api/notifications` POST validation and rule dispatch), `bridge/tests/t116-deliver.test.ts`.
- **RED:** `existing rules (pre-V19 rows) default deliver to ["mcp"]`
- **RED:** `deliver:["file"] with sub_id appends a kind:"rule" line to that subscription inbox; "file" without sub_id → 400`
- **RED:** `deliver:["mcp"] emits on /api/mcp-notify; ["ui"] emits a "wa.rule" event on /events (added to SAFE_EVENT_NAMES)`
- **RED:** `unknown channel "sms" → 400`
- **Accept:** the new test passes; the existing `notifications.test.ts` still passes unchanged.
- **Deps:** T106, T108.

### T117: Cookbook doc + ledger close-out

- **Files:** `docs/cookbook/react-to-messages.md`, `docs/index.md` link, `review/VERIFY.md`, `GOAL.md` (N1–N6 boxes).
- The doc covers three paths:
  - Claude Code: `FileChanged` plus `asyncRewake`, installed via `install --hooks claude`.
  - Codex: `hooks.json`.
  - Generic: `tail -F inbox.jsonl`, or MCP `resources/subscribe`.
- **RED:** `cli/tests/t117-cookbook.test.ts`
  - The doc exists.
  - Every `wa-mcp …` command in its code fences matches a real `parseArgs` command or flag.
  - Every hook JSON block deep-equals `renderClaudeHooks` / `renderCodexHooks` output, so the doc can't drift from the code.
- **Accept:** the new test passes and `pnpm run accounting:check` passes. Do a live end-to-end run: subscribe to the Test group, install hooks in a scratch `--home`, send a message, and see `inbox drain` exit 2 with the summary. Record that run in VERIFY.
- **Deps:** all.

Order: T105 → T106 → T107 → T108 → T109 → T110 → T111 → T112 → T113 → T115 → T114 → T116 → T117. T109 is pure and can be done any time before T110.

## Highest-risk integration points and how the plan reduces them

1. **One registry behind three surfaces** (T105, T107, T112–T114).
   - **Risk:** the surfaces drift apart. For example, the CLI writes `subs/` directly, or the UI and MCP tools validate filters differently.
   - **How the plan handles it:** only the bridge module and table hold the registry, and the only write path is `/api/subscriptions`. Validation lives once, in `subscriptions.ts`. The MCP tool, CLI and UI tests all assert against HTTP calls (fake fetch), never against the filesystem.
   - **Cross-surface check:** T114's acceptance criterion is that a subscription created in the UI is listed by the CLI.
2. **Inbox rotation under write load and hook readers** (T106, T113).
   - **Risks:** lines torn mid-write, a FileChanged watcher losing the file after a rename, and a reader cursor left pointing past the end of the file.
   - **How the plan handles it:**
     - The daemon is the only writer and uses synchronous appends; there's a 1000-append torn-line test.
     - Rotation immediately recreates `inbox.jsonl` at the same path with the triggering line.
     - Readers never track the file's inode. They use a byte cursor, and a shrink resets it (tested in T113).
     - Write failures increment `dropped` instead of breaking the event bus. `/health` exposes `dropped` so silent loss shows up.
3. **Hooks merge safety in users' real `~/.claude/settings.json`** (T115).
   - **Risk:** overwriting someone's hooks, permissions or env, or using hook keys that Claude Code doesn't recognise.
   - **How the plan handles it:**
     - Ownership is identified by a marker only (`wa-mcp inbox drain`).
     - A timestamped backup is written before every change. Unparseable JSON aborts with no write.
     - Tests cover idempotence and a remove that leaves user entries intact.
     - All tests run against `--home /tmp/...`.
     - Before T115's RED, check the current Claude Code hooks schema (the `FileChanged` event name, the `asyncRewake` field, and exit-2 semantics) against the claude-code docs and save it as a test fixture. If either key has changed, change the renderer, not the merge logic.
   - The push-transport change (T110 session ids on the HTTP `/mcp`) is the fourth-highest risk. It is additive: POST without a session id keeps working, and the existing `http.test.ts` MCP cases must stay green unchanged.

## Verification (phase exit)

- `vp check` passes and `vp test --coverage` passes, keeping bridge and mcp-server at or above 80%.
- `pnpm run accounting:check` passes.
- Live: dev daemon paired; `wa-mcp subscribe --chat <Test group>`; `wa-mcp install --hooks claude --sub <id> --home /tmp/h`.
  - Sending a message to the Test group adds one line to `inbox.jsonl`.
  - `wa-mcp inbox drain` exits 2 and prints a summary; a second run exits 0.
  - An MCP Inspector session subscribed to `wa://unread` receives `notifications/resources/updated`.
  - `/health.subscriptions.dropped` is 0.
