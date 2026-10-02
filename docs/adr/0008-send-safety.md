# 0008 — Send safety: pacing, daily cap, kill switch

## Status

Accepted

## Context

The bridge sends WhatsApp messages as the owner. Automation bugs become spam or bans. GOAL requires min-interval pacing, a daily cap, and a kill switch before any send feature ships.

## Decision

- `SendGuard` is consulted before validation-dependent work that can fail late, but after jid resolution: an unresolvable recipient is `INVALID_JID` (400) and must not consume pacing budget.
- Pacing: min interval (default 1000ms) per guard instance; over-pacing returns 429 `RATE_LIMITED` with `retryAfterMs`.
- Daily cap: default 200/day, persisted in the store `meta` table keyed `send_count:YYYY-MM-DD` (survives restarts, resets by UTC date); over-cap is 429 `DAILY_CAP_EXCEEDED`.
- Kill switch: `WA_SENDS_DISABLED=1` → 403 `SENDS_DISABLED` on every send, checked before the socket is touched. Env-only by design — no config override.
- `record()` commits only after a successful send.

## Consequences

- The guard is instance-local for pacing (restart resets the interval; the cap persists).
- Tests drive the guard directly; the refill/race-prone HTTP paths use an injected clock.
