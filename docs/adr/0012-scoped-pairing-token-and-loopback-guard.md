# ADR 0012: Scoped pairing token + loopback Host/Origin guard

Date: 2026-10-03
Status: Accepted
Task: T73 C1 (independent reviews: Anthropic C1, Grok C1 — release gate)

## Context

`/health` publishes an ephemeral `pairingToken` so the local web UI can
authenticate without the user pasting anything (T54 — "the WebUI should never
expect the user to do something with the CLI"). The T54-revised scope let that
token read account data and send messages. Both independent reviews flagged the
chain: `/health` is unauthenticated → any local page (or a DNS-rebinding page)
reads the token → the token authorizes chats, messages and sends.

DNS rebinding: `evil.example` re-resolves to `127.0.0.1`; a victim visiting the
attacker page fetches `http://evil.example:8080/health` — same-origin to the
attacker, loopback to the daemon. Browsers refuse to set `Host` and `Origin`
manually, but they set them _themselves_ — `Host: evil.example:8080`,
`Origin: http://evil.example:8080` — which is exactly the fingerprint.

## Decision

1. **The pairing token is scoped to the pairing surface only**:
   `/api/qr`, `/api/pairing-code`, `/api/pair/resume`, `/api/ui-token`.
   `/health` still publishes it (zero-friction pairing), but it can never read
   account data, send, mutate config, or touch `/events` / `/api/media/*`.
2. **Host/Origin guard on every API surface** (`/api/*`, `/events`, `/mcp`):
   - `Host` must be loopback (`127.0.0.1`, `localhost`, `[::1]`, port ignored).
   - If `Origin` is present it must be `http:` and same-host as the request's
     `Host`. Absent `Origin` (curl, MCP clients, non-browser) is allowed;
     `Origin: null` is refused.
   - Returns 403 `FORBIDDEN_HOST` before auth is evaluated.
3. **`GET /api/ui-token`** — the web UI's path to account access: requires the
   scoped pairing token AND passes the Host/Origin guard; returns the daemon
   token once. The UI runs this when `/health` reports `loggedIn` and no
   session token is stored, persists it via `saveSettings`, and uses it for
   everything (chats, sends, media query-tokens, SSE).

## Why this design

- The alternative — no published token at all, "copy the token from the daemon
  console" — was rejected by the owner (T54): the web UI must never require
  CLI action.
- The guard kills the rebinding vector for _all_ routes, not just the token
  exchange: with `Host` checked first, a rebound page cannot reach any API
  route even with a stolen token, and the cross-site `Origin` check is the
  second, independent wall for plain cross-origin requests (no rebinding
  needed). This also satisfies the MCP spec's transport-security requirement
  that `/mcp` validate `Origin`.
- The exchange is safe to expose because every gate is browser-unforgeable:
  the attacker page cannot set `Host` or `Origin`, and cannot obtain the
  pairing token's _use_ — reading `/health` gives the token string, but the
  guard refuses the attacker's requests before auth sees it.

## Consequences

- Media/SSE query-tokens (`?token=`) must now carry the _session_ token;
  while unpaired there is no media or stream data to protect.
- A UI page opened from a non-loopback origin (e.g. someone port-forwarding
  the daemon) degrades to the pairing flow with 403s — remote access is
  explicitly out of scope for the loopback web UI.
- The T54-revised "ui token reads account data" contracts were rewritten;
  the destructive-mutation 401s they already asserted remain true.

## Addendum (T94-E CR1, runtime-security review)

The original design leaked: `/health` is public and published the pairing
token unconditionally, so any local process could read it and exchange it at
`/api/ui-token` for a full-surface credential — a complete tokenless access
chain (reviewer-confirmed against a live daemon).

Tightened, keeping the owner flow intact:

1. `/health` publishes `pairingToken` ONLY while `hasPairedAccount()` is
   false (the pairing window). Once paired, the field disappears.
2. `/api/ui-token` refuses with `403 PAIRED` once paired. The exchange is a
   pairing-window operation, not a standing one.
3. The owner's browser keeps the account token it obtained at the first
   pairing (localStorage); the pairing page only renders pre-pairing anyway.
4. The UI token (T93-C2) remains full-surface but is only mintable inside
   the pairing window.

## Addendum 2 (T94-G, owner-rule regression)

Addendum 1 broke the OWNER RULE — "the WebUI should never expect the user to
do something with the CLI". A fresh browser on a PAIRED daemon had no
bootstrap path: /health hid the pairing token and the exchange refused
paired mode (e2e: `missing or invalid bearer token` on #/chats).

**Threat model (analysis agreed, with one honest refinement):**

- CR1's attacker was a local process. A SAME-user process can already read
  `~/.wa-mcp/token` (0600) — the ui-token exchange added zero capability
  for it. REFUTED for same-user.
- A DIFFERENT-user local process cannot read the token file but CAN reach
  loopback. For them the pairing-token leak was real — but there is no
  cryptographic way to distinguish a browser from a same-host process on
  loopback: both send plain HTTP with forgeable headers. Any gate that
  admits the browser admits them.

**DECISION:** loopback + same-user is the trust boundary (the 0600 file
already establishes it). On a paired daemon `/api/ui-token` still mints the
full-surface UI token — the owner USES the web UI to chat.

**Mechanics:** a STABLE bootstrap credential lives at
`<dataDir>/ui-bootstrap-token` (0600, survives restarts — the pairing token
rotates per boot). `/health` publishes it as `uiBootstrapToken` (the pairing
token stays hidden when paired). `/api/ui-token` accepts the pairing token
(retained in the browser's localStorage from the pairing session) OR the
bootstrap token. `WA_UI_BOOTSTRAP=0` is a kill switch restoring the strict
addendum-1 posture.

**Residual risk, stated plainly:** a different-user local process can read
`/health` and mint a full UI token — strictly weaker than the 0600 boundary.
Mitigations: the daemon binds 127.0.0.1 by default; the kill switch exists;
multi-user hosts should run the daemon under a dedicated user or set
`WA_UI_BOOTSTRAP=0`.

## Addendum 3 — S1 (R1-D4): the bootstrap token moves off /health (2026-10-07)

**Context:** addendum 2 published `uiBootstrapToken` on unauthenticated
`/health`. On a multi-user host any local process — including another OS
user — could read it and mint a full UI token. That residual risk is not
acceptable; the cookie delivers the same zero-action bootstrap to real
browsers without advertising the credential to every local process.

**Decision:**

- `/health` no longer carries `uiBootstrapToken` (or `pairingToken` when
  paired — unchanged from CR1). The pairing token is still published while
  pairing is possible (pre-pair, the data-dir token file grants the same
  capability anyway).
- `GET /` (the UI shell) sets `wa-mcp-bootstrap=<token>` as an
  `HttpOnly; SameSite=Strict; Path=/` cookie — ONLY for loopback
  connections whose Host/Origin passes `hostOriginGuard` (which since S2
  covers `/`, `/assets/*`, `/health` too, and runs BEFORE rate limiting).
- `/api/ui-token` accepts the bootstrap token from EITHER the cookie
  (browser path) or the `Authorization: Bearer` header (daemon-owned CLI
  and tests — unchanged).
- The web UI exchanges cookie-first (`fetch … credentials: "same-origin"`,
  no bearer header) and falls back to the legacy bearer exchange only when
  a retained pairing/bootstrap token exists in localStorage (older-daemon
  migration path).
- `WA_UI_BOOTSTRAP=0` still refuses the exchange entirely when paired.

**Migration:** browsers that only ever talked to the old daemon get the
cookie on their next `GET /` — no action. Clients that scraped
`uiBootstrapToken` from `/health` (scripts, old tabs mid-session) must
switch to the cookie flow or read `<dataDir>/ui-bootstrap-token` (0600)
directly. The bearer exchange path is retained and is NOT deprecated.

**Residual risk after S1:** `/health` is tokenless (status fields only,
and now Host-guarded). A different-user local process can still read the
0600 token file only by being the same user — the loopback HTTP surface no
longer mints UI tokens for processes that cannot read the file. The
cookie is reachable only by a fetch from a loopback same-origin page
(HttpOnly keeps it from page script; SameSite=Strict + the Host/Origin
guard keep foreign pages out).
