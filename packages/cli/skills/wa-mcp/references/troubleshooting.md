# wa-mcp troubleshooting

## Pairing

- The bridge prints the QR to stderr on start and refreshes it on rotation; the same QR is at `GET /api/qr` and the web UI `#/pairing`.
- Scan within the rotation window or wait for the next QR.
- After a successful scan the session persists in `~/.wa-mcp/auth/` — restarts do not re-pair.

## Token / 401 UNAUTHORIZED

- Every API call and MCP tool needs the bridge token. It lives at `~/.wa-mcp/token` (0600).
- Web UI: paste the token in `#/settings`.
- MCP clients: the `env.WA_TOKEN` in your client config must match the bridge token.

## Daemon down

- `wa-mcp status` — connection + uptime.
- `wa-mcp doctor` — node version, data dir writable, token present, bridge health.
- `wa-mcp start` spawns the bridge detached; `wa-mcp stop` SIGTERMs the pid from `bridge.lock`.
- "session held" on start — another bridge owns the data dir; check `bridge.lock` pid.

## Error codes

| code               | meaning                    | fix                                        |
| ------------------ | -------------------------- | ------------------------------------------ |
| UNAUTHORIZED       | missing/wrong bearer token | set `WA_TOKEN` / re-run install            |
| INVALID_JID        | recipient unresolvable     | check the number/jid                       |
| RATE_LIMITED       | sending too fast           | wait `retryAfterMs`                        |
| DAILY_CAP_EXCEEDED | daily send cap hit         | wait for UTC reset or raise `WA_DAILY_CAP` |
| SENDS_DISABLED     | kill switch on             | unset `WA_SENDS_DISABLED`                  |
| PAYLOAD_TOO_LARGE  | body/media over cap        | shrink media (20MB media cap)              |
| VALIDATION_ERROR   | bad arguments              | see message for the offending field        |
| PATH_FORBIDDEN     | path escaped its sandbox   | use paths inside the media/ui dir          |
| NOT_FOUND          | unknown id/route/file      | check the id                               |
