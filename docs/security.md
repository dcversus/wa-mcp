# Security

The full model is ADR 0004. Summary of the shipped mechanics:

- **Loopback by default.** The bridge binds `127.0.0.1`; changing `WA_BIND_HOST` exposes it.
- **Bearer token everywhere.** Generated on first start (0600 file). Constant-time comparison. `GET /health` is the only public endpoint (liveness only), plus the static UI shell.
- **Kill switch.** `WA_SENDS_DISABLED=1` 403s every send before the socket is touched.
- **Pacing + daily cap.** 1s minimum interval between sends; 200/day persistent cap (UTC-keyed in the store). Over-cap → 429.
- **Path confinement.** Media/UI file access is lexically and realpath contained; message ids are sanitized to `[A-Za-z0-9_-]`.
- **Send validation order.** rate-limit → auth → body cap → per-field validation → jid strictness → guard → send. Invalid recipients never consume pacing budget.
- **Structured errors.** `{ error: { code, message } }` with a fixed vocabulary (UNAUTHORIZED, INVALID_JID, RATE_LIMITED, DAILY_CAP_EXCEEDED, SENDS_DISABLED, PAYLOAD_TOO_LARGE, VALIDATION_ERROR, PATH_FORBIDDEN, NOT_FOUND, TOO_LARGE, FETCH_FAILED).
- **Supply chain.** Zero runtime deps in the bridge core; CI runs `pnpm audit --prod --audit-level high`, gitleaks over history, and a no-publish grep guard.

## Reporting

Private repo — open a sanitized issue or contact the owner directly.
