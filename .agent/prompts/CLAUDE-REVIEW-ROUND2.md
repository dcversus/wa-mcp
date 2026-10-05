# TASK: independent code review — wa-mcp WebUI polish + fix rounds (read-only)

You are the INDEPENDENT REVIEWER. Do NOT modify any files. Read code, run
read-only commands (git log/diff/show, grep, node --check), and report.

## Scope (two commits)
- `git log --oneline -4` — the two most recent code commits are your targets:
  1. the "opus review round" fix commit (B1 profile handlers, M1/M2 exchange
     classification, M3 /api/me from creds, M4 picker, lint debt sweep)
  2. the earlier "usable-UI round" (W1 latch reset, W2 subscriptions picker,
     W3 /api/me + profile page)
- Review the FULL diff of both: `git diff <redesign-sha>..HEAD -- packages/`

## What to verify (be adversarial — the last reviewer found a dead-handler blocker)
1. `packages/web-ui/src/main.ts` — every `getElementById`/`querySelector`
   selector has matching markup in `pages.ts` (dead-selector class of bug).
   Especially bindProfileControls, bindSubscriptionsControls, filter input.
2. `packages/web-ui/src/api.ts` — every client method's URL + payload shape
   matches the bridge routes in `packages/bridge/src/http.ts` (field names,
   body shape, method). Check block/unblock/privacy/profile/me/subscriptions.
3. `packages/bridge/src/auth.ts` readOwnIdentity — error paths, missing
   creds, malformed JSON, device-suffix normalization, lid vs pn.
4. `packages/bridge/src/http.ts` /api/me — auth ordering, status fetch
   failure paths, creds leak surface (does it expose anything sensitive?).
5. `packages/web-ui/src/state.ts` — classifyExchangeFailure/shouldExchange:
   any state that strands the user token-less? Terminal latch ever reset?
6. XSS: every user-controlled value interpolated into HTML in pages.ts must
   go through escapeHtml. Check the new picker rows, me-card, count header.
7. Test quality: are the new tests (t141–t145, T144) asserting real behavior
   or tautologies? Any handler still untested because no DOM env exists?
8. Lint-sweep residue: the sweep converted String() to typeof guards — any
   BEHAVIOR change hidden in that (e.g. export.ts id non-string now "")?

## Output
Write your findings to `review/CLAUDE-REVIEW-2.md` (this file is the ONLY
write you may perform) as:
- VERDICT: CLEAN | NOT CLEAN
- BLOCKERS / MAJORS / MINORS with file:line and a one-line repro or reasoning
- TEST-GAPS section
Do not fix anything. Do not run builds or tests that mutate state (no vp
test, no builds, no installs). Git read-only commands only.
