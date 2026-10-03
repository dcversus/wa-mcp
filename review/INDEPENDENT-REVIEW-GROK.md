# Independent review — wa-mcp 0.9.0

Reviewer: Grok (read-only). Date: 2026-10-03. No source files were modified and nothing was committed.

Scope was the running daemon, not the diff: reconnect and ingest, SQLite migrations and LID/poll/tombstone handling, the bearer and query-token matrix, web-ui HTML injection, URL media fetches, and the CLI/tarball. Line numbers refer to the tree as reviewed.

The auth boundary is the release blocker. `GET /health` is unauthenticated and returns a token the same file's comment says can only open pairing routes. That token can read every chat, send messages, open the event stream (including `creds.update`), and read the daemon token off disk through `GET /api/qr?file=token`. Default bind is loopback, so this is any local process, any other user on the machine, or a DNS-rebinding page. `WA_BIND_HOST` makes it remote. ADR 0004's 0600 token file does not survive this.

## Critical

### C1. Unauthenticated `/health` hands out a token that can read the account, send, and stream Signal keys

`packages/bridge/src/http.ts:85-87` documents the pairing token as authorizing `/api/qr`, `/api/pairing-code`, and `/api/pair/resume` only, and "never account data". `packages/bridge/src/bin.ts:143-145` repeats that scope. The gate does not.

`packages/bridge/src/http.ts:1526-1541` returns `pairingToken` from `GET /health` with no credential check. `packages/bridge/src/http.ts:1626-1645` then accepts that token for every `GET /api/*`, for `GET /events`, and for `POST` to `/api/send`, `/api/read`, `/api/presence`, `/api/tts`, `/api/transcribe`, `/api/pairing-code`, `/api/pair/resume`, and `/api/group/participants`. Tests in `packages/bridge/tests/http.test.ts:2138` lock the send capability in.

`packages/bridge/src/lifecycle.ts:325-328` forwards raw `creds.update` payloads onto the bus. `packages/bridge/src/events.ts:42` subscribes that event. `packages/bridge/src/http.ts:1689-1690` writes `JSON.stringify(event.payload)` onto every SSE client. Baileys `creds.update` carries noise, identity, and pre-key material. `JSON.stringify` on a `Uint8Array` emits the key bytes. Anyone who can open the port can `GET /health`, then `GET /events?token=…` or `Authorization: Bearer`, and read the account keys. The same token can `POST /api/send`.

Why it matters: the 0600 token file is the stated control against other local users. This endpoint replaces it with a world-readable (on the port) credential that is strictly more powerful than the comment claims. On `WA_BIND_HOST=0.0.0.0` (`packages/bridge/src/bin.ts:45`) it is a remote account takeover.

Suggested fix: stop returning any credential from `/health`. Keep the pairing token, if one is still required, off the unauthenticated response and narrow it to the three pairing routes named in the comment. Do not put `creds.update` on the event bus that SSE serializes; persist creds inside the process and emit a redacted "credentials saved" notice. Add a regression test that `/health` contains no token and that the pairing token receives 401 on `/api/chats`, `/api/send`, and `/events`.

### C2. `GET /api/qr?file=` reads arbitrary files in the data directory, including the daemon token

`packages/bridge/src/bin.ts:152` sets `qrDir` to the data directory. That directory holds `token` (`packages/bridge/src/bin.ts:50`). `packages/bridge/src/http.ts:266-284` accepts any `file` query value that does not contain `..`, `/`, or `\`, then `readFile`s `join(qrDir, fileParam)` and returns the bytes as base64 in the `png` field (`http.ts:292-294`).

The pairing token from C1 is allowed to call `/api/qr` (`http.ts:1640`). Chain: `GET /health` → `GET /api/qr?file=token` with that bearer → base64 of the daemon token, which authorizes `/api/privacy`, `/api/block`, `/api/delete`, `/mcp`, and the rest of the matrix.

Why it matters: a path check that only rejects slashes is not a QR allowlist. The secret the file mode was meant to protect is a sibling of `qr.png`.

Suggested fix: delete the `file` parameter, or allow only the single configured QR filename after `realpath` containment in a dedicated QR directory that does not contain `token`, `auth/`, or `store/`. Never point `qrDir` at the data directory.

## High

### H1. Reconnect leaves the previous socket running, and a late close starts another one

`packages/bridge/src/lifecycle.ts:170-193` assigns a new `makeWASocket` on every `connect()` and registers async listeners on it. Nothing calls `end()` or removes listeners on the previous socket. `close()` (`lifecycle.ts:357-365`) ends only the socket currently in the variable. `resumePairing()` (`lifecycle.ts:350-356`) calls `connect()` without clearing `reconnectTimer` and without the `reconnectPending` guard.

A close from the orphaned socket still runs the handler at `lifecycle.ts:202-233`, which mutates the shared `status` and calls `scheduleReconnect()` or `connect()` again. Two authenticated sockets then share one creds object. WhatsApp answers that with `401 device_removed`. Ingest also double-fires; `INSERT OR IGNORE` hides the duplicate row but does not hide double receipts.

Suggested fix: before creating a socket, `end()` the previous one, detach its listeners, and ignore events whose socket is not current. `resumePairing` should cancel the timer and go through the same single-flight path as 515.

### H2. URL media fetch is an open SSRF, and the response is forwarded to WhatsApp

`packages/bridge/src/media/resolve.ts:164-186` calls `fetch(input.url)` with no scheme or host allowlist. Redirects are followed (undici default). `content-length` is checked only when the header is present and larger than the cap (`resolve.ts:175-178`); a chunked body is buffered completely via `arrayBuffer()` before the size check. The error string includes the URL (`resolve.ts:170`). `packages/bridge/src/http.ts:625-641` accepts `{ url }` on image, video, audio, document, and sticker sends, then `sendViaSocket` ships the bytes.

Why it matters: a caller who can send (the C1 token, or the real bearer) can make the daemon GET `http://169.254.169.254/`, `http://127.0.0.1:<port>/health`, or any internal URL and deliver the body as a WhatsApp document. There is no block for link-local, loopback, or private ranges, and no redirect re-check.

Suggested fix: allow only `https:`, resolve the host, reject private, loopback, link-local, and metadata addresses both before connect and on every redirect, and stream with a hard byte cap that aborts the socket. Do not echo the target URL in client errors.

### H3. Migrations are not transactional and can brick the store or duplicate search rows

`packages/bridge/src/store/schema.ts:208-215` runs `db.exec(migration.sql)` and only then inserts the version row. There is no `BEGIN`. SQLite `ALTER TABLE` is not re-runnable. If the process dies after `MIGRATION_V3` / `V4` / `V7` applies and before the version is marked, the next boot throws `duplicate column name` inside `openStore` and the daemon never listens.

`MIGRATION_V2` (`schema.ts:116-125`) `INSERT`s every message into FTS5. A retry after a crash past that insert and before the version mark inserts them again. `searchMessages` joins FTS on `(chat_jid, message_id)` (`packages/bridge/src/store/queries.ts:282-284`) and will return duplicate hits. The same gap exists for the FTS triggers if they were created and the insert is repeated.

Suggested fix: wrap each migration in a transaction. For SQLite builds where `ALTER` cannot roll back, record a per-statement progress marker, or check `pragma table_info` before each `ADD COLUMN`. Make the FTS backfill `INSERT` idempotent (delete the FTS rows for that rebuild first, inside the same transaction).

### H4. Poll votes are dropped, and the consumer the code names does not exist

`packages/bridge/src/ingest/extract.ts:234-241` turns `pollUpdateMessage` into a vote with `selections: []`. The encrypted option hashes are never decrypted. `extractContent` is called from `storeMessage` with no `pollUpdates` argument, so `pollVoteFromUpdates` (`extract.ts:388-399`) does not run on the live path. `packages/bridge/src/store/messages.ts:121-125` then returns without writing, citing a "T60 lifecycle messages.update consumer". `messages.update` is not in `EVENT_NAMES` (`packages/bridge/src/events.ts:29-43`) and `lifecycle.ts` never inserts into `poll_votes`. The table is created (`schema.ts:61-68`) and never used.

Why it matters: sending a poll works (`http.ts:652-679`). Counting votes does not. A 0.9.0 that stores poll options and silently discards every vote will look done in the schema and empty in the product.

Suggested fix: subscribe to the engine event that carries decrypted poll updates, map selected option hashes to `poll_options.idx`, and `INSERT OR REPLACE` `poll_votes` keyed by voter. Until that exists, do not advertise poll results.

### H5. A revoke that arrives before the message is stored does not stick, and list/search ignore the tombstone

`packages/bridge/src/store/messages.ts:104-111` tombstones by `UPDATE` on `(chat_jid, id)`. If the revoke is ingested first, the update matches zero rows and returns. A later upsert of the original message uses `INSERT OR IGNORE` (`messages.ts:6-10`), which inserts the live content with `deleted` defaulting to 0. Nothing re-checks a pending revoke.

`listMessages` (`queries.ts:185-188`) and both search paths (`queries.ts:282-286` and `309-320`) have no `deleted = 0` predicate. A tombstone that does land still appears in chat history and search as `[revoked]`, and the media file is unlinked from the row (`media_path = NULL`) but not from disk (`messages.ts:107-110`). `GET /api/media/:id` will 404, the bytes stay in the media directory.

`POST /api/delete` (`http.ts:1799-1805`) calls `socket.sendMessage` with the raw `chat_jid` and does not go through `resolveLidJid` (`packages/bridge/src/send/send.ts:147`). On a LID-era account the revoke is sent to the PN JID the engine will not encrypt for. The local row is still marked deleted.

Suggested fix: record a revoke key even when the message row is absent, and have `storeMessage` honor it before insert. Filter `deleted = 1` out of list and search. Unlink the media file inside the media directory. Route delete through `sendViaSocket` so LID rewriting matches ordinary sends.

### H6. LID chats split, and the repair script drops tombstones

Live upserts rewrite `@lid` only when `canonicalChatJid` resolves (`lifecycle.ts:252-254`). A mapping that is not loaded yet stores the LID. History applies the map only to JIDs seen on messages in that batch (`lifecycle.ts:269-288`); a chat row whose id ends in `@lid` and is not in `lidToPn` is stored under the LID forever. The daemon never calls `mergeLidChats`. The manual script is `pnpm merge-lid-chats`.

The script's copy (`packages/bridge/src/store/merge-lid-chats.ts:52-57`) omits the `deleted` column added in migration v7, so revoked messages come back as `deleted = 0`. It also does not move `poll_options`, `poll_votes`, `transcripts`, `media_files`, or `notification_rules`. After `INSERT OR IGNORE`, conflicting LID rows are deleted (`merge-lid-chats.ts:128-129`), so the PN copy wins even when the LID copy is newer. `skippedMessages` counts every LID row still present before that delete, which is the whole chat, not the conflicts.

Suggested fix: run the merge from the daemon once mappings exist, and repeat it when a new LID→PN mapping appears. Include `deleted` and the child tables in the copy. On id conflict, keep the row with the newer timestamp (and the tombstone, if either side is revoked).

### H7. Contact, chat-meta, and participant events are subscribed and then discarded

`upsertContact` (`packages/bridge/src/store/contacts.ts:42`) is only called from tests. `lifecycle.ts` handles `messages.upsert`, `messaging-history.set`, `groups.upsert`, and `creds.update`. It does not handle `contacts.upsert`, `chats.update`, or `group-participants.update`, even though those names are subscribed (`events.ts:35-39`) and re-emitted on SSE. The contacts page therefore stays empty unless something else writes the table. Archive, pin, mute, and unread changes that arrive from the phone are not applied. Participant joins and leaves after the initial `groups.upsert` are not applied.

`scheduled`, `templates`, and `autoreply_rules` (`schema.ts:91-109`) have no writer anywhere under `packages/`.

Suggested fix: either persist those three events in the handler that already owns the store, or stop subscribing and stop shipping tables that nothing fills. Empty product surface should not be in the 0.9.0 schema.

### H8. Group subject and description are interpolated into HTML unescaped

`packages/web-ui/src/main.ts:539-542` builds the group editor with `data-meta-jid="${jid}"` and `value="${meta?.subject}"` / `value="${meta?.description}"` and passes it to `insertAdjacentHTML`. Group subject and description are chosen by whoever admins the group. A subject of `" autofocus onfocus="alert(1)` breaks out of the attribute. The page holds the bridge token in `localStorage` and in media URLs (`packages/web-ui/src/pages.ts:150-152`), so script execution can send messages and read chats.

`packages/web-ui/src/main.ts:248-252` does the same with `err.message` on the render-failure path. `escapeHtml` exists (`packages/web-ui/src/escape.ts:11-13`) and is used by `pages.ts`. This call site skipped it.

Suggested fix: pass subject, description, and jid through `escapeHtml` before they touch HTML. Render the failure string with `textContent`. Add a DOM test whose subject contains quotes and angle brackets.

### H9. The lock is check-then-create, and a failed cloud boot orphans a live session

`packages/bridge/src/lock.ts:38-50` reads the lock, then `writeFileSync`s it. Two processes can both observe "not held" and both start Baileys against one auth directory. That is the same dual-session failure as H1, reached at startup.

`packages/bridge/src/bin.ts:118` calls `startBridge` before cloud config is validated. On invalid cloud config, `bin.ts:127-133` logs "daemon not started", sets `exitCode = 1`, and returns. The lock is not released, shutdown hooks are not installed, and the socket from line 118 keeps the process alive with no HTTP server. The next start hits "session held".

Suggested fix: create the lock with `wx` / `O_EXCL` and replace it only after a pid check inside the same exclusive create. Validate channel config before `startBridge`. On that failure, `close()` the bridge and release the lock, then `process.exit(1)`.

### H10. Default transcription and TTS are mocks, and TTS will send the mock audio to a real chat

`packages/bridge/src/http.ts:1365` defaults `WA_TRANSCRIBE_ENGINE` to `"mock"`. `packages/bridge/src/media/transcribe.ts:14-20` returns a hash-derived sentence. `http.ts:1396-1405` stores it in `transcripts` and returns it as the transcript. `packages/bridge/src/http.ts:1442-1461` always constructs `MockTtsEngine`, whose payload is the ASCII bytes `OggS` + `mock-tts` + a hash (`packages/bridge/src/media/tts.ts:13-17`), and if `chat_jid` is set it `sendViaSocket`s that buffer as a PTT voice note. The C1 token is allowed to call `/api/tts`.

Why it matters: a button labeled as transcription lies, and a send path labeled as text-to-speech delivers garbage audio to someone's phone. Both look finished because the routes return 200.

Suggested fix: refuse `/api/transcribe` and `/api/tts` with 501 until a real engine is configured. Do not persist mock text, and do not pass mock audio to `sendViaSocket`.

### H11. The web UI's group controls do not do what they say

`packages/web-ui/src/api.ts:110` posts `{ group_jid }` and nothing else. The bridge requires `action` and `jids` (`http.ts:1060-1068`). `main.ts:551-561` reads the participant input and then ignores it. `main.ts:563-568` sets remove and promote to `() => undefined`. `packages/web-ui/src/api.ts:124` always sends `block: true`, and the unblock button calls it (`main.ts:595-599`). Clicking Unblock blocks the JID. Errors are swallowed with `.catch(() => undefined)`.

Suggested fix: post `{ group_jid, action, jids }` for add, remove, and promote. Add `unblock` that sends `block: false`. Surface the 400 instead of clearing it.

## Medium

### M1. Release package does not declare `engines`, and doctor will bless Node 22.0–22.4

Root `package.json:27-29` says `node: ">=22.5.0"`. That package is `"private": true` and is not what `scripts/pack-release.sh` packs. `@wa-mcp/cli`, `@wa-mcp/bridge`, `@wa-mcp/mcp-server`, and `@wa-mcp/shared` have no `engines` field. The packed `package/package.json` inside `wa-mcp-0.9.0.tgz` has none either. `node:sqlite` is required at runtime (AGENTS.md). npm will not refuse Node 20 or 22.4.

`wa-mcp doctor` calls `runDoctor` with `minNodeMajor: 22` (`packages/cli/src/bin.ts:91`). `packages/cli/src/doctor.ts:23-28` compares the major only. Node 22.0.0 is reported ok and then the bridge dies on `node:sqlite`.

Suggested fix: set `"engines": { "node": ">=22.5.0" }` on every shipped package, and compare `process.versions.node` against `22.5.0` in doctor.

### M2. `wa-mcp skills install` points at a directory the package does not contain

`packages/cli/src/bin.ts:25` sets the source to `<cli package>/skills/wa-mcp`. `packages/cli` has no `skills/` directory. `package.json` `files` is `["dist"]`. The 0.9.0 tarball has zero `skills/` entries (2097 paths listed). `installSkills` (`packages/cli/src/skills.ts:24`) `cpSync`s that path and will throw `ENOENT`. Tests pass a repo path instead of the path `main` uses, so they do not catch it.

Suggested fix: ship `skills/wa-mcp` inside the cli package (and in `files`), or copy from a path relative to the installed package that actually exists. Test `main(["skills", "install"])` against the packed layout.

### M3. `pair` ignores `--data-dir`, and `install` will write an empty token

`packages/cli/src/bin.ts:30` computes `dataDir` from `--data-dir`. `start` passes it through (`bin.ts:131-133`). `pair` reads the token from `DEFAULT_DATA_DIR` (`bin.ts:61`), which is always `~/.wa-mcp`. A daemon started with `--data-dir` cannot be paired by the matching flag; pair reports "no bridge token" or uses the wrong token.

`install` uses `flags.token ?? readToken(dataDir) ?? ""` (`bin.ts:33-37`) and still writes the MCP config. A first-run install before the daemon has minted a token is "verified" with an empty bearer. `writeFileSync(..., { mode: 0o600 })` (`packages/cli/src/writers.ts:58`) does not change the mode of an existing Claude/Cursor config, which is typically 0644, so a later install drops the real token into a world-readable file.

Suggested fix: use `dataDir` in `pair`. Refuse `install` when the token is empty. After writing, `chmod` the config only if this tool created it; otherwise tell the user the existing file's mode.

### M4. The release tarball vendors dependency tests, coverage HTML, and VCS junk

`wa-mcp-0.9.0.tgz` contains 2097 paths. 524 of them match `coverage/`, `test/`, `.test.`, `example/`, or `.map`. Examples seen at the top of the listing: `pngjs/coverage/lcov-report/`, `pino/test/`, `thread-stream/.husky/pre-commit`, `qrcode-terminal/example/`. `bundledDependencies` is pulling in each dependency's published tree with no file filter. Baileys itself is present, which is what the github pin needs; the test and coverage files are not.

Suggested fix: pack with a `files` / `.npmignore` policy on the bundled packages, or prune `node_modules/**/{test,tests,coverage,example,examples,.husky}/**` after install and before `pnpm pack`.

### M5. Session bearer is placed in media query strings

`packages/web-ui/src/pages.ts:150-152` appends `?token=` to every image, video, audio, and document URL. `effectiveToken` prefers the saved daemon token over the pairing token (`packages/web-ui/src/state.ts:65-66`). Query tokens are allowed for `GET /api/media/*` and `GET /events` (`http.ts:1615-1622`). They land in browser history, proxy logs, and any Referer if a media URL is opened off-origin. The SSE and media exceptions are justified for `EventSource` and `<img>`. The value sent should be a media-scoped nonce, not the daemon bearer.

Suggested fix: mint a short-lived media capability, or cookie the UI on loopback. Do not put `settings.token` in a URL.

### M6. Rate-limit map, empty read-receipts, and several request paths can hang or grow

`createRateLimiter` (`http.ts:148-167`) never deletes idle buckets. Bound to a non-loopback host, a scan of source addresses grows the map for the life of the process.

`markMessagesRead` (`packages/bridge/src/store/chats.ts:33-37`) builds `IN (${placeholders})`. An empty `message_ids` array, which passes the validator at `http.ts:858-863`, produces `IN ()` and throws. The `.catch` on the receipt turns that into a generic 500 after the receipt may already have been sent.

`POST /api/delete` `JSON.parse`s the body with no try/catch (`http.ts:1763-1766`). `GET /api/group/info` awaits `groupMetadata` with no try/catch (`http.ts:1746-1750`). Both run inside `readBodyWithCap(...).then(async ...)`, which has no rejection handler. The response is never ended. The same pattern applies to a throw from `storeMessage` inside the async Baileys listener (`lifecycle.ts:195-256`): one bad message rejects the handler, the rest of that upsert batch is skipped, and the rejection is unhandled.

Suggested fix: cap and prune the rate-limit map. Reject empty `message_ids` before SQL. Wrap each request branch and each event handler in try/catch that always ends the response or logs and continues the batch.

### M7. `isValidRecipientJid` accepts any numeric user on any domain

`packages/shared/src/jid.ts:66-78` returns true for `broadcast` and for any local part that is all digits, with no server allowlist. `123@example.com` passes the send gate. The engine will likely reject it, but the gate named in ADR 0004 is not the WhatsApp JID check it appears to be. `@broadcast` is explicitly allowed, which is status-broadcast territory.

Suggested fix: allow only `s.whatsapp.net`, `lid`, `g.us`, and `newsletter`, and decide explicitly whether status broadcast is in 0.9.0.

## Low

### L1. Doctor leaves a probe file behind

`packages/cli/src/doctor.ts:32-33` writes `${dataDir}/.doctor-probe` and never unlinks it. A crash mid-write is harmless; a successful doctor still litters the data directory.

Suggested fix: unlink in a `finally`. Create the directory before the probe so "not writable" is distinct from "does not exist".

### L2. Media files are created mode 0644

`packages/bridge/src/media/resolve.ts:209-210` writes outbound and downloaded media as 0644, then chmod 0644. The parent directory is 0700, so other users cannot traverse it. The file mode still contradicts the 0600 policy on the token and the database, and a copied file or a loosened directory exposes message bytes.

Suggested fix: write with mode 0600.

### L3. Dead and half-wired UI strings

`packages/web-ui/src/app.ts:86-88` renders `<p>not implemented</p>` when a route has no loader. `main.ts` supplies every route, so production hides this; any new route ships the placeholder. `main.ts:743` is a stray `await client;` before `groupMeta`. `packages/bridge/src/http.ts:2000-2002` still has a 501 "route not wired yet" branch for `API_PATHS` entries that fell through.

Suggested fix: delete the placeholder and the stray statement, and fail the build if a `Route` has no loader.

### L4. Shutdown does not destroy keep-alive sockets

`packages/bridge/src/http.ts:2020-2023` uses `server.close()`, which stops accept and waits for existing connections. SSE heartbeats (`http.ts:1692-1698`) keep those responses open. `packages/bridge/src/shutdown.ts:40-46` races that against a 3s timer and then `process.exit(0)`, so the process does die. A close that is given longer than the force timer, or a caller that awaits `BridgeHttp.close()` without the hook, hangs on the first SSE client.

Suggested fix: on shutdown, end active responses and `closeAllConnections()` before `server.close()`.

## Checked and left alone

These were on the suspect list and held up under the current code:

- Bearer comparison hashes both sides and uses `timingSafeEqual` (`http.ts:128-146`), so the compare itself is not an early-exit oracle.
- UI static files reject `..` and require the resolved path to stay under `uiDir` (`http.ts:1480-1492`).
- Send-from-`path` checks lexical containment and `realpath` (`resolve.ts:106-127`). Media route ids are restricted to `[A-Za-z0-9_-]` (`http.ts:1252-1259`).
- History sync persists inside one `BEGIN`/`COMMIT` (`lifecycle.ts:281`, `schema.ts:227-236`). Creds writes are serialized (`lifecycle.ts:101-108`).
- Default bind is `127.0.0.1` (`bin.ts:45`). The critical findings are exploitable there by another local user; they become network-exploitable only when `WA_BIND_HOST` is changed. That does not make C1 or C2 acceptable on loopback, because the token file mode exists specifically to stop other local users.

## Release call

Do not call 0.9.0 done while C1 and C2 are in the tree. H1, H2, H3, and H10 are the next cut: a reconnect can drop the linked device, a media URL is an internal-network fetch, a crashed migration bricks the store, and the default voice-note path sends mock bytes. The poll, LID, contact, and group-control gaps (H4–H7, H11) are the ones a user will notice on the first afternoon.
