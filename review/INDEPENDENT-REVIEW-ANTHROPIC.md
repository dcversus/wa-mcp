# Independent Code Review: wa-mcp 0.1.0 (Anthropic reviewer)

- **Date:** 2026-10-03
- **Tree:** `main` @ `7bef0c3` (plus uncommitted docs-only changes)
- **Mode:** read-only review. No source was modified and nothing was committed.
- **Method:** I read every bridge `src/` module, `mcp-server/src/{server,tools}.ts`, `web-ui/src/{main,pages,pages-pairing,api,app,escape}.ts`, `cli/src/{bin,writers}.ts` and `shared/src/jid.ts`. I spot-read the relevant tests and the engine fork (`packages/bridge/node_modules/baileys/lib`). I also ran one empirical check, a raw-proto JSON round-trip through `getMediaKeys`. It passed, so the "stored raw proto loses Buffers" suspicion was dropped and is not listed below.
- **Confidence:** every finding below cites code I read. Where a finding comes from Node or engine semantics and I did not execute it, it says so.

## Verdict

**I would not ship a 0.1.0 claim that GOAL §10 (security) holds.** Three Critical issues make the bearer-token model largely ineffective:

1. Any process or web page that can reach `/health` can read every message and send messages as the user.
2. A stored XSS in the groups page leads to full account takeover.
3. Several request paths crash the daemon with an unhandled rejection.

There is also systematic **contract drift between the web-UI client and the bridge**. Roughly ten UI actions never work against the real server. The unit tests do not catch it because each side mocks the other, which is the same mock-blindness pattern behind the earlier live bugs.

The good parts are solid and worth keeping:
- media `path` containment, which uses `realpath` on both sides (`media/resolve.ts:106-134`)
- constant-time token comparison over digests (`http.ts:128-146`)
- parameterized SQL throughout
- FTS query sanitization (`queries.ts:245-263`)
- transactional history sync (`lifecycle.ts:281`)
- the explanations behind pairing pollution and the 515 handshake (`lifecycle.ts:130-154, 204-218`)

---

## Critical

### C1. `/health` publishes a bearer token that reads all data and sends messages. There is no Host/Origin check, so any website can use it via DNS rebinding.

- **Where:**
  - `packages/bridge/src/http.ts:1526-1543`: unauthenticated `/health` returns `pairingToken`.
  - `http.ts:1626-1645`: that token authorizes **every `GET /api/*`** (chats, messages, search, contacts, media, `group/invite`, `blocklist`). It also authorizes `POST /api/send`, `/api/read`, `/api/presence`, `/api/tts`, `/api/transcribe`, `/api/group/participants` (add/remove/promote members), `/api/pair/resume`, `/api/pairing-code`, and the `/events` SSE stream.
  - The documentation contradicts the code. `http.ts:85-87` says it authorizes "/api/qr, /api/pairing-code and /api/pair/resume ONLY — never account data", and `bin.ts:143-144` repeats that claim.
  - The tests lock the behavior in: `tests/http.test.ts:2092-2136` ("ui token reads account data").
  - There is no `Host` or `Origin` validation anywhere (grep for `headers.host` and `headers.origin` finds nothing).
- **Why it matters:** "bearer token on every endpoint" is effectively void, because the credential is handed to anyone who asks.
  - **DNS rebinding:** an attacker page on `evil.example` re-resolves to `127.0.0.1`. It then reads `http://evil.example:8080/health` same-origin, takes `pairingToken`, and calls `GET /api/messages` and `POST /api/send` with an `Authorization` header (allowed, because the request is now same-origin). The result is full exfiltration of the WhatsApp history plus sending as the user. The default port is fixed at 8080 (`bin.ts:40`), which makes this easy to aim.
  - Any other local user or process on a shared machine gets the same access.
  - With `WA_BIND_HOST=0.0.0.0`, the whole LAN gets it.
- **Fix:**
  1. Remove `pairingToken` from `/health`.
  2. Bootstrap the UI credential out of band. For example, `wa-mcp ui` prints `http://127.0.0.1:8080/#token=…`, the SPA moves it from the fragment into `sessionStorage`, then clears the fragment. Alternatively, set an `HttpOnly; SameSite=Strict` cookie on `GET /`, but only when `Host` is loopback.
  3. Reject any request whose `Host` is not `127.0.0.1:<port>`, `localhost:<port>` or `[::1]:<port>` (plus a configured allowlist). Reject any non-empty `Origin` that is not the same origin. The MCP Streamable-HTTP spec also *requires* Origin validation on `/mcp`.
  4. If a pairing-scoped token is kept, scope it to exactly `/api/qr`, `/api/pairing-code` and `/api/pair/resume`, as the comments promise. Flip the T54 tests to assert 401 on account data.

### C2. Stored XSS through a group subject or description leads to token theft and account takeover

- **Where:** `packages/web-ui/src/main.ts:539-543`:
  ```ts
  `<form id="group-meta-edit" data-meta-jid="${jid}"><input name="subject" … value="${meta?.subject ?? ""}" /><input name="description" … value="${meta?.description ?? ""}" />`
  ```
  None of the three values is escaped. Group subjects and descriptions come from third parties: any group admin, or the creator of any group that adds you.
- **Why it matters:** a subject such as `"><img src=x onerror=…>` executes in the UI origin when the owner clicks the group on `#/groups`. That script can read `localStorage`, which holds the saved daemon token (`state.ts`, used by `main.ts:37,40`), and can call the full API. There is no CSP to limit the damage (`http.ts:1496-1504` sends no security headers).
- **Fix:**
  - Use `escapeHtml` on all three values. Better, build the form with `document.createElement` and set `.value`.
  - Add `Content-Security-Policy: default-src 'self'; img-src 'self' data:; media-src 'self'; object-src 'none'; frame-ancestors 'none'` and `X-Content-Type-Options: nosniff` to static and media responses.
  - Add a lint guard that bans un-escaped `${…}` inside HTML template literals. M16 lists the other unescaped sinks.

### C3. Unhandled promise rejections crash the daemon, and one path is reachable with the public token

- **Where:** the request handler is `void readBodyWithCap(...).then(async …)` (`http.ts:1660`) with no `.catch`. Inside it:
  - `http.ts:1746`: `await socket.groupMetadata(jid)` rejects for an unknown or not-a-member JID. This is a `GET /api/*` route, so the **C1 public token can call it**: `GET /api/group/info?jid=1@g.us`.
  - `http.ts:1763`: `JSON.parse(body)` is unguarded on `/api/delete`, so an invalid JSON body throws.
  - `http.ts:1799`: `await socket.sendMessage(...)` on `/api/delete` is unguarded.
  - `lifecycle.ts:195`: the engine listeners are `async`. Any throw from `canonicalChatJid` or `storeMessage` becomes an unhandled rejection, for example `SQLITE_BUSY` while `scripts/merge-lid-chats.ts` runs.
  - `bridge/src/bin.ts:189`: `void main(cli)`.
  - There is no `process.on("unhandledRejection")` anywhere. Node 22 defaults to `--unhandled-rejections=throw`, which exits the process. I am stating this from Node semantics; I did not execute it.
  - `cli/src/bin.ts:131-139` starts the daemon `detached` with `stdio: "ignore"`, so the crash is **silent**.
- **Why it matters:**
  - Combined with C1, any web page or local process can take the bridge down with one GET.
  - A single bad DB write during ingest kills the daemon and loses live messages.
- **Fix:**
  - Wrap the dispatcher in `try/catch`, logging and returning 500.
  - Give every engine listener its own `try/catch` that logs.
  - Add a top-level `unhandledRejection` logger. It should log, not swallow.
  - Use a shared `parseJsonBody()` helper (see L2).
  - Have `wa-mcp start` redirect stdio to `<dataDir>/bridge.log`.

---

## High

### H1. `/api/pair/resume` starts a second socket while one is live, and the public token can call it

- **Where:** `lifecycle.ts:350-356`. `resumePairing()` always calls `connect()`, which calls `makeWASocket` (`lifecycle.ts:187`) without ending the current socket and without detaching its listeners. It is reachable with the C1 token (`http.ts:1633,1641,1814-1821`).
- **Why it matters:**
  - **Paired account:** two sockets share the same creds. WhatsApp replaces the connection (440) and both sockets reconnect, which causes a storm and duplicate ingest because the old listeners still write to the store.
  - **Unpaired account:** each call is a fresh registration and resets `pairingUsed` to 0. That is exactly the anti-abuse lockout the budget exists to prevent (AGENTS.md: "cooldown resets on every attempt").
- **Fix:**
  - Allow `resumePairing` only when `status === "pairing-blocked"`; return 409 otherwise.
  - `await socket.end()` and `socket.ev.removeAllListeners()` before every `connect()`. This also fixes L11.
  - Require the daemon token.

### H2. SSE `/events` streams `creds.update` and raw engine payloads

- **Where:** `events.ts:16,42` includes `"creds.update"` in `EVENT_NAMES`. `lifecycle.ts:328` emits every event, and `http.ts:1689-1691` writes `JSON.stringify(event.payload)` to every subscriber, including holders of the C1 token.
- **Why it matters:** `creds.update` partials carry credential material: `me`, `pairingCode`, `account` (signed device identity), `signalIdentities`, and rotated `advSecretKey` when the fork's `companion_reg_refresh` fires. None of that should leave the process.
- **Fix:** expose an explicit allowlist of event types on SSE, map payloads to a public DTO (ids, jids, text, timestamps), and never forward `creds.update`.

### H3. SSRF through media `url`, with a prompt-injection exfiltration path

- **Where:** `media/resolve.ts:164-188` calls `fetchFn(input.url)` with:
  - no scheme or host restriction
  - no timeout
  - no redirect limit
  - a body that is fully buffered by `arrayBuffer()` *before* the size check. The pre-check only trusts the `content-length` header (`resolve.ts:175-181`).
- **Why it matters:** this is an MCP server that reads untrusted WhatsApp text. A prompt-injected agent can call `send_media {url: "http://169.254.169.254/…" | "http://127.0.0.1:<other-service>/…"}`. The daemon fetches the internal resource and **sends the bytes to a WhatsApp chat**. A chunked response with no `content-length` can also exhaust memory.
- **Fix:**
  - Allow only `https:` (and `http:` behind an opt-in).
  - Resolve the hostname and reject loopback, link-local, RFC1918 and ULA addresses unless `WA_MEDIA_ALLOW_PRIVATE=1`.
  - Use an `AbortSignal.timeout(…)`.
  - Use `redirect: "manual"` or re-validate each hop.
  - Stream with a running byte cap.

### H4. Web-UI ↔ bridge contract drift: about ten UI actions always fail, and the client hides the failures

The `api.ts` client never checks `response.ok` (`web-ui/src/api.ts:71-74`), and call sites add `.catch(() => undefined)`. Every 4xx therefore looks like success.

| UI action | Client sends | Bridge expects | Result |
|---|---|---|---|
| set alias | `{chat_jid, alias}` (`api.ts:109`) | `jid` (`http.ts:981`) | always 400 |
| block / **unblock** | `{chat_jid, block:true}` (`api.ts:124`); the unblock button calls `block()` (`main.ts:598`) | `jid` (`http.ts:1225`) | 400. If the field is fixed, "unblock" would **block** |
| presence | `{chat_jid, state}` (`api.ts:123`) | `presence` (`http.ts:887`) | always 400 |
| privacy | `{privacy_key, value}` (`api.ts:125`) | `{readReceipts: "all", …}` (`profile.ts:77-83`) | always 400. The matrix "apply" button (`pages.ts:325`) is never bound |
| load privacy/profile | `GET /api/privacy`, `GET /api/profile` (`api.ts:117-118`) | the POST body parser (`http.ts:1887-1895` → `1146`) | 400 "body must be valid JSON". The matrix always shows "unknown" |
| search | `?query=` (`api.ts:95`) | `?q=` (`http.ts:382`) | always 400 |
| transcribe | reads `payload.transcript` (`main.ts:731`) | returns `text` (`http.ts:1406`) | always "(transcription unavailable)" |
| add participant | `{group_jid}` only (`api.ts:110`) | `jids`, `action` (`http.ts:1063-1070`) | always 400. Remove and promote are no-op handlers (`main.ts:563-568`) |
| reactions | `JSON.parse(row.reactions)` expecting `{emoji,count}` (`main.ts:466-478`) | already an array of `{emote}` (`queries.ts:81-99`) | reactions never render |
| group meta / create / leave, delete rule | UI (C1) token | not in `UI_TOKEN_POST` (`http.ts:1626-1635`) | 401 unless the daemon token is saved |

**Fix:** make `jsonCall` throw on `!response.ok` with the server's `error.code` and message. Add the contract test described in §4.1.

### H5. `bindRoute` is shadowed, so most chat-page interactions are never bound

- **Where:** `web-ui/src/main.ts:347`. `hash.startsWith("#/chat")` also matches `#/chats` and returns early. As a result:
  - `bindChatClicks` (`:351`) never runs for `#/chats`.
  - `bindChatsControls` (search and archived toggle, `:360-363`) is unreachable.
  - The second `#/chat` branch (`:364-372`) with `bindChatExtras` (reply, context, download, transcribe) and scroll-to-bottom is unreachable.
- **Latent bug:** `bindSendBox` implements reply by sending the literal text `> ${replyToId}\n${text}` (`main.ts:433`). Once the extras are bound, the **internal message ID would be sent to the real recipient**.
- **Fix:** use exact or regex route matching from `resolveRoute`, and send `reply_to_message_id` (the bridge already supports it, `http.ts:463-491`). Add a jsdom test that clicks each control.

### H6. Ingest silently drops any message type it does not recognize

- **Where:**
  - `extract.ts:339` returns `{text: null, mediaType: null}` for unknown content.
  - `store/messages.ts:126-136` then returns `false` ("protocol echo") and stores nothing.
  - The hand-rolled `unwrapLayers` (`extract.ts:46-78`) misses wrappers that the engine's own `normalizeMessageContent` handles: `editedMessage`, `associatedChildMessage`, `groupStatusMessage`, `groupStatusMessageV2` (fork `lib/Utils/messages.js:638-661`).
- **Why it matters:** video notes (`ptvMessage`), `eventMessage`, `interactiveResponseMessage`, `buttonsResponseMessage`, `listResponseMessage`, `templateButtonReplyMessage`, `groupInviteMessage`, `lottieStickerMessage` and any future type disappear with no log line. The fix for the empty-echo rows overcorrected.
- **Fix:**
  - Unwrap with `normalizeMessageContent`.
  - Classify with `getContentType`.
  - Skip only a denylist: `protocolMessage` types other than REVOKE and EDIT, `senderKeyDistributionMessage`, and `messageContextInfo`-only content.
  - Store everything else with `content = "[unsupported: <type>]"` and log the type once at `debug`.

### H7. Chat names are polluted by the sender's push name

- **Where:** `store/messages.ts:165-167`, where `UPSERT_CHAT` uses `senderNameOf(message, …)`, together with `COALESCE(chats.name, excluded.name)` (`:19`).
- **Why it matters:**
  - In a DM whose first stored message is **outgoing**, the chat is permanently named after the **owner's own** push name.
  - In a group, the chat takes the first sender's name until `groups.upsert` arrives. The live "group shows 'Vasilisa'" symptom matches this.
- **Fix:** never derive `chats.name` from a message when `fromMe` is set or the chat is a group. Take names from contacts or group metadata only, and treat incoming push names as a weak fallback at read time.

### H8. `setProfilePicture` always fails against the real engine (mock-blindness)

- **Where:** `bridge/src/profile.ts:64-65` reads `socket.user.jid`. The engine's `Contact` type has `id` and no `jid` (fork `lib/Types/Contact.d.ts:1-3`). The test mocks the non-existent field: `tests/profile.test.ts:29` uses `user: { jid: "358…" }`.
- **Fix:** `jidNormalizedUser(socket.user?.id)`. Type the mocks as `Pick<WASocket, …>` instead of `as unknown as WASocket` so this kind of drift fails at compile time (§4.3).

### H9. Advertised features are inert: notification rules are never evaluated and contacts are never ingested

- **Where:**
  - `notifications.ts:93`: `evaluateRules` has **no caller** in `src/`. Rules can be created, listed and deleted (`http.ts:953-975, 1913-1948`; MCP tools `tools.ts:569-631`), but nothing ever fires.
  - `store/contacts.ts:42`: `upsertContact` has no caller in `src/`. `contacts.upsert` is subscribed (`events.ts:37`), but `lifecycle.ts` never persists it. `/api/contacts`, the contacts page and `list_contacts` return only rows created by tests.
- **Fix:** wire both (an SSE `notification` event or an OS hook, and `contacts.upsert`/`contacts.update` → `upsertContact`), or remove them from the tool surface and from GOAL before claiming 0.1.0.

### H10. The send guard can be bypassed by concurrent requests and by TTS

- **Where:** `send/safety.ts:56-72` and `http.ts:711, 748`. `check()` runs before the send and `record()` runs after the network round-trip completes. N parallel `/api/send` calls all pass both the 1-second interval and the daily cap. `/api/tts` sends through `sendViaSocket` (`http.ts:1457`) without consulting the guard at all.
- **Why it matters:** the guard exists to protect the account from WhatsApp anti-spam bans, and an agent loop can trivially exceed it.
- **Fix:** reserve a slot at `check()`, which sets `lastSendAt` and increments the count, then refund it on failure. Route TTS (and `/api/delete` if desired) through the same guard.

### H11. LID/PN canonicalization only covers `key.remoteJid`

- **Where:**
  - `lifecycle.ts:252-254` rewrites `remoteJid` only. In groups, `key.participant` is often a `@lid`, so `sender_jid` splits per person, and `fromJid` notification rules and `listMessages({sender})` miss.
  - The engine already supplies `key.remoteJidAlt` and `key.participantAlt` (fork `lib/Utils/decode-wa-message.js:180,187`), and they are ignored. Using them avoids the async lookup and covers history sync.
  - `send.ts:167` stores outbound rows under the JID *as given*. A caller passing `…@lid` creates a LID chat row, because `resolveRecipient` (`send.ts:104-107`) never canonicalizes a valid JID.
  - `/api/delete` skips `resolveRecipient` entirely (`http.ts:1767-1788`), so an alias or LID JID gives a 404.
  - Reaction keys hardcode `fromMe: false` and omit `participant` (`http.ts:508`). Reacting to one's own message, or to a group message, builds the wrong key. **Verify live:** the reaction key's `remoteJid` is the PN JID while the wire target is the LID JID (`send.ts:147`).
- **Fix:** one `canonicalize(key)` helper used by ingest, send-echo and every route. It should prefer `*Alt` fields, then `lidMapping`. For reactions, look up `is_from_me` and `sender_jid` from the store, as `/api/delete` already does.

---

## Medium

### M1. Edits and revokes are applied without checking who sent them

`store/messages.ts:104-116` overwrites or tombstones the target purely by `(chat_jid, id)`. A participant could send a crafted `protocolMessage` and rewrite someone else's message in the store, which is what the LLM then reads. **Fix:** require `sender_jid` to match the target's sender, or the sender to be a group admin for REVOKE.

### M2. The reaction model is lossy

`messages.ts:86-94` dedups on "last emote equals this emote", so two people reacting 👍 store one reaction. A removal (empty `text`) is appended as an empty-string emote, and a 👍→❤️ change keeps both. **Fix:** key reactions by sender, `{[sender_jid]: emote}`, and delete the entry on empty text.

### M3. Polls are half-implemented

- Votes are dropped (`messages.ts:121-125`), and the `poll_votes` table is never written.
- The default `selectableCount = options.length - 1` (`http.ts:676`) is surprising: 2 options become single-choice and 1 option becomes 0 (unlimited).
- There is no validation of option count (WhatsApp caps it at 12), duplicate options, or `selectable_count` range.
- `extract.ts:228-230` filters out empty labels, which shifts indices relative to the wire.

### M4. Message-ID lookups ignore `chat_jid`, even though the primary key is `(chat_jid, id)`

- See `schema.ts:40`, and lookups at `queries.ts:334-336`, `http.ts:1266, 1300, 1383`, and `http.ts:373` (the context route resolves `chat_jid` and then drops it).
- `saveOutboundMedia` runs `UPDATE … WHERE id = ?` (`media/resolve.ts:213`), which touches every chat with that ID.
- Duplicate IDs do occur across LID and PN rows before a merge.
- **Fix:** thread `chatJid` through every lookup and update.

### M5. Read receipts and empty ID lists

- `presence.ts:18` builds keys without `participant` or `fromMe`, so group read receipts are wrong.
- `markMessagesRead(store, jid, [])` produces `IN ()`, which is an SQL syntax error (`store/chats.ts:34-37`). It surfaces as a 500 after the receipt was already sent.

### M6. Rate limiting starves the agent

- `http.ts:109, 1513`: a single bucket of 60/min per IP covers static assets, SSE reconnects, UI polling (every 3-5 s, plus a `/health` fetch on *every* render at `main.ts:237`) and MCP-over-HTTP.
- `/mcp` loops back over HTTP to itself (`http.ts:790-796`), so each tool call costs at least 2 tokens, and `mark_chat_read` costs 3.
- The `buckets` map is never evicted (`http.ts:149`).
- **Fix:** dispatch MCP tools in-process (call the route handlers directly), exempt static assets, use separate buckets per credential, and evict idle buckets.

### M7. Media response hardening

- `http.ts:1277` sends a sniffed `content-type` with no `nosniff`, no `Content-Disposition`, and no CSP.
- `http.ts:1622` accepts `?token=` for media and SSE. Combined with `main.ts:329` (`effectiveToken` prefers the *saved daemon token*), the long-lived token ends up in every `<img src>`.
- `GET /api/media/:id` reads whatever `media_path` the DB holds, with no containment re-check (`http.ts:1266-1279`).
- **Fix:** short-lived HMAC-signed media URLs, `nosniff`, `Content-Disposition: inline; filename=…`, and a `realpath` containment check on read.

### M8. `updatePrivacy` applies a patch partially

`profile.ts:77-91` applies key by key and throws on the first invalid key, leaving earlier keys applied. **Fix:** validate the whole patch first, then apply.

### M9. `/api/group/meta` does not type-check `description`

`http.ts:1099-1102` casts it with `as string`. The UI always sends both fields (`main.ts:741-744`), so saving a subject wipes the description, and an empty subject is sent to the engine.

### M10. Shutdown skips cleanup

`server.close()` waits for open SSE responses, which never end (`http.ts:2020-2023`). The 3-second race in `shutdown.ts:40-46` then exits *without* `store.close()` or `lock.release()`. **Fix:** track SSE responses and end them, or call `server.closeAllConnections()`.

### M11. Daemon boot path

- `bin.ts:125-134`: when the cloud config is invalid, `main` returns *after* `startBridge` and `acquireLock`. That leaves a zombie socket and a held lock.
- `--port` is not validated (`bin.ts:94-96`).
- `void openAuthStore(authDir)` (`bin.ts:115`) is called only for its chmod side effect (see L1).

### M12. CLI installer risks

- The token is placed in argv (`cli/src/bin.ts:36`, `--token <token>`), where `ps` shows it to every local user. `env.WA_TOKEN` alone is enough.
- `readJson` swallows parse errors and returns `{}` (`writers.ts:27-37`). The writer then **overwrites the user's existing config**, deleting every other MCP server whenever the file is JSONC or otherwise unparsable (`writers.ts:54-58`).
- `mode: 0o600` only applies when a file is created, so existing 0644 configs end up holding the token world-readable.
- TOML and YAML values are interpolated without escaping (`writers.ts:80-81, 111`), which breaks on Windows paths and on quotes.
- `install` accepts an empty token and still reports "verified" (`cli/src/bin.ts:33`).
- `stop` sends SIGTERM to the PID in a possibly stale lock file (`cli/src/bin.ts:150-152`).
- `pair` ignores `--data-dir` (`:61`).

### M13. JID validation

`shared/src/jid.ts:66-77` rejects legacy group JIDs of the form `<creator>-<ts>@g.us`, so those groups cannot be messaged. It also accepts any domain (`123@evil.com` passes). **Fix:** use an explicit server allowlist (`s.whatsapp.net`, `g.us`, `lid`, `broadcast`, `newsletter`) and allow `\d+-\d+` for `g.us`.

### M14. MCP protocol conformance

- Tool failures become JSON-RPC `-32603` errors (`mcp-server/src/server.ts:201-215`). The spec says to return `result: {content, isError: true}` so that the model can see the error and recover.
- `/mcp` answers notifications with `200 {}` instead of `202` (`http.ts:797-800`).
- The server always returns `PROTOCOL_VERSION` without negotiating (`server.ts:163-166`).
- `get_message_context` cannot pass `chat_jid` (`tools.ts:184-195`).
- `get_chat` only scans the first 200 non-archived chats (`tools.ts:252-258`).

### M15. `mergeLidChats` leaves dependent rows behind

`store/merge-lid-chats.ts:49-131` moves messages, chats and read_state, but not `poll_options`, `transcripts`, `aliases` that point at the LID JID, or `group_participants`. Duplicate LID rows that carry newer edits or reactions are deleted, not merged (`:62-65, 128`).

### M16. Remaining unescaped HTML sinks in the web UI (escape-everything rule)

- `pages.ts:228` (`unreadHtml`: `chatJid` ×2)
- `pages.ts:235` (`settingsHtml`: `bridgeUrl`, `token` in `value=""`)
- `pages.ts:249` (`healthHtml`)
- `main.ts:125` (`l.type` in the events feed)
- `main.ts:252` (`err.message`)

Each is lower-trust than C2, but together they show the rule is not enforced.

### M17. Body cap versus media cap

`MAX_BODY_BYTES = 1_000_000` (`http.ts:107`), but base64 media allows 20 MB (`resolve.ts:38`). Any base64 attachment over ~750 KB gets a 413 before validation. Either document that limit or raise the cap for `/api/send` only.

### M18. No secondary indexes

`schema.ts` defines no secondary indexes. `listChats` runs two correlated subqueries per chat with `ORDER BY timestamp` (`queries.ts:128-137`), and unread counts scan `messages`. After a full history sync this becomes slow. **Fix:** add `messages(chat_jid, timestamp)` and `messages(chat_jid, is_unread)`.

---

## Low

### L1. Dead code to delete or wire up before release

| Location | What it is |
|---|---|
| `bridge/src/auth.ts` (whole file) | Unused. `lifecycle.ts:86` uses `useMultiFileAuthState` |
| `groups.ts:91-107` | `revokeGroupInvite`, `joinGroupByInvite`, `fetchAllGroups` |
| `presence.ts:30-32` | `sendTyping` |
| `store/chats.ts:23-55` | `markChatRead`, `markAllRead` |
| `channels/baileys/adapter.ts` | Never constructed |
| `web-ui/src/pages.ts:238-251` | `pairingHtml`, `qrHtml`, `healthHtml`, superseded by `pages-pairing.ts` |
| `main.ts:360-372` | Unreachable branches (H5) |
| `main.ts:563-568` | No-op handlers |
| `main.ts:743` | `await client;` |
| `http.ts:110-117, 2000-2003` | `API_PATHS` fallback, now only reachable for `/api/download` |
| `schema.ts` | Unused tables `scheduled`, `templates`, `autoreply_rules`, `media_files`, `events`, `poll_votes`; unused columns `read_state.manually_unread`, `chats.ephemeral*`, `chats.pinned` and `muted_until` (written but never surfaced by `listChats`) |

### L2. `http.ts` is a 2,025-line module

`serveSend` alone is about 370 lines. The JSON-parse and object-check block is duplicated 8 times (`:405-415, 779-789, 818-827, 1006-1016, 1144-1154, 1353-1359, 1425-1431, 1840-1846`), and the `MediaError`→status mapping is duplicated (`:757-767`, `:1321-1328`). **Suggestion:** a route table `{method, path, scope, handler}` (which also makes C1 scoping explicit and testable), one `parseJsonBody`, one `mediaErrorStatus`, and per-domain modules.

### L3. Type-safety escapes

- `as never` (`http.ts:1600`)
- `as unknown as AnyMessageContent` (`:648`)
- `opts.store!` (`:486`)
- `opts.store as Store` (`:966`), which crashes when no store is attached
- duplicated `socket as unknown as {signalRepository…}` (`send.ts:37-43, 71-77`)
- `as unknown as WASocket` throughout the tests

### L4. The version is hardcoded in three places

`bridge/src/bin.ts:154`, `lifecycle.ts:191`, and `mcp-server/src/server.ts:84`. Read it from `package.json` at build time instead.

### L5. Lock check-then-write race

`lock.ts:41-50` checks and then writes. Use `writeFileSync(…, {flag: "wx"})`.

### L6. `qr.png` permissions

`qr.png` is written with the default umask (`qr.ts:23-25`). The data dir is 0700, so this is minor, but chmod it to 0600.

### L7. Webhook handling

The `verify_token` comparison is not constant-time (`webhooks.ts:14`). A JSON parse error after a valid signature is reported as "signature validation failed" (`http.ts:1571-1582`).

### L8. Errors swallowed without logging (each should at least `logger.warn({err})`)

| Location | What is swallowed |
|---|---|
| `http.ts:296` | QR `readFile` |
| `http.ts:1280` | media `readFile` |
| `http.ts:881, 903, 1036, 1175, 1718, 1908` | generic 500s with no log |
| `send.ts:120` | alias scan |
| `queries.ts:288` | FTS failure falls back to LIKE silently |
| `media/download.ts:48-53` | every download or decrypt error becomes `EMPTY` and then a 404 "no downloadable media", which hides expired URLs and network faults |
| `lock.ts:58` | lock release |
| `writers.ts:34` | config parse (M12) |

### L9. Self-URL breaks on IPv6

`serveMcp` builds its self-URL from `opts.host` (`http.ts:790`), which breaks for IPv6 binds (`::`).

### L10. Bearer parsing

`presentedBearer` uses `split(" ")` (`http.ts:137`), which rejects valid headers that contain repeated whitespace.

### L11. Stale listeners on reconnect

On reconnect the old socket's listeners are never removed (`lifecycle.ts:187-195`), so a late event from a dead socket can still flip `status` or ingest. This is fixed together with H1.

### L12. Sequential LID lookups in history sync

History sync resolves LIDs with sequential `await`s (`lifecycle.ts:270-280`). Bounded concurrency would help on large accounts.

### L13. The reconnect delay has no jitter

`lifecycle.ts:161`.

---

## 4. Test gaps: where mocks are blind and what would catch more

Confirmed mock-blindness found in this review:
- H8: `user.jid` exists only in the mock.
- H4: about ten client↔server mismatches, invisible because `web-ui/tests/api.test.ts` mocks `fetch` and `bridge/tests/http.test.ts` never runs the real client.
- C1: the tests *assert* the insecure scope.

Highest-leverage additions, in order:

1. **Client↔server contract suite (catches H4, M14 and similar drift).**
   - Start a real `createHttpServer` with an in-memory store and a typed fake socket.
   - Drive **every** `createApiClient` method and **every** `TOOLS[*].handler` against it.
   - Assert a 2xx response and the response shape.
   - Generate the list from `Object.keys(client)` and `TOOLS` so that a new method without a contract test fails CI.
2. **Engine-fixture golden tests (catches H6, H11, M2, M3).** Capture real protos once from the fork, either by `proto.WebMessageInfo.encode` of live upserts (redacted) or by building them with the engine's own `generateWAMessageFromContent`. Commit them as base64 fixtures and run them through `extractContent` → `storeMessage` → `listMessages`. Include:
   - `ptvMessage`, `editedMessage`-wrapped edits, `associatedChildMessage`
   - group messages with an `@lid` participant and `participantAlt`
   - a reaction removal
   - a poll V3 plus a vote
   - a REVOKE from a non-sender
3. **Typed mocks (catches H8 and its class).** Replace `as unknown as WASocket` with `const sock = {…} satisfies Partial<WASocket>` (or a `Pick<>`), so a non-existent field like `user.jid` fails `tsc`.
4. **Robustness fuzz (catches C3).** For every route, send no body, invalid JSON, `[]`, the wrong method, and a rejecting socket method. After each request, assert that `/health` still answers.
5. **Security regression tests (C1, C2, M7):**
   - `/health` contains no credential.
   - A rebinding-style `Host: evil.example:8080` gets 403.
   - `Origin: https://evil.example` on `/mcp` gets 403.
   - Rendering `groupsPage` and the meta form under jsdom with the subject `"><img src=x onerror=alert(1)>` produces no `img` element.
   - Media responses carry `nosniff`.
6. **Concurrency tests:** fire 10 parallel `/api/send` calls and expect exactly one to pass with the default 1-second interval (H10). Call `resumePairing()` while connected and expect `makeWASocket` to be called exactly once (H1).
7. **Live E2E (nightly, gated):** the existing `scripts/webui-e2e.mjs` and dogfood scripts are the right direction. Add a second test account (or the Cloud API test number) and cover the round trip: send, receive, react, edit, revoke, poll vote, and media download after a daemon restart. Run it nightly, not per-PR.

## 5. Cleanup before claiming 0.1.0

1. Fix C1–C3 and H1–H3 (security and stability). Flip the T54 tests in `http.test.ts:2092-2136`.
2. Fix the H4/H5 UI wiring, or hide the broken controls. Make `api.ts` throw on non-2xx.
3. Either wire notification rules and contacts ingest (H9) or remove them from the tool list and README.
4. Delete the L1 dead code and unused tables. Unused tables need a migration that drops them, or a documented decision to keep them.
5. Correct the misleading comments at `http.ts:85-87` and `bin.ts:143-144`.
6. Single-source the version (L4).
7. Add the §4.1 contract suite and the §4.4 fuzz tests to CI before any further GOAL boxes are ticked on security or UI items.
