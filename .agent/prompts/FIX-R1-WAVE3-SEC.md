# TASK: FIX WAVE R1-3 — D4 security fixes (TDD, no commit)

Read review/AUDIT-R1-D4.md first. TDD each fix; vp check 0; full suite
green; zero comments; no commit.

CRITICAL DESIGN NOTE for S1: the bootstrap-token delivery change alters
ADR 0012's contract (ephemeral pairing token from /health). Keep the
CHANGE minimal and safe for the single-user loopback reality:
- GET / sets a `wa-mcp-bootstrap=HttpOnly; SameSite=Strict` cookie with
  the bootstrap token, ONLY when the connection is loopback AND the
  request Host/Origin is ours.
- /api/ui-token accepts EITHER the cookie OR the existing bearer (the
  bearer path stays for the daemon-owned CLI + tests).
- REMOVE uiBootstrapToken from /health payload.
- The web UI bootstrap flow reads the cookie (fetch /api/ui-token with
  credentials:same-origin, no explicit token) and only falls back to the
  /health field if the cookie is absent AND WA_UI_BOOTSTRAP=1 legacy
  mode. Update ADR 0012 with the decision + migration note.

## S1 (HIGH, D4 #1+#14). Bootstrap token off /health
As above. RED tests: /health payload has no uiBootstrapToken key; GET /
sets the cookie; exchange works via cookie; exchange still works via
bearer (compat).

## S2 (MED, D4 #2+#8+#17). Host guard everywhere, before rate limits
- hostOriginGuard also covers /health, /, /assets.
- Guard runs BEFORE the rate limiter so foreign requests burn no bucket.
- RED: request with foreign Host → 403 before any bucket tick.

## S3 (MED, D4 #3). No tokens painted on screen
- statusDashboardHtml filters any key matching /token/i from rendering.
- Settings token input → type=password with a reveal toggle.
- RED: rendered status HTML contains no token value.

## S4 (MED, D4 #5+#9+#10). Hardening headers
- CSP += frame-ancestors 'none'.
- Global Referrer-Policy: no-referrer.
- Media GET + export: X-Content-Type-Options: nosniff, CSP sandbox,
  Content-Disposition: inline; filename="<name>".
- RED: header assertions in http tests.

## S5 (MED, D4 #6+#7). Rate limiter hygiene
- Unauthenticated/invalid bearers key to ip:anon (single bucket).
- TTL eviction for limiter map entries (e.g. 10 min idle).
- RED: N random-bearer requests do not grow the map; anon traffic shares
  one bucket; the owner's token bucket unaffected by anon spam.

## S6 (LOW, D4 #12+#16). Info hygiene
- Media download response: relative name only, no absolute paths.
- Client eventsLines capped at 500 via appendEvent.

Report: root causes, RED→GREEN list, gates, migration notes for ADR 0012.
