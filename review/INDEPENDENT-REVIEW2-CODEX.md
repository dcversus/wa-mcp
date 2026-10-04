# Plan: land review/INDEPENDENT-REVIEW2-CODEX.md (Review 3 of 3 — store + daemon correctness)

## Context
Independent read-only review of `packages/bridge/src/store/*`, `lifecycle.ts`, the v1..v14 migration chain, and every raw SQL string in the bridge. Plan mode was active, so the deliverable could not be written to `review/`. The only step left: write the content below, verbatim, to `review/INDEPENDENT-REVIEW2-CODEX.md`. No source changes. No commit unless the owner asks for one.

---

# INDEPENDENT REVIEW 3/3 — Store + Daemon Correctness (wa-mcp 0.9.0)

Reviewer: independent, read-only. Scope: `packages/bridge/src/store/*`, `lifecycle.ts`, migrations v1–v14, all raw SQL in `packages/bridge/src`, the scheduler/shutdown wiring in `bin.ts`/`shutdown.ts`, and the pinned engine fork (`doryani-ai/Baileys#fix/companion-reg-refresh`), which was read where behavior depended on it.

**Verdict: SHIP-WITH-FIXES.** Five High items must land before ship: H1 (dead poll votes), H2 (crash on any store exception), H3 (scheduler bypasses send policy), H4 (autoreply bypasses block rules over LID), H5 (auto-download not wired in the daemon). None of them corrupts existing data irreversibly. Several of them are features that were claimed in the ledger but do not work in the production daemon.

## Critical
None found. No finding corrupts or loses already-stored rows irreversibly, and none affects auth material.

## High

**H1. Inbound poll votes are never persisted. The fork never emits them.**
- `lifecycle.ts:588-605` waits for `messages.update` events carrying `update.pollUpdates`. The pinned fork's decrypt-and-emit block is inside a `/* ... */` comment: `node_modules/.../baileys/lib/Utils/process-message.js:576-624`. No other code path in the fork emits `pollUpdates`.
- `store/messages.ts:154-158` discards the raw `pollUpdateMessage` on the assumption that the decoded path stores it.
- Result: `poll_votes` stays empty and every vote count is 0 in production. Unit tests pass only because their mocks emit an event the real engine never sends. This breaks the AGENTS.md rule that mocks must emulate the engine's real output.
- Even after the fork is fixed, two more bugs remain:
  - `lifecycle.ts:598`: the `chatJid` from the update is not LID-canonicalized. Poll options were stored under the PN chat at ingest (`lifecycle.ts:552-553`), so `storePollVotes` finds no options for an `@lid` DM and drops every vote.
  - `poll-votes.ts`: see M1 (vote changes and retractions).

**H2. Any exception in an event handler crashes the daemon.**
- Every `socket.ev.on` listener is `async` (`lifecycle.ts:447`). Nothing wraps it in try/catch, and the bridge has no `process.on('unhandledRejection')` handler (grep finds none). On Node ≥15 an unhandled rejection terminates the process.
- Reachable throw sites:
  - `canonicalChatJid` rejecting (the lidMapping key store fails)
  - `SQLITE_BUSY` after the 5 s `busy_timeout` (`schema.ts:296`), e.g. when another process holds the write lock
  - `toIsoTimestamp` throwing `RangeError` on an absurd `messageTimestamp` (`messages.ts:31`)
  - `storePollVotes`: `new Date(NaN).toISOString()` (`poll-votes.ts:43`)
  - `withTransaction` failing to `BEGIN`
- A throw mid-batch also skips the rest of `upsert.messages` and the `bus.emit` call, so SSE consumers silently miss the event.

**H3. The scheduler bypasses send rules, the daily cap and the rate guard.**
- `bin.ts:131-160` calls `sendViaSocket` directly. `sendViaSocket` (`send/send.ts:163-176`) checks only `WA_SENDS_DISABLED` and JID validity. It never calls `evaluateSendRules` or `SendGuard.check`.
- A target blocked with `/api/restrict`, or an account already over its daily cap, still receives scheduled messages.

**H4. Autoreply uses the pre-canonical `@lid` JID, so block rules don't match.**
- `lifecycle.ts:551` captures `remoteJid` before line 553 rewrites `message.key.remoteJid` to the PN form. Lines 567-576 pass that stale LID value to `evaluateAutoreply`, `evaluateSendRules` and `sendViaSocket`.
- A block rule written against `<pn>@s.whatsapp.net` never matches `<lid>@lid`, so an LID-era contact who is blocked still gets autoreplies.
- The cooldown key (`autoreply:<jid>`) is also split between the LID and PN forms, which doubles the reply budget.
- Related issues on the same path:
  - Autoreply fires for `status@broadcast`. `isValidRecipientJid` accepts the `broadcast` domain (`shared/src/jid.ts:74`), so a contact's text status that matches a rule triggers a send to the status broadcast. **PLAUSIBLE**: the engine's behavior without a `statusJidList` was not verified.
  - It fires on `type:'append'` backlog after a reconnect, i.e. it replies to stale messages.
  - It fires on re-delivered duplicates, because the `storeMessage` return value is ignored.
  - It does not consult `SendGuard`.

**H5. T93-D auto-download is not wired into the production daemon.**
- `bin.ts:124-130` calls `startBridge(authDir, {syncFullHistory, deviceName, logger, qrPngPath, store})` without `mediaDir`. `mediaDir` reaches only `createHttpServer` (`bin.ts:197`).
- Both `downloadAndLink` (`lifecycle.ts:140`) and `backfillPendingMedia` (`lifecycle.ts:193`) return early when `opts.mediaDir === undefined`. Inbound media auto-download and the startup backfill are therefore no-ops in the real daemon. The T93-D VERIFY evidence must have come from a harness that passes `mediaDir`.

## Medium

**M1. Reactions and poll votes keep stale entries when a user changes their choice.**
- Reactions:
  - The `reactions` primary key is `(chat_jid, message_id, emoji, sender_jid)` (`schema.ts:193`), and the write is `INSERT OR REPLACE` (`messages.ts:92-96`). WhatsApp allows one reaction per sender per message, so when a sender changes 👍 to ❤️, both rows stay and counts inflate. The fix is to delete that sender's row before inserting.
  - Sender key inconsistency: own reactions in a DM are keyed `"me"`, but in a group they use own participant JID (`messages.ts:149-150`).
- Poll votes (for when H1 is fixed):
  - `poll_votes` is keyed by `(voter, option_idx)` and written with `INSERT OR REPLACE` (`poll-votes.ts:33-51`). Each vote update carries the voter's full current selection, but earlier options are never removed, and an empty selection (a retraction) deletes nothing. The engine's own aggregator replaces per author (`Utils/messages.js:736`).
  - Voter attribution: `participant ?? remoteJid` (`poll-votes.ts:38-39`) attributes your own DM votes (`fromMe`, no participant) to the other party.

**M2. Revoke and edit tombstones leave the original content readable through `raw`.**
- Revoke (`messages.ts:130-135` and `http.ts:2376-2379`):
  - Clears `content`, `media_type` and `media_path`, but `raw` still holds the full original proto.
  - `fetchMessageFromStore` (`queries.ts:497-512`) restores from `raw` first, so the original text and media keys of a deleted message flow into quoting, forwarding, `getMessage` retries (`lifecycle.ts:375`) and export.
  - Reactions, poll options and the media file on disk are left in place.
  - A download already in flight can re-set `media_path` on the tombstoned row (`lifecycle.ts:147-149` is not guarded by `deleted = 0`).
- Edit (`messages.ts:142-145`): updates `content` but not `raw`, so `fetchMessageFromStore` returns the pre-edit text.
- Read APIs: `rowToMessage` (`queries.ts:238-255`) does not expose `deleted` or `edited`, and no list or search filters on them.

**M3. The FTS update trigger does a full scan on every row update.**
- `messages_fts_update` and `messages_fts_delete` (`schema.ts:130-137`) run `DELETE FROM messages_fts WHERE message_id = … AND chat_jid = …`. Both are UNINDEXED FTS5 columns, so each fired trigger scans the whole FTS table.
- The trigger fires on every `UPDATE messages`, including `is_unread`, `media_path`, `deleted` and `edited`:
  - `markChatRead` (`chats.ts:24`) and `/api/mark-unread` clearing (`http.ts:3165-3170`) update every row in a chat: O(rows × FTS size) on synchronous node:sqlite, which blocks the event loop, ingest and HTTP.
  - `markAllRead` (`chats.ts:46-55`) loops per chat with no wrapping transaction.
- Fix: a contentless or external-content FTS table keyed by `rowid`, or `AFTER UPDATE OF content`.

**M4. `UPSERT_CHAT` never fires for chats whose `last_message_ts` is NULL.**
- `messages.ts:20`: `WHERE excluded.last_message_ts > chats.last_message_ts` evaluates to NULL (false) when the existing row's timestamp is NULL.
- Chat rows created first by `upsertChatMeta` (history sync, `groups.upsert`), `markHistorySynced`, the ephemeral-setting insert (`messages.ts:163-167`) or `import.ts` are never updated with `last_message_text`/`last_message_ts`, and `name` is never COALESCEd. Use `chats.last_message_ts IS NULL OR …`.

**M5. History sync re-creates the `@lid` chat rows that the LID/PN merge is meant to remove, and the merge never runs.**
- `lifecycle.ts:638-643` passes the raw `chat.id` (LID) to `markHistorySynced`, which upserts a `chats` row for it (`meta.ts:12-17`). Phantom empty `@lid` chats appear next to the canonical PN chats that `upsertChatMeta` correctly wrote at lines 633-636.
- `mergeLidChats` (`merge-lid-chats.ts:37`) is never called outside tests (grep), so nothing repairs the split.
- If it is ever wired up, the merge has its own column drift: see the "Raw SQL" section, item 1.

**M6. Scheduler reliability.**
- `send_at` is stored unvalidated (`http.ts:3005-3019` → `scheduled.ts:19`) and compared lexically with `toISOString()` (`scheduled.ts:63`):
  - Offsets such as `+03:00` fire 3 h late; negative offsets fire early.
  - A non-ISO value such as `"tomorrow"` never fires.
  - Fix: normalize with `new Date(x).toISOString()` at insert and reject `NaN`.
- Rows that come due while the socket is connecting or reconnecting are marked `failed` permanently (`scheduled.ts:45-47`). Examples: the first tick at boot, which is 30 s after start, often before the socket opens; any reconnect window. Nothing retries and no error is recorded.
- After downtime, every overdue row fires immediately with no staleness bound.
- At-least-once: a crash between `send` and `markScheduled` re-sends on restart.
- Cancelling during an in-flight send returns `true`, then `markScheduled` overwrites `cancelled` with `sent` (`scheduled.ts:74-76` has no `AND status='pending'`).
- Tick overlap is correctly guarded by `schedulerBusy` (`bin.ts:132-136`), so there is no double-fire from overlapping ticks.

**M7. Reconnect single-flight holes in lifecycle.**
- `scheduleReconnect`'s timer callback (`lifecycle.ts:333-336`) and `connect()` itself never check `closed`:
  - `logout()` (`819-837`) sets `closed` but does not clear `reconnectTimer` or `stalenessTimer`. A backoff that is already pending (up to 60 s) fires `connect()` and creates a new socket after logout.
  - `close()` calls `socket.end(undefined)` with listeners still attached (`849`). The resulting `connection: close` derives `reconnecting` → `scheduleReconnect()` (`532-533`), which sets a fresh timer after `close()` has already cleared the old one. It is unref'd, but in-process restarts and tests get a ghost `connect()` against a closed store.
- The staleness forced reconnect (`414-428`) ignores `reconnectPending`. With `WA_STALENESS_MS` under about 15 s (4 × interval < 60 s backoff), it can call `connect()` while a backoff timer is pending, and the timer later calls `connect()` again. The timer path does not detach the previous socket's listeners, so two live sockets share the same creds (stream conflict 440 churn).
- When `pairing-blocked`, `connect()` returns at line 353 before resetting the staleness interval. The old interval keeps firing against the ended socket: every 4 ticks it increments `reconnects`, logs `STALENESS`, and calls `connect()`. This loops forever, inflating `/health` and spamming logs.
- `resumePairing()` (`759-774`) does not check `closed` and can revive a logged-out or closed bridge.

**M8. `close()` does not drain `saveChain`.**
- `shutdown.ts:33-35` awaits `bridge.close()` and then the process exits (`proc.exit(0)`, with a 3 s force). `close()` (`lifecycle.ts:838-850`) never awaits `saveChain`.
- A `creds.update` arriving during shutdown can be cut mid-write, or lost, leaving stale or partial creds on disk.

**M9. Backup and manual-unread are dead or unsafe.**
- `runBackup` (`backup.ts:7`) is never called outside tests.
- If it is wired, it hot-copies a live WAL database file by file (`cpSync` of the db, `-wal`, `-shm`). The snapshot can be torn; use `VACUUM INTO` or the backup API.
- `retention = 0` deletes the backup it just made. `NaN` disables pruning entirely.
- The `backups/` directory is created without mode `0o700`.
- `chats.manual_unread` (v13) is written by `http.ts:2731` and never read: `listChats` and `getUnreadCounts` ignore it. It also duplicates `read_state.manually_unread` (v1), which is never written as 1.

**M10. Group sender identity is not canonicalized at ingest.**
- Only `remoteJid` is LID→PN mapped (`lifecycle.ts:552-553`, `625`). `key.participant`, which becomes `sender_jid`, reaction authors and poll voters, stays `@lid` in LID-era groups.
- One person can appear under two identities: `listMessages({sender: pn})` misses their LID-addressed messages, and digest top-participants splits them in two.
- `protocolActorAllowed` is internally consistent (raw vs raw), so the revoke/edit authorization check is unaffected.

## Low
- **L1.** `downloadAndLink` (`lifecycle.ts:148`), `/api/media/:id/download` (`http.ts:2259`) and `media/resolve.ts:357` update `messages … WHERE id = ?` with no `chat_jid`. The primary key is `(chat_jid, id)`, so an id collision across chats writes to the wrong rows. The same applies to `getMessage` (`lifecycle.ts:375`) and the `media_path` reads (`http.ts:1645, 1762, 2192, 2246`).
- **L2.** `attachPolls` vote counts group by `message_id` only (`queries.ts:144`), so they can merge across chats. The `row.poll === undefined` filter (`queries.ts:132`) is always true.
- **L3.** `countMessages` uses `timestamp >= after` (`queries.ts:536`) while `listMessages` uses `>` (`queries.ts:316`), so the truncation metadata can be off by one.
- **L4.** `markMessagesRead([])` produces `IN ()`, a SQL syntax error (`chats.ts:34-37`). In `/api/read` (`http.ts:1257`) that error surfaces as a 500 after the read receipt was already sent. `last_read_message_id` is set to the newest message in the chat, not the newest one actually read.
- **L5.** `mergeLidChats`:
  - `skippedMessages` counts every LID row, including the ones just moved (`merge-lid-chats.ts:62-65`).
  - `MAX(read_state.updated_at, NULL)` returns NULL (`:118`).
  - archived, pinned, muted and labels state is dropped.
- **L6.** The legacy v1 `scheduled` table (`schema.ts:91-97`) is dead schema. Nothing reads or writes it (grep), but it sits next to `scheduled_messages` (v11) and invites misuse. Drop it in v15.
- **L7.** Send rules: `allow` rules are inert (`send-rules.ts:60`), so an allow exception inside a block wildcard is impossible. An invalid `expires_at` parses to `Invalid Date` and the rule never expires.
- **L8.** `import.ts`:
  - No transaction, so a failed import partially persists.
  - The lharries layout uses the chat name as every message's `sender_name` (`:72`).
  - Its timestamps are stored unvalidated (`:73`).
  - The gofork layout assumes seconds (`:116`).
- **L9.** `fetchHistory` with no anchor sends `id: chatJid` (`lifecycle.ts:806`). With an anchor it uses the PN chat JID; LID-era accounts may need the LID. **PLAUSIBLE.**
- **L10.** Autoreply cooldown is stamped before the send (`autoreply.ts:60-64`), so a failed send still consumes the cooldown. Rule regexes are user-supplied and unbounded (ReDoS by the operator only).
- **L11.** `backfillPendingMedia` runs synchronously inside the first `connect()` (`lifecycle.ts:388`), before the socket is open. `reuploadRequest` for expired media cannot succeed at that point. (Moot until H5 is fixed.)
- **L12.** Scheduled sends don't pass `opts.store` (`bin.ts:145, 155`). Persistence relies on the engine's `emitOwnEvents` echo (default `true`, `Defaults/index.js:55`). That works, but it is implicit.

## Checked and OK
- **Migration chain v1→v14:**
  - Each migration runs in its own `BEGIN/COMMIT` with rollback (`schema.ts:265-288`), and the version is marked inside the same transaction.
  - Ordering is strictly by version (the declaration order of V6/V7/V8 is cosmetic).
  - `ALTER TABLE ADD COLUMN` is transactional in SQLite, and the V2 FTS backfill is protected against duplicates on retry.
- **`saveChain` serialization** (`lifecycle.ts:272-278`): correct. Failures are logged and the chain continues.
- **Timestamp units:** `toIsoTimestamp` normalizes seconds and milliseconds at one boundary (`messages.ts:28-31`). `fetchHistory` passes milliseconds, which matches the fork's `oldestMsgTimestampMs` (`Socket/messages-recv.js:49`).
- **DM LID canonicalization is consistent in both directions:** inbound is rewritten to PN before storage (`lifecycle.ts:552-553`, `615-649`), and outbound is stored under the normalized PN with the LID used only on the wire (`send/send.ts:177-209`).
- **History-sync batch** is atomic: one transaction, with async LID resolution hoisted before it.
- **T93 staleness watchdog:** activity resets `staleMisses` correctly (`lifecycle.ts:410-413`), and the reconnect accounting now happens before the listeners are detached (`419-421`). The remaining holes are listed in M7.

## Raw-SQL column cross-check (every statement in `packages/bridge/src`)
All column names in every raw SQL statement were checked against the effective v14 schema. **No statement references a nonexistent column.** The `from_me`-class bug does not recur: `import.ts:92` reads `from_me` from the *foreign* gofork database, which is that schema's own column. The drift that does exist is in column lists that **omit** newer columns:
1. **`merge-lid-chats.ts:52-57`.** The `INSERT … SELECT` copies the v1 column set plus `raw`, but omits `deleted` (v7) and `edited` (v12). Merged messages lose their tombstone and edit flags; revoked rows come back as `deleted = 0` with content `'[revoked]'`. The merge also doesn't move `reactions`, `poll_options`, `poll_votes`, `transcripts`, `media_files` or `chat_labels` (all keyed by `chat_jid`), so they are orphaned under the deleted LID JID.
2. **`messages.ts:6-10` and `import.ts:15-18`** omit `deleted` and `edited`. That is harmless because both default to 0, but listed for completeness.
3. **`messages.reactions` (v1 TEXT)** is always written as NULL (`messages.ts:202`) and superseded by the v9 `reactions` table. It is a dead column, still copied by the merge.
4. **`read_state.manually_unread` vs `chats.manual_unread`:** two columns for one concept (M9).
5. **`media_files` (v1)** is never written or read anywhere in the bridge. Dead table.
6. **`scheduled` (v1)** is a dead table (L6).

Verified clean (columns match the schema): `notifications.ts` (`notification_rules`), `send/safety.ts` (`meta`), `media/transcribe.ts` (`transcripts`), `media/resolve.ts:357`, and the `http.ts` statements at 1645, 1762, 2192, 2246, 2259, 2356, 2376, 2418, 2461, 2488, 2504, 2621, 2644, 2666, 2731 and 3165. Also clean: `lifecycle.ts` 148, 199, 375, 786 (`is_from_me` is correct after the fix), and every statement in `store/*.ts`.

## Fix priority
H2 → H1 → H3 → H4 → H5 → M1 → M2 → M7 → M3 → M6 → the rest.

---

## Execution step (after approval)
1. Write everything between the two `---` rules above to `review/INDEPENDENT-REVIEW2-CODEX.md`.
2. Don't modify any other file and don't commit (per the review brief).

## Verification
- `test -f review/INDEPENDENT-REVIEW2-CODEX.md && grep -c '^\*\*[HML][0-9]' review/INDEPENDENT-REVIEW2-CODEX.md` confirms the file exists and the findings are present.
- Spot-check the three engine-truth claims:
  - `sed -n 570,630p node_modules/.pnpm/baileys*/node_modules/baileys/lib/Utils/process-message.js` shows the commented-out poll block (H1).
  - `grep -n startBridge -A7 packages/bridge/src/bin.ts` shows no `mediaDir` (H5).
  - `grep -rn unhandledRejection packages/bridge/src` returns nothing (H2).
