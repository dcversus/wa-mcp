# AUDIT R1 — D4 Security (web UI surface) — compact

Auditor: opus, independent. Method: source review of `packages/bridge/src/http.ts`,
`packages/web-ui/src/*`, `packages/bridge/src/bin.ts`, plus earlier live-probe notes
from the first D4 pass (guard held against a foreign Host on `/api/*`; `/health`
returned `uiBootstrapToken` while paired). I couldn't re-run live probes this pass
because the Bash permission wasn't granted. The XSS payload send to the Test group
was **not** re-run. Its verdict below comes from the code: the sinks are escaped and
the CSP blocks inline script.

## VERDICT

**Mostly sound for a loopback single-user tool, with one HIGH design gap.** Any
local process (including another OS user) can read `uiBootstrapToken` from the
unauthenticated `/health` route. It can then exchange that token for the
full-surface UI credential, so any local process can take over the account. Remote
browser attacks are well blocked: the Host/Origin guard, no CORS, and a strict CSP
with no inline script. There's no exploitable XSS. The remaining issues are missing
hardening headers, tokens in URLs, and per-IP rate-limit lockout.

## ATTACK-SURFACE MAP

| Route class | Auth | Host/Origin guard | Rate bucket |
|---|---|---|---|
| `GET /health` | none | **no** (`http.ts:2447` guards `/api/*`, `/events`, `/mcp` only) | health 120/min per IP (`:2427`) |
| `GET /`, `/assets/*` | none | no | anon API bucket |
| `/api/qr`, `/api/pairing-code` | pairing token | yes | health bucket |
| `/api/ui-token` | bootstrap token | yes | exchange 10/min per IP (`:2426`) |
| `/api/*` (rest), `/mcp` | account or UI token (`:2582`) | yes | per-token (`:2419`) or UI 240/min |
| `/events` | token, or `?token=` (`:2564`) | yes | none (by design) |
| `/api/media/*` GET | token, or `?token=` | yes | per-token |
| `/webhooks/cloud` | HMAC signature (cloud mode only) | no | anon |

Gates relied on: `hostOriginGuard` (`http.ts:261`), `tokenMatches` (`:242`,
SHA-256 + `timingSafeEqual`), the 401 check before route dispatch (`:2582`; there's
no route-existence oracle), the body cap before parsing (`:2593`, `:343`), and the
CSP (`:309`).

## FINDINGS (severity-sorted)

Format: **[P · SEC]** title — `file:line` — fix

1. **[P1 · HIGH]** `/health` publishes `uiBootstrapToken` unauthenticated while
   paired. Any local process or other OS user can exchange it for the full UI
   credential (D1 #18; the accepted risk is not acceptable on multi-user hosts) —
   `packages/bridge/src/http.ts:2471` — Fix: drop it from `/health`. Deliver it via
   a `HttpOnly; SameSite=Strict` cookie set on `GET /`, or read it from a 0600 file
   the CLI opens in the browser.
2. **[P1 · MEDIUM]** `/health` skips the Host guard, so a DNS-rebinding page can
   read the bootstrap token and status fields. The exchange itself stays guarded —
   `http.ts:2447` — Fix: run `hostOriginGuard` on `/health` (and on `/`).
3. **[P1 · MEDIUM]** The Status page paints `uiBootstrapToken` and `pairingToken`
   on screen as raw values (D1 #12 still open). A screenshot or screen share leaks a
   credential — `packages/web-ui/src/pages.ts:200` — Fix: filter `*Token` keys out
   of `statusDashboardHtml`.
4. **[P1 · MEDIUM]** The account or UI token travels in the query string
   (`?token=`) for `/events` and `/api/media/*`. It leaks into history, logs, and
   devtools — `http.ts:2571`, `web-ui/src/events-feed.ts:62`,
   `web-ui/src/pages.ts:320` — Fix: use short-lived, scoped media/SSE tickets
   (HMAC of id+expiry) or a same-site cookie.
5. **[P2 · MEDIUM]** No `frame-ancestors`/`X-Frame-Options`, so a page can frame
   the UI to clickjack one-click destructive buttons (unblock, delete rule, delete
   subscription) — `http.ts:309` — Fix: add `frame-ancestors 'none'` to
   `CSP_HEADER`.
6. **[P2 · MEDIUM]** Rate-limiter maps never evict, and `gateKey` hashes any
   arbitrary bearer. Sending random tokens grows memory without bound —
   `http.ts:285`, `:2419` — Fix: key unauthenticated or invalid bearers to
   `ip:anon` and add LRU/TTL eviction.
7. **[P2 · MEDIUM]** Owner lockout: all loopback clients share one IP bucket. A
   local process can spend the 10/min exchange bucket or the 120/min `/health` +
   pairing bucket, which 429s the owner's UI — `http.ts:2426-2428` — Fix: check
   rate limits after auth and key them by token; serve `/health` from cache with no
   bucket.
8. **[P2 · LOW]** Rate limiting runs before the Host/Origin guard, so rejected
   cross-site or rebinding requests still burn the owner's buckets —
   `http.ts:2434` vs `:2447` — Fix: run the guard first.
9. **[P2 · LOW]** Media GET and export responses have no CSP, `nosniff`, or
   `Content-Disposition`. The MIME types come from a magic-byte allowlist, so stored
   HTML can't be served as a page. This is defence-in-depth only — `http.ts:2053`,
   `:3970` — Fix: add `X-Content-Type-Options: nosniff`, CSP `sandbox`, and
   `Content-Disposition: inline; filename=…`.
10. **[P2 · LOW]** No `Referrer-Policy` on any response — `http.ts:317`, `:2393`
    — Fix: add `Referrer-Policy: no-referrer` globally.
11. **[P2 · LOW]** Tokens are stored in `localStorage`, so any future XSS can steal
    them for good. The UI also auto-saves the rotating pairing/bootstrap token from
    `/health` — `web-ui/src/main.ts:57`, `:162`, `:169`, `:1156` — Fix: use
    `sessionStorage` or keep tokens in memory only.
12. **[P2 · LOW]** The media download response returns an absolute local
    filesystem path (home directory and username) —
    `http.ts:2888`, `:2900` — Fix: return the media id and a relative name only.
13. **[P2 · LOW]** Media GET by message id needs no chat scoping (`chat_jid` is
    opt-in), so any token holder can enumerate stored media —
    `http.ts:380`, `:2043` — Fix: acceptable for a single-owner design, but
    document it. Require `chat_jid` from the UI.
14. **[P2 · LOW]** `WA_BIND_HOST=0.0.0.0` puts `/health` on the LAN, and the Host
    guard can be forged with curl, which means LAN account takeover through
    finding 1 — `packages/bridge/src/bin.ts:51` — Fix: refuse non-loopback binds
    unless `/health` drops its tokens, and warn loudly.
15. **[P3 · LOW]** The installer can inline the account token into agent config
    files (0600). They sit outside `~/.wa-mcp` and can get swept into dotfile
    backups — `packages/cli/src/writers.ts` — Fix: reference the token path or an
    env var instead of the literal value.
16. **[P3 · LOW]** The client `eventsLines` array grows without bound
    (`statusFeed` is capped, this one isn't), and every line re-renders the full
    list — `web-ui/src/main.ts:231` — Fix: cap it through `appendEvent`
    (`events-feed.ts:13`) at about 500.
17. **[P3 · INFO]** Static `/` and `/assets/*` are served with no auth or Host
    guard. Only public bundle code is exposed — `http.ts:2557` — Fix: guard Host
    for consistency (covered by finding 2).
18. **[P3 · INFO]** `/health` also exposes version, uptime, subscription count,
    reconnects, and `lastDisconnectAt` to any local caller — `http.ts:2456-2487` —
    Fix: split into public `{status, loggedIn}` and an authenticated `/api/status`.
19. **[P3 · INFO]** The pairing UI swallows `/health` failures, and the user can't
    tell an auth failure from an outage — `web-ui/src/main.ts:150-180` — Fix: show
    the error banner on a non-OK health poll.
20. **[P3 · INFO]** D1 #10 (owner's phone number as a placeholder) is
    **verified fixed**. The placeholders are now generic `358…@s.whatsapp.net` and
    `1203…@g.us` — `web-ui/src/pages.ts:509`, `:672` — no action.

## TOP-5 FIXES

1. Take `uiBootstrapToken` off `/health` and deliver it through a cookie set on `GET /` (fixes 1, 14, and most of 2).
2. Put `/health` and the static shell behind `hostOriginGuard`, and run the guard before rate limiting (2, 8, 17).
3. Replace `?token=` with scoped short-lived tickets, and add `Referrer-Policy: no-referrer` (4, 10).
4. Add hardening headers globally: `frame-ancestors 'none'`, `nosniff`, and a sandbox CSP on media (5, 9).
5. Fix the rate limiter: key by token after auth, evict stale entries, and send invalid bearers to `anon` (6, 7).

## WHAT'S SOLID

- Token comparison is constant-time through a SHA-256 digest, which also handles length mismatch (`http.ts:242`).
- Auth is checked before any route dispatch or body parse. Every unknown or protected route returns the same 401, so there's no route-existence oracle (`http.ts:2582`).
- The body cap is enforced on both `Content-Length` and the streamed total (`http.ts:2593`, `:359`).
- The Host/Origin guard rejects a `null` Origin, malformed origins, and https/port mismatches (`http.ts:261`).
- The pairing token is scoped to the pairing surface only and is withheld from `/health` once paired (`http.ts:2468`, `:2577`).
- `/api/pair/resume` was removed from the public pairing surface (`http.ts:209`).
- XSS: all dynamic strings in `pages.ts`, `pages-pairing.ts`, and the SSE feed go through `escapeHtml` (five entities, all attributes quoted). The CSP `default-src 'self'` has no `unsafe-inline` script, which is a second barrier. Identity (`pages-pairing.ts:102`), error banners (`pages.ts:569`), and render failures (`main.ts:370`) are all escaped.
- The static file server rejects path traversal (`http.ts:2378`). Media is read by DB-stored path, never from user-supplied paths.
- `sniffMimeType` is an allowlist, so stored HTML/SVG can't render as a document.
- The SSE and MCP notification streams use a name-based safe-event whitelist, and credential events are excluded.
- The data and media dirs are 0700 and the token file is 0600 (`bin.ts:70-87`, `lock.ts:39`). The default bind is loopback.
- The subscription inbox is bounded: text capped at 280 chars, a 2 MB cap, and one rotation. The W10 `isJid` checks return 400 on malformed JIDs.

DIMENSION 4 COMPLETE
