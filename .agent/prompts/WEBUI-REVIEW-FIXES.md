# TASK: fix all findings from the opus review (file: OPUS-WEBUI-REVIEW.md — READ IT FIRST, it is the authoritative finding list)

Orchestrator verified B1 (handlers bind dead #name-form/#privacy-form selectors; new #save-name/#save-status/[data-privacy-key] are display-only; no setProfileStatus client method exists) and M3 (senderNameOf falls back to recipient digits — one save would rename the owner to a contact's number). Fix order per the review: **B1, M3, M1+M2 together, M4, then minors.**

## B1 — wire the profile controls (BLOCKER)
- Add `setProfileStatus(status: string)` to api.ts client (POST /api/profile {status} — the bridge accepts it; check http.ts profile route: name OR status required).
- Rewrite `bindProfileControls` in main.ts to bind the ACTUAL new markup:
  - `#save-name` click → POST name from `#me-name` input; on success show a small ok flash/inline text (no alert); on error show the existing error-banner pattern.
  - `#save-status` click → same with `#me-status`.
  - `select[data-privacy-key]` change → client.setPrivacy(key, value) with the READ→WRITE key mapping the review demands (read keys `last, profile, status/about, groupadd, calladd, readreceipts` vs write keys — check profile.ts updatePrivacy's expected shape and api.ts setPrivacy's {privacy_key, value}; add the mapping table in ONE place with a drift-guard test).
  - Note: the bridge set-privacy key set must accept the keys the UI sends — verify against bridge profile.ts allowed keys and use exactly those.
- Handler tests (new t143-profile-controls.test.ts): simulate clicks with jsdom-ish DOM stubs the way existing bind* tests do (check how t114 tests bindSubscriptionsControls for the established pattern) — assert the API calls fire with correct bodies/keys.

## M3 — /api/me name fallback returns someone else's number (MAJOR)
- Drop the fromMe sender_name fallback entirely (the review's fix): read identity from the auth state — check how creds/me are accessible in the bridge (auth state file, `handle.socket.user`, or creds.me from the Baileys auth cache; pick the source that works while disconnected). Return {pn, name, status} with name from the reliable source or null.
- Strip the device suffix + domain from pn (review minor 1): `358…:12@s.whatsapp.net` → `358…` (use the shared jid util if it exports something suitable).
- If Baileys offers a cheap fetchStatus for our own jid, wire status (review minor 2); if it's risky, keep null but then the UI must NOT prefill an empty editable status with a placeholder that invites overwriting — show the real status or "—" read-only when unknown (decide by what's actually cheap; document in the test).
- Update the bridge /api/me tests to cover: pn normalization, name from auth state, no sender_name query at all.

## M1+M2 — exchange latch semantics + stale-token stranding (MAJOR, one change)
Per the review's classification fix:
- `shouldExchange` gains failure classification: 403 (FORBIDDEN_HOST / PAIRED) → latch for the REST OF THE PAGE LOAD (a `terminalFail` flag the catch sets, never reset); 429 → respect `ApiError.retryAfterMs` before the next attempt (store `retryNotBefore` timestamp; syncPairingToken skips exchange while now < retryNotBefore); network error → retry once then latch until loggedIn flips false→true; loggedIn false→true transition → always allow one retry.
- M2: on a 401 from an API call while `settings.token.length > 0` (stale stored token after daemon restart), clear the stored token ONCE per page load and re-run the exchange (the onUnauthorized path). Add `staleTokenCleared` latch.
- Update the t142 tests to the new semantics (the review notes the current first test checks a state that never persists at runtime — fix the test to match real behavior: latch persists after terminal failures, not after transient ones).
- No retry storm: after the change, worst case per stuck tab is bounded (terminal latch or retry-after respected). Add a test asserting no more than N exchange attempts across M rapid renders under 403/429.

## M4 — picker races (MAJOR)
- Disable the row's checkbox while its create/delete request is in flight.
- Store sub ids per chat row (data-sub-ids) so uncheck deletes the RIGHT subscription; if multiple subs exist for the chat, delete the one the picker created (its id), leave advanced ones.
- Catch create/delete errors → revert the checkbox + show the error banner.
- Handle all-chats subscriptions in the `subscribed` set (review: they're excluded → rows show unchecked → checking creates overlapping sub). Decide: if an all-chats sub exists, show all rows checked-and-disabled with a note "all-chats subscription active — manage it in Advanced".
- subscriptions loader: `.chats ?? []` + getChats().catch fallback (review minor 4).

## Minors (all)
1. pn normalization (done in M3).
2. status real fetch or read-only (done in M3).
3. privacy rows: include `contact_blacklist` option where the bridge accepts it; map display correctly.
4. loader catch + include-media global check-row for the picker (spec'd originally) — add the check-row, wire it into the picker's create call.
5. escape initials(...) at pages.ts:501 like :149 does.
6. CSS regressions from the redesign: restore `.chat-main { flex:1; min-width:0 }`, `.messages` max-height/overflow-y + `.send-box` sticky, and a narrow-viewport breakpoint for the fixed #nav (the ≥720px media query that was deleted — mobile gets top nav or stacked).
7. Add styles for the orphaned markup: `.me-card`, `.me-fields`, `.privacy-settings`, `#sub-chat-picker` (list-style none etc.); remove the CSS-only rules that have no markup OR add the markup (`.brand`, `.nav-group`, `.section-label`, `button.primary` — add the markup in app.ts renderFrame: brand row at nav top, section labels, primary/secondary button classes on real buttons).
8. `.archived-toggle` → add class="check-row" and delete the duplicated rules.
9. Dead code: remove `privacyMatrixHtml` + its overhaul.test.ts usage (replace that test's assertions with profilePageHtml-based ones); remove the dead bindProfileControls name/privacy handlers (superseded by B1 wiring); replace the `me as {pn…}` cast with a typed result; type the socket user access properly in http.ts (extend the existing handle type if there's one, no ad-hoc cast).
10. formatStatValue: run the array check BEFORE the key special cases; add a space after nested-object colons (`a: b: 1` → readable form); guard non-numeric pairingAttempts (NaN/NaN → "—").
11. Strengthen t141 assertions: exact `<dd>` contents instead of toContain("2")/toContain("no").

## Gates (orchestrator re-runs all; self-reports are not proof)
- `npx vitest run packages/web-ui/ packages/bridge/` green
- `vp check` 0; `pnpm --filter @wa-mcp/web-ui build` + bridge build EXIT 0
- webui-e2e + dogfood stay green (orchestrator runs live)
- Zero comments in source; TDD where behavior changes (B1 handlers, M1+M2 latch, M3 me, M4 picker); version untouched; do NOT commit.
