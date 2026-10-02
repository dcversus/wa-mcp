# 0004 — Security model: loopback, bearer, caps

## Status

Accepted

## Context

The bridge exposes a WhatsApp account over HTTP. Threat model: anything on the machine (or LAN, if misbound) can read chats and send messages as the owner. GOAL §10 is a release gate.

## Decision

- Default bind `127.0.0.1`; `WA_BIND_HOST` override documented.
- Bearer token on every endpoint except `GET /health`; token generated 0600 at `<dataDir>/token`, compared via sha256 + `timingSafeEqual`.
- Kill switches: `WA_SENDS_DISABLED` (403 all sends), send pacing + persistent daily cap (`WA_DAILY_CAP`), 1MB request body cap, per-IP token bucket with `Retry-After`.
- Media and UI paths are confined: lexical + realpath containment (`PATH_FORBIDDEN` without existence leaks), messageId sanitization `[A-Za-z0-9_-]`.
- JID normalization is not enough for sends: a strict `isValidRecipientJid` gates the send path before pacing.
- Structured errors `{ error: { code, message } }`; no existence leaks for out-of-sandbox paths.

## Consequences

- The web UI shell is served unauthenticated by design; everything behind it 401s until the token is set.
- Windows does not implement POSIX bits — permission checks are platform-gated in tests and live-gated on macOS/Linux.
