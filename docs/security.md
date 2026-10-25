# Security

wa-mcp is a single-user, loopback-only bridge to your personal WhatsApp account. The full rationale is in [ADR 0004](./adr/0004-security-model.md) and [ADR 0012](./adr/0012-scoped-pairing-token-and-loopback-guard.md). This page describes the mechanics that ship in 0.1.0.

## Trust boundary

**Loopback + same OS user.** Anything running as your user on this machine can already read `~/.wa-mcp/token`, so the bridge treats it as trusted. Everything else (other machines, other users' web pages, other OS users) has to get past the controls below.

| Control           | Default                                                                 | Notes                                                                                                                                                                                                                   |
| ----------------- | ----------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Bind address      | `127.0.0.1` <!-- src: packages/bridge/src/bin.ts:51 -->                 | `WA_BIND_HOST` changes it. Anything other than loopback exposes the daemon; there is no TLS.                                                                                                                            |
| Host/Origin guard | always on <!-- src: packages/bridge/src/http.ts:249-280, 2383-2389 -->  | `/api/*`, `/events`, `/mcp`: `Host` must be `127.0.0.1`, `localhost` or `[::1]`. A present `Origin` must be `http:` and match `Host`. `Origin: null` is refused. Failures return 403 `FORBIDDEN_HOST` before auth runs. |
| Bearer token      | generated on first start <!-- src: packages/bridge/src/bin.ts:74-89 --> | 32 random bytes as hex, stored in `<dataDir>/token` (mode 0600). `WA_TOKEN` overrides it.                                                                                                                               |
| Token compare     | constant-time <!-- src: packages/bridge/src/http.ts:224-242 -->         | Both sides are SHA-256 hashed, then compared with `timingSafeEqual`.                                                                                                                                                    |
| CSP               | every response <!-- src: packages/bridge/src/http.ts:307 -->            | `default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline'`                                                                                                                                            |

### Public endpoints

These answer without a bearer token:

- `GET /health`: liveness plus the pairing-window fields described below. <!-- src: packages/bridge/src/http.ts:2390-2426 -->
- `GET /` and `/assets/*`: the static web UI shell. <!-- src: packages/bridge/src/http.ts:2493-2496 -->
- `/webhooks/cloud`: only when the Cloud channel is selected. It has its own verification (see [Cloud channel](#cloud-channel-webhooks)). <!-- src: packages/bridge/src/http.ts:2427-2492 -->

Everything else returns 401 `UNAUTHORIZED` without a valid token. <!-- src: packages/bridge/src/http.ts:2518-2528 -->

## Auth design (ADR 0012)

The owner rule: **the web UI never asks you to use a terminal.** Three credentials make that possible without giving local web pages access.

| Credential         | Lifetime                                                                                       | Where it comes from                                                                           | What it opens                                                                                                               |
| ------------------ | ---------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Pairing token      | per boot <!-- src: packages/bridge/src/bin.ts:283-285 -->                                      | `/health`, **only while no account is paired** <!-- src: packages/bridge/src/http.ts:2404 --> | `/api/qr`, `/api/pairing-code`, `/api/ui-token`. Nothing else. <!-- src: packages/bridge/src/http.ts:197-205, 2513-2514 --> |
| UI bootstrap token | stable; `<dataDir>/ui-bootstrap-token` (0600) <!-- src: packages/bridge/src/bin.ts:177-187 --> | `/health` as `uiBootstrapToken` <!-- src: packages/bridge/src/http.ts:2407 -->                | `GET /api/ui-token` only <!-- src: packages/bridge/src/http.ts:2516-2517 -->                                                |
| UI token           | per daemon process <!-- src: packages/bridge/src/http.ts:469 -->                               | `GET /api/ui-token` (needs the Host/Origin guard plus a pairing or bootstrap token)           | the full API, with its own rate bucket                                                                                      |
| Account token      | stable; `<dataDir>/token`                                                                      | the file, or `WA_TOKEN`                                                                       | the full API (agents, CLI, MCP)                                                                                             |

How the web UI signs in:

1. While unpaired, the UI reads `pairingToken` from `/health` and drives the QR or pairing-code flow.
2. Once paired, `pairingToken` disappears from `/health`. A fresh browser instead exchanges `uiBootstrapToken` at `/api/ui-token` for a UI token.
3. The UI stores the token in localStorage and uses it for chats, sends, media `?token=` URLs and SSE.

`/api/pair/resume` is **not** part of the pairing surface. It requires the account or UI token because it resets the anti-abuse budget. <!-- src: packages/bridge/src/http.ts:200-204 -->

**Strict mode.** `WA_UI_BOOTSTRAP=0` makes `/api/ui-token` refuse with 403 `PAIRED` once an account is paired. The web UI then needs the account token pasted into its settings. <!-- src: packages/bridge/src/http.ts:4163-4170 --> Use it on multi-user hosts, or run the daemon as a dedicated user.

**Known residual risk:** a process running as a _different_ OS user can reach loopback, read `/health` and mint a UI token. No HTTP-level check can tell a browser apart from a same-host process. <!-- src: docs/adr/0012-scoped-pairing-token-and-loopback-guard.md (Addendum 2) -->

### DNS rebinding

A rebinding page sends `Host: evil.example:27777`. Browsers set that header themselves and pages can't override it, so the Host check rejects the request before auth. This applies even to a page that has read a token from `/health`.

## Request pipeline

Every authenticated request passes these gates in order:

1. **Transport rate limit** → 429 `RATE_LIMITED` with `Retry-After`. <!-- src: packages/bridge/src/http.ts:2362-2380 -->
2. **Host/Origin guard** → 403 `FORBIDDEN_HOST`. <!-- src: packages/bridge/src/http.ts:2383-2389 -->
3. **Auth** → 401 `UNAUTHORIZED`. <!-- src: packages/bridge/src/http.ts:2518-2528 -->
4. **Body cap** of 1,000,000 bytes, checked on `Content-Length` and while streaming → 413 `PAYLOAD_TOO_LARGE`. <!-- src: packages/bridge/src/http.ts:174, 2529-2544 -->

`/api/send` then continues:

5. Per-field validation → 400 `VALIDATION_ERROR`. <!-- src: packages/bridge/src/http.ts:799-1260 -->
6. Recipient resolution and jid strictness → 400 `INVALID_JID`. <!-- src: packages/bridge/src/http.ts:1261-1273 -->
7. Send rules, checked against the caller's form, the resolved jid, aliases and the LID canonical form → 403 `SEND_BLOCKED`. <!-- src: packages/bridge/src/http.ts:1274-1323 -->
8. Send guard (pacing + daily cap). It **reserves** a slot → 429 `RATE_LIMITED` / `DAILY_CAP_EXCEEDED`. <!-- src: packages/bridge/src/http.ts:1337-1356; packages/bridge/src/send/safety.ts:56-72 -->
9. Kill switch, then the engine send. <!-- src: packages/bridge/src/send/send.ts:170 -->

Invalid recipients and blocked targets are refused before step 8, so they never use pacing or the daily cap. If a send fails after its slot was reserved, the daily-cap slot is given back but the pacing slot is not. <!-- src: packages/bridge/src/http.ts:1407; packages/bridge/src/send/safety.ts:74-84 -->

Known 0.9 behavior: the kill switch is evaluated inside the send path after the pacing slot is reserveds a slot and then releases it. Its 1s pacing slot stays used.

## Rate limiting

There are two separate layers.

**Transport buckets** are in-memory token buckets that refill continuously. <!-- src: packages/bridge/src/http.ts:282-302 -->

| Route class                                                                     | Bucket key                                                      | Capacity / refill                                                   |
| ------------------------------------------------------------------------------- | --------------------------------------------------------------- | ------------------------------------------------------------------- |
| `/health` and pairing surface (`/api/qr`, `/api/pairing-code`, `/api/ui-token`) | client IP                                                       | 120 / min <!-- src: packages/bridge/src/http.ts:182, 2363-2364 -->  |
| Requests that present the UI token                                              | client IP                                                       | 240 / min <!-- src: packages/bridge/src/http.ts:190, 2367-2368 -->  |
| All other API routes (incl. `/api/subscriptions`, `/mcp`)                       | IP + SHA-256 prefix of the bearer token, or `IP:anon`           | 60 / min <!-- src: packages/bridge/src/http.ts:176, 2353-2369 -->   |
| `/events` (SSE)                                                                 | none, because a 429 makes EventSource reconnect in a tight loop | none <!-- src: packages/bridge/src/http.ts:2343-2347, 2365-2366 --> |

Every client on loopback shares `127.0.0.1`. Keying the API bucket by token means a flood of tokenless 401s can't starve a valid client.

**The send guard** limits WhatsApp traffic:

- At least 1s between sends.
- A cap of 200 sends per UTC day, stored in the `meta` table as `send_count:YYYY-MM-DD`. `WA_DAILY_CAP` overrides it.

<!-- src: packages/bridge/src/send/safety.ts:13-18, 32-34; packages/bridge/src/bin.ts:48,57 -->

Every secondary send path (tts, voice, newsletter, batch forward, scheduler) goes through the same gate. <!-- src: packages/bridge/src/http.ts:385-434; packages/bridge/src/bin.ts:91-94 -->

**Kill switch:** with `WA_SENDS_DISABLED=1`, every send returns 403 `SENDS_DISABLED` before the socket is touched. <!-- src: packages/bridge/src/send/send.ts:170-172 -->

**Send rules:** per-target `block` rules. A trailing `*` acts as a prefix wildcard (`*@g.us` blocks all groups). Expired rules are ignored. A block rule always wins; a target with no matching rule is allowed. <!-- src: packages/bridge/src/store/send-rules.ts:44-66 -->

Confirmed: send rules are deny-list semantics — `allow` rules are skipped (`send-rules.ts:59`)w` a reserved value or a missing feature?

## Media SSRF guard

Sending media by `url` must never probe the daemon's own network. <!-- src: packages/bridge/src/media/resolve.ts:50-95, 155-200 -->

- Only `http:` and `https:` are allowed. `localhost`, `*.localhost` and `::1` are rejected by name.
- IP literals are checked directly. Hostnames are resolved (`dns.lookup`, all addresses) **before** fetching, and the request is refused if _any_ address is blocked.
- Blocked IPv4: `0/8`, `10/8`, `127/8`, `100.64/10`, `172.16/12`, `192.168/16`, `169.254/16` (cloud metadata).
- Blocked IPv6: `::`, `::1`, `fc00::/7`, `fe80::/10`.
- IPv4 addresses embedded in IPv6 (`::ffff:`, `64:ff9b::/96`, `2002::/16`) are judged by the embedded IPv4 address. Unparseable addresses are refused.
- Redirects use `redirect: "manual"`. Every hop is checked again, with at most 3 redirects. <!-- src: packages/bridge/src/media/resolve.ts:331-372 -->
- There is a 30s overall fetch timeout and a 20 MB size cap (`TOO_LARGE`). <!-- src: packages/bridge/src/media/resolve.ts:201-205 -->
- Refusals return `SSRF_BLOCKED`; fetch errors return `FETCH_FAILED`.

Known 0.9 gap: the guard resolves DNS, then `fetch` resolves again — a rebinding DNS server could return a different addressuld return a public address to the check and a private one to the fetch. Should the fetch be pinned to the address that was checked?

## Path confinement

- UI, QR and media paths are confined both lexically and via `realpath`. An escape returns 403 `PATH_FORBIDDEN`. <!-- src: packages/bridge/src/http.ts:596-600, 2312-2319 -->
- Message ids used in file paths must match `^[A-Za-z0-9_-]+$`. <!-- src: packages/bridge/src/http.ts:1967 -->
- A media lookup that names a chat must match that row's chat, so ids can't be replayed across chats. <!-- src: packages/bridge/src/http.ts:376-383 -->

## File permissions

| Path                           | Mode                                                                     | Source                                               |
| ------------------------------ | ------------------------------------------------------------------------ | ---------------------------------------------------- |
| `<dataDir>/`                   | 0700 when the token is first created                                     | <!-- src: packages/bridge/src/bin.ts:85 -->          |
| `<dataDir>/token`              | 0600 (chmod enforced)                                                    | <!-- src: packages/bridge/src/bin.ts:86-87 -->       |
| `<dataDir>/ui-bootstrap-token` | 0600                                                                     | <!-- src: packages/bridge/src/bin.ts:186 -->         |
| `<dataDir>/media/`             | 0700 (chmod enforced at boot)                                            | <!-- src: packages/bridge/src/bin.ts:67-72 -->       |
| `<dataDir>/auth/`              | 0700                                                                     | created by the engine bootstrap (`bin.ts:70`)        |
| `<dataDir>/config.json`        | written 0600. The CLI won't load it if group or other users can read it. | <!-- src: packages/cli/src/config-store.ts:36-51 --> |

The data dir itself is created 0700 and re-chmodded on every start (`bin.ts:70-71`), so a pre-existing wider mode is tightened.

## Event-stream hygiene

`/events` only forwards a whitelist of event types. Events that carry credentials, such as `creds.update`, never reach SSE. <!-- src: packages/bridge/src/http.ts:2630-2634; packages/bridge/src/events.ts:66-68 --> The fixture recorder also skips `creds.update` and removes key material (see [Diagnostics](./diagnostics.md#event-recording)).

## Cloud channel webhooks

The Cloud API channel is a skeleton, selected with `WA_CHANNEL=cloud`. <!-- src: packages/bridge/src/channels/cloud/config.ts:56-71 -->

- Credentials come only from env vars, never the store: `WA_CLOUD_ACCESS_TOKEN`, `WA_CLOUD_PHONE_NUMBER_ID`, `WA_CLOUD_VERIFY_TOKEN` and `WA_CLOUD_APP_SECRET`. Each missing variable is reported by name. <!-- src: packages/bridge/src/channels/cloud/config.ts:19-48 -->
- **`GET /webhooks/cloud`** echoes `hub.challenge` only when `hub.mode=subscribe` and `hub.verify_token` matches. Otherwise it returns 403 `FORBIDDEN`. <!-- src: packages/bridge/src/channels/cloud/webhooks.ts:7-19 -->
- **`POST /webhooks/cloud`** has a 1 MB body cap. `X-Hub-Signature-256` must equal `sha256=` + HMAC-SHA256(app secret, raw body), compared in constant time. A mismatch returns 403. <!-- src: packages/bridge/src/channels/cloud/webhooks.ts:21-34; packages/bridge/src/http.ts:2444-2466 -->

Confirmed gap: `verify_token` is compared with `!==`, not constant-time (`webhooks.ts:14`) — fine for 0.9 since the webhook skeleton is owner-gateds that acceptable?

The Host guard doesn't apply to `/webhooks/*`. Receiving Meta webhooks needs a reverse proxy or tunnel, which is outside the loopback model.

## Threat model

| Attacker has…                                                        | Can                                                                       | Cannot                                                                                                                                                                                            |
| -------------------------------------------------------------------- | ------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **LAN peer** (default bind)                                          | nothing; the port isn't reachable                                         | anything                                                                                                                                                                                          |
| **LAN peer** with `WA_BIND_HOST=0.0.0.0`                             | read `/health`                                                            | call the API: the Host guard refuses non-loopback `Host` and there's no token. Without TLS, though, tokens sent over the LAN can be sniffed.                                                      |
| **Malicious web page** in your browser (cross-site or DNS rebinding) | send requests that never reach auth                                       | pass the Host/Origin guard (403 `FORBIDDEN_HOST`), even after reading tokens from `/health`                                                                                                       |
| **Malware running as you**                                           | everything you can do: it reads the 0600 token                            | — (by design; this is the trust boundary)                                                                                                                                                         |
| **Different local OS user**                                          | read `/health` and mint a UI token via `uiBootstrapToken` (residual risk) | do this if you set `WA_UI_BOOTSTRAP=0` or run the daemon as a dedicated user                                                                                                                      |
| **Malicious message content** (inbound text, media, polls)           | land in the store and reach your MCP client as data                       | trigger sends by itself: every send needs an authenticated request through the send guard. Prompt injection aimed at your agent is still possible; use send rules and the daily cap as backstops. |
| **Malicious media URL** (given to a send)                            | make the bridge fetch one public URL, up to 20 MB / 30s                   | reach loopback, private, link-local or metadata addresses, directly or through redirects (`SSRF_BLOCKED`). See the DNS re-resolution marker above.                                                |
| **Compromised MCP client** (holds the account token)                 | read chats and send as you, at 1/s and up to the daily cap                | get past the kill switch, send rules or the 200/day cap; read files outside the media/UI roots                                                                                                    |

## Supply chain and the no-publish stance

- **Dependencies:** the bridge depends on the pinned Baileys fork (ADR 0011), `pino`, `qrcode` and `qrcode-terminal`. The MCP server's JSON-RPC layer has zero dependencies (ADR 0005). ADR 0002’s zero-dep claim covers the hand-rolled HTTP/MCP/store core; the bridge package additionally pins baileys (engine), pino (logging) and qrcode (pairing) — all pinned, audited, and no others (`packages/bridge/package.json`). Original text continued: `packages/bridge/package.json:23-30`.
- **CI** runs `pnpm audit --prod --audit-level high`, gitleaks over the full history, and a no-publish grep guard.
- **0.1.0 isn't published to any registry** (ADR 0010). Install from the repo. Any package named `wa-mcp` on a public registry isn't ours.

## Reporting

This is a private repo. Open a sanitized issue or contact the owner directly.

---
