# Plan: write review/INDEPENDENT-REVIEW2-RUNTIME.md

## Context
Review 2 of 3 (runtime + security, stricter re-pass of the 2026-10-03 review). The user wants the
review document written to `review/INDEPENDENT-REVIEW2-RUNTIME.md`. Plan mode blocked writing it
during the session, so the review was done read-only (code reads + GET/tools-list probes against the
live daemon; nothing sent; pairing untouched). The full document body is below. The only step left
is to write it verbatim to that path. No code changes. No commit unless the user asks for one.

## Step
1. Write the content between the markers below to `review/INDEPENDENT-REVIEW2-RUNTIME.md`.

## Verification
- `test -f review/INDEPENDENT-REVIEW2-RUNTIME.md`. `git status` should show only that new file plus
  the pre-existing working-tree changes.

---- BEGIN review/INDEPENDENT-REVIEW2-RUNTIME.md ----

# Independent Review 2 — RUNTIME correctness + security (wa-mcp 0.1.0)

- Reviewer: independent, read-only (Claude). Date: 2026-10-04.
- Tree: HEAD `1a35022` plus the working-tree diff (poll-votes/messages). HEAD moved to `0683aef` during the review.
- Live daemon: pid 19651, **started 19:07:48**. That is before the T94-D commits (a41fd3e scheduler gate, 1a35022 get_group_info).
  Live `tools/list` returns 62 tools and **no `get_group_info`**, so the live build is stale versus HEAD.
  Live probes therefore show the 19:07 build. Every code finding cites HEAD.
- Probe rules: only GET routes and `tools/list` were called. Tokens were read from file and never printed. No sends, no pairing calls.

## Verdict: **DO-NOT-SHIP** until CR1, H1 and H2 are fixed. After that, SHIP-WITH-FIXES.

## Status of earlier findings

| Prior | Claim | Code evidence | Live evidence | Status |
|---|---|---|---|---|
| C1 | pairing token scoped to pairing surface | http.ts:2254-2265 (`PAIRING_SURFACE.has(path)`) | pairing token → `/api/chats` **401**, `/mcp` **401**, `?token=` on `/events` and `/api/media/x` **401** | The direct use is fixed. **The token can still be escalated: see CR1.** |
| C1 | account token on /api/qr must 401 | the account token is a superset by design (http.ts:2259) | account token → `/api/qr` **404** (NO_QR, so it passed auth) | The expectation in the brief does not match the design. INFO only. |
| C2 | /api/qr allowlist + realpath | http.ts:446-466: only `file=qr.png` is accepted, then realpath of the dir and file, then a `startsWith(realDir+sep)` check | — | **Fixed** |
| H2 | creds.update never streams | events.ts:53-68 whitelist; http.ts:2307 `isSafePublicEvent` | 20 s SSE sample: 1 event (`connection.update`), **0** matches for creds/advSecretKey/noiseKey/signedIdentityKey. creds.update cannot be forced read-only. | **Fixed** (code-verified) |
| H3 | SSRF guard: resolved IPs + redirects | resolve.ts:105-149 checks before fetch; resolve.ts:284-313 uses `redirect:"manual"` and re-checks every hop | in-process run of `assertPublicHttpUrl` | Redirect handling is fixed. **The address check can be bypassed: see H1.** |
| T93-E | double body read | there are only 2 `readBodyWithCap` call sites (2186 webhook, 2274 dispatcher). send-rules reuses the dispatched `body` (3032-3036). | — | **Fixed** |
| T93 | leftover `DEBUG H1:` console.error | `grep DEBUG bridge/src` finds nothing | — | **Fixed** |

---

## CRITICAL

### CR1 — Anyone without a token can reach the full account: `/health` → pairingToken → `/api/ui-token` → uiToken
- http.ts:2156 has `/health`, which needs no auth and returns `pairingToken`.
- http.ts:162-167 puts `/api/ui-token` in `PAIRING_SURFACE`, so the pairing token unlocks it.
- http.ts:3464-3469 returns `uiToken`.
- http.ts:2259 accepts `uiToken` on **every** route (`!tokenMatches(presented, opts.token) && !tokenMatches(presented, uiToken)`).
- **Live proof** (read-only GETs only): `curl /health` gives a pairingToken (48 chars). `GET /api/ui-token` with that bearer returns **200** and a 48-char token. With the uiToken:
  - `/api/chats` **200**
  - `/api/messages` **200**
  - `/api/contacts` **200**
  - `/mcp tools/list` **200**
  - `/events?token=` **200**
- The Host/Origin guard does block browsers: evil Host → 403, cross-site Origin → 403, `localhost.evil.com` → 403. Nothing blocks a local process, which sets `Host: 127.0.0.1` on its own.
- Impact: the 0600 token file (`~/.wa-mcp/token`) protects nothing. Any local process or user, any sandboxed tool with loopback access, or any other MCP server on the machine can read every message and contact. It can also send messages (all 62 tools: send_message, delete, logout, group admin) without reading the token file. ADR 0012 promises the pairing token "never authorizes account data", and this chain breaks that promise.
- Fix direction (not applied):
  - Do not hand the full-surface token to whoever holds the public pairing token. Options: serve uiToken only to the same-origin UI document (for example, inline it into the served `index.html`, which needs no bearer), or require `Sec-Fetch-Site: same-origin` together with an Origin that is present and loopback.
  - At minimum, remove `/api/ui-token` from `PAIRING_SURFACE`.

## HIGH

### H1 — SSRF guard can be bypassed with IPv4-mapped, NAT64 and 6to4 IPv6 addresses
- resolve.ts:52-82 `isBlockedAddress`. A v6 value containing a dot (DNS result `::ffff:127.0.0.1`) goes down the v4 branch. `"::ffff:127".split(".")` then produces NaN, and the function **returns false (allowed)**. A v6 literal (`[::ffff:127.0.0.1]`, which URL normalizes to `::ffff:7f00:1`) only checks `::1`, `::`, `fc00::/7` and `fe80::/10`.
- **In-process proof** (ran `assertPublicHttpUrl` with a stubbed lookup, no network):
  ```
  ALLOWED  http://[::ffff:127.0.0.1]:8080/health
  ALLOWED  http://[::ffff:169.254.169.254]/
  ALLOWED  http://[64:ff9b::7f00:1]/
  ALLOWED  http://[2002:7f00:1::]/
  ALLOWED  http://mapped.example/   (AAAA ::ffff:127.0.0.1)
  ALLOWED  http://mapped2.example/  (AAAA ::ffff:10.0.0.1)
  ALLOWED  http://224.0.0.1/
  blocked  http://127.0.0.1/ , 127.1 , 0x7f.1 , 2130706433
  ```
- Also, the guard resolves DNS, but `fetch` (resolve.ts:288) resolves again on its own. A rebinding name with TTL 0 can pass the check and then connect to 127.0.0.1.
- Impact: send_message with `media.url` (which can be driven by prompt injection from inbound chat text) fetches loopback or LAN or metadata endpoints and **sends the response bytes over WhatsApp**. The scheduler path (bin.ts:129) has the same problem.
- Fix direction:
  - Unmap `::ffff:0:0/96`, `64:ff9b::/96` and `2002::/16` to their embedded v4 address and re-check it.
  - Treat any v6 string containing a dot as embedded v4.
  - Pin the connection to the validated address with a custom undici `connect.lookup`.

### H2 — Send budget can be bypassed (check-then-record race, and batch forward)
- safety.ts:56-72. `check()` reserves nothing. `record()` runs only **after** the async send completes (http.ts:1202, 1242, 2843; bin.ts:140).
  - N concurrent `POST /api/send` requests all pass `check()` before any of them records, which defeats the 1 s minimum interval.
  - At cap − 1, a burst overshoots the daily cap.
  - Media-by-URL sends make the gap seconds wide, because the builder runs `resolveMedia` (network fetch) before the send.
- Batch forward (http.ts:880-929) checks `sendPolicyRefusal` **once** and then loops over every id with no per-message re-check. `ids` has no length limit: a 1 MB body holds about 30k ids. This exceeds both the interval and the daily cap. Also, if send #k fails, the client gets a 4xx/5xx but sends 1..k already went out (no partial report).
- Impact: one agent mistake or one injected instruction can exceed the anti-ban budget. This is the main account-loss risk the guard exists to prevent.
- Fix direction: make `check()` reserve the slot atomically (set lastSendAt and the provisional count at check time, refund on failure). Run `check()` for each forward id. Cap the size of `ids`.

### H3 — `/api/pair/resume` accepts the public pairing token, has no state check, ignores logout, and stacks sockets
- http.ts:162-167 (in `PAIRING_SURFACE`), http.ts:2896-2903, lifecycle.ts:826-841.
- `resumePairing()` runs no matter what `status` is:
  - It ends a **healthy, paired** socket and reconnects.
  - It ignores `closed`, so it reconnects a session the user logged out of.
  - It sets `pairingUsed = 0`, which resets the anti-abuse pairing budget.
  - It does **not** clear `reconnectTimer` or `reconnectPending`. If a backoff reconnect is pending, the timer later calls `connect()` again, which puts two sockets on the same creds (440 conflict churn). This breaks the T76 single-flight rule the comment claims to follow.
- Anyone holding the public pairing token can call it, up to 120 times a minute (it uses the health bucket). Result: forced reconnect storms on a live account, and the pairing budget can be reset forever. That budget exists because "WhatsApp's anti-abuse cooldown resets on every attempt" (AGENTS.md).
- Not probed live: it is a POST pairing route, so the brief forbids it. The evidence is code only.
- Fix direction: refuse unless `status === "pairing-blocked"` and there is no `creds.account`. Honour `closed`. Clear `reconnectTimer`. Optionally require the account token.

## MEDIUM

### M1 — Lookups by message id alone mix up chats (the primary key is `(chat_jid, id)`, and senders choose the id)
- schema.ts:40 sets `PRIMARY KEY (chat_jid, id)`. These lookups ignore `chat_jid`:
  - lifecycle.ts:380 `getMessage` uses `WHERE id = ?`. The fork's retry resend (`messages-recv.js:1061` `sendMessagesAgain`) calls `getMessage({...key, id})` and **re-sends the result to the participant who asked for the retry**. A peer who knows a message id can get content from a *different* chat replayed to them.
  - lifecycle.ts:579 looks up the poll creation by id alone. A colliding poll in another chat breaks vote decryption.
  - lifecycle.ts:153, http.ts:2407 and resolve.ts:358 run `UPDATE messages SET media_path … WHERE id = ?`, which updates **every** chat's row with that id. The file path `${mediaDir}/${id}.${ext}` (resolve.ts:353) also collides, so attacker media overwrites or replaces the victim's file.
  - http.ts:1774, 1891, 2340 and 2394 select media_path by id alone.
  - queries.ts:101 and 139-144 (reactions and polls `IN (ids)`) do not scope by chat.
- Fix direction: scope every id lookup by `chat_jid` (and `key.remoteJid` in getMessage). Name media files `${sha(chat_jid)}_${id}`.

### M2 — Per-IP rate limiting does nothing on a loopback daemon; /health and pairing get starved
- http.ts:2106 keys every bucket by `remoteAddress`, and every client is `127.0.0.1`. So the "per-IP" 60/min API bucket is really one bucket shared by every agent and CLI. The health bucket (120/min) is shared by every UI tab and the pairing page.
- **Live:** with 6 established Chrome connections, `GET /health` returned **429 RATE_LIMITED** to this reviewer several times in a row (cleared after about 20 s). The pairing-surface calls also got 429. During pairing, the QR page would stall the same way.
- `/events` has no bucket and no connection cap (http.ts:2121-2122), so authenticated clients can open unlimited SSE subscriptions.
- The bucket `Map`s are never evicted (http.ts:245). That is minor on loopback.

### M3 — Scheduler marks recoverable sends as permanently failed
- scheduled.ts:42-52 together with bin.ts:115. When two rows are due in the same 30 s tick, row 2 hits the 1 s `RATE_LIMITED` right after row 1 and is marked `failed` for good. "bridge not connected" during a reconnect (bin.ts:101) is also permanent. Nothing retries.
- Fix direction: leave the row `pending` on transient errors (RATE_LIMITED, not connected) and only fail it on rule or validation refusals.

### M4 — An unhandled rejection crashes the daemon (no handler at process level)
- No `unhandledRejection` handler exists anywhere (grep of bridge, cli and mcp-server). Node 22 defaults to `--unhandled-rejections=throw`.
- http.ts:2283 calls `void serveSend(req, res, body)` with **no `.catch`**, even though serveSend is async (http.ts:604). Any synchronous throw after the first await kills the process: a store error in `resolveRecipient` or alias lookup, or a `sendGuard.check` DB error.
- bin.ts runs `void processDue(...).finally(...)`. A throw from `dueScheduled` or `markScheduled` (for example SQLITE_BUSY) becomes an unhandled rejection.
- The other void chains reviewed do have catches (2230, 2361, 2411, 3061, 3458, 3499).

### M5 — Logout does not survive a restart
- lifecycle.ts:891 sets `creds.waMcpLoggedOut = true`. Nothing persists it (`queueSave` is never called), and nothing reads it on startup or in `connect()`. After a daemon restart, or after H3's resume, the "logged-out" account reconnects.

### M6 — Fetching media by URL has no timeout and no streaming byte cap
- resolve.ts:288 calls `fetchFn(target, {redirect:"manual"})` with no `signal` or timeout. Line 324 runs `arrayBuffer()` and only then checks the size. A chunked response with no content-length is buffered in full (memory) before the 20 MB check. A slow-drip server holds the request open indefinitely. The MCP side times out (H5claude), but the bridge fetch keeps running.

## LOW / INFO

- **L1** Pagination meta is off at the boundary. `listMessages` uses `timestamp > ?` for `after` (queries.ts:~314), but `countMessages` uses `timestamp >= ?` (queries.ts:~538). `total` then counts boundary messages the page never returns, so `truncated` and `nextOffset` are wrong. Code only.
- **L2** `catch_up` and `digest` do not validate `since`, which is compared as a string. **Live:** `since=zzz` → 200 with an empty result. `catch_up` `questions` has no length limit (http.ts:2651-2676, unlike digest's `slice(0,10)`). `fetch_history` `count` has no bound (http.ts:2540).
- **L3** Malformed JSON on most POST routes (delete, fetch-history, groups/*, newsletters/*, calls/reject, mark-unread, send-rules) calls `JSON.parse` without a guard. The dispatcher catch turns that into **500 INTERNAL** where it should be 400 VALIDATION_ERROR.
- **L4** Tokens end up in URLs and argv:
  - `?token=` on `/events` and `/api/media` (web-ui events-feed.ts:61, pages.ts:152) puts the uiToken in URLs.
  - The UI keeps it in `localStorage` (main.ts:855).
  - The installer writes `"--token", token` into MCP client args (cli/src/bin.ts:37) **and** `WA_TOKEN` env. argv is world-readable through `ps`, and client config files store it in plain text. Env alone would do.
- **L5** `serveMcp` echoes `String(err)` (http.ts:1313). `/api/pairing-code` echoes the engine `err.message` (2946). Engine internals leak to the client. No token appeared in any error path reviewed.
- **L6** The SSRF blocklist also misses 224.0.0.0/4, 240.0.0.0/4, 255.255.255.255 and 198.18.0.0/15.
- **L7** The staleness watchdog `connect()` (lifecycle.ts:432) does not clear a pending `reconnectTimer`. With a small `WA_STALENESS_MS` the watchdog and backoff can both connect, giving two sockets. With the default 30 s the window cannot be reached (4 ticks > 60 s max backoff).
- **L8** `WA_ALLOWED_EXTENSIONS` filters on the **sender-declared** `fileName` (lifecycle.ts:178-184, autodl.ts:41-49), while the stored extension is sniffed. A sender can choose a name that passes the filter. Path traversal is **not** possible: the on-disk name is `SAFE_ID` id plus a MIME-table extension (download.ts:28, resolve.ts:352-353). Remote `fileName` never reaches the filesystem.
- **INFO** SQL injection: none found. Every dynamic `WHERE` is built from constant fragments with bound parameters (queries.ts:300-326, 530-546; export.ts:15-28; chats.ts:36; FTS input sanitized at queries.ts:~400 with a LIKE fallback).
- **INFO** Media files are written 0644 inside a 0700 directory (resolve.ts:350-355). That is acceptable. 0600 would be stricter.

## Probe log (read-only)
| Probe | Result |
|---|---|
| GET /health (no auth) | 200 with pairingToken. **429** several times while 6 UI connections were open |
| pairing token → /api/chats, POST /mcp | 401, 401 |
| pairing token → GET /api/ui-token | **200 {token}** |
| uiToken → /api/chats, /api/messages, /api/contacts, /mcp tools/list, /events?token= | **200 ×5** |
| ui-token with Host evil.example / Origin evil.example / Host localhost.evil.com | 403 / 403 / 403 |
| account token → /api/qr | 404 NO_QR (authorized) |
| SSE /events 20 s | `connection.update` ×1. Credential keys ×0 |
| tools/list | 62 tools. catch_up, digest_group, fetch_history, restrict_sending present. get_group_info **absent** (stale build) |
| /api/catch-up?since=zzz | 200 (not validated) |
| /api/messages?limit=1&after=… | meta `{truncated:true,total:25,returned:1,nextOffset:1}` |
| assertPublicHttpUrl in-process | see H1 |

## Fix priority
1. CR1: take `/api/ui-token` off the pairing token.
2. H1: unmap embedded-v4 addresses and pin the connect address.
3. H2: reserve atomically in SendGuard; per-id checks in batch forward; cap `ids`.
4. H3: state-gate `resumePairing`, honour `closed`, clear the timer.
5. M4: add `.catch` to serveSend and processDue, plus a process-level handler that logs.
6. M1: scope id lookups and media filenames by chat.
7. M2, M3, M5, M6, then the Lows.

---- END ----
