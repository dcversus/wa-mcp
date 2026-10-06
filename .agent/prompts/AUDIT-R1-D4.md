# TASK: AUDIT R1 — D4 Security audit, web UI surface (opus, independent)

You are the INDEPENDENT SECURITY AUDITOR. Dimension D4 (final) of the
campaign. Read review/AUDIT-R1-D1.md findings 10/12/18 for known
security-adjacent items (owner phone placeholder, credential on /status,
bootstrap token on /health) — verify them, then go beyond.

## Context
wa-mcp: local WhatsApp MCP bridge at http://127.0.0.1:8080 (loopback
bind), vanilla-JS SPA served by the bridge, bearer-token API, paired
daemon. Repo ~/Documents/GitHub/wa-mcp. ADR 0012 documents the auth
design (ephemeral pairing token from /health, stable UI token exchange,
loopback + same-origin assumptions).

## Your D4 mission — adversarial security review

1. **Token lifecycle.** /health publishes uiBootstrapToken (unauthed).
   /api/ui-token exchanges it (Host/Origin-guarded, rate-limited 10/min).
   Map every step an attacker on the SAME MACHINE (other OS user,
   browser tab, local process) must take, and every step a REMOTE
   attacker (DNS rebinding, CSRF from a malicious page, SSE from another
   origin) must take. Which defenses hold, which have gaps? Cite
   file:line for every gate you rely on.
2. **XSS deep-dive.** Every interpolation in pages.ts through escapeHtml?
   Every innerHTML/DOM sink in main.ts? SSE event payloads rendered into
   the feed? Message text containing HTML/script? Media filenames?
   Group names from other users? Chat names? Construct actual payloads
   in a live probe (send to Test group ONLY: a message containing
   `<img src=x onerror=alert(1)>` and one with a fake "system" look)
   and observe what renders.
3. **Auth surface.** Enumerate every route http.ts serves; classify
   auth/no-auth and WHY. Look for: routes that parse body BEFORE auth,
   error-message oracles (does 401 vs 404 leak route existence?),
   timing, rate-limit bucket interactions (can an attacker lock the
   owner out of /health? of the exchange?).
4. **CSRF / browser attacks.** The bridge checks Host/Origin on /api/*.
   Verify: what happens with no Origin header (curl, some fetches)?
   GET-based state changes? (Subscriptions via GET? read-bulk? logout?)
   Can a malicious local HTML file do anything? Can a remote site?
5. **Media security.** Path traversal on /api/media/:id/view + download
   (try ../, encoded, absolute), MIME confusion (served content-type vs
   sniff), the media token in URLs (does it leak via referrer/logs?).
6. **Information disclosure.** /health unauthed fields (enumerate +
   judge each), error stack traces, bridge.log contents, SSE payloads,
   the CLI printing tokens, localStorage contents, the settings page
   token input.
7. **Denial of service.** Body cap enforcement, rate-limit coverage per
   route, unbounded arrays (events feed), the subscriptions inbox
   rotation.

## Rules
- Live probes against 127.0.0.1:8080 (curl + Playwright in /tmp). Token:
  $(cat ~/.wa-mcp/token) — NEVER print it.
- Live sends ONLY to Test group 120363428874442773@g.us (that includes
  XSS payload messages — they're inert text to WhatsApp).
- Do not stop the daemon (other audits may run). Do not pair. No volume.
- No repo modification. ONLY writes: review/AUDIT-R1-D4.md + /tmp.
- Every finding: severity (use P0-P3 PLUS a security severity: CRITICAL/
  HIGH/MEDIUM/LOW/INFO) + file:line or live repro + exploit scenario +
  concrete fix + effort.
- Rate limit near → save partial "DIMENSION 4 PARTIAL — continue from
  finding <N>", stop.

## Deliverable
review/AUDIT-R1-D4.md: VERDICT · ATTACK-SURFACE MAP · FINDINGS
(severity-sorted) · TOP-5 FIXES · WHAT'S SOLID.
End "DIMENSION 4 COMPLETE" (or PARTIAL).
