# CLAUDE-REVIEW-2 — WebUI usable-round (c0cd9f8) + opus-review fixes (eb5d1e9)

Reviewer: Claude (independent, read-only). Method: `git diff 5fb7558..HEAD` over
`packages/web-ui/src`, `packages/bridge/src`, `packages/mcp-server/src`, plus
reading the matching bridge routes and the new tests. No tests, builds or
installs were run, so every claim below comes from reading the code.

## VERDICT: NOT CLEAN

No blocker. The B1 dead-handler class is fixed: every selector bound in
`bindProfileControls` has matching markup, and every client method's URL and
payload matches its bridge route. There are 3 majors, mostly in stale-token and
exchange handling plus one dead control that the sweep missed, and several minors.

## BLOCKERS
None.

## MAJORS

1. **Dead control: `#sub-include-media` is never read.**
   - `pages.ts` (`globalMedia`, ~L526) renders `<input type="checkbox" id="sub-include-media">`.
   - `main.ts` never references that id. The picker `change` handler (~L1060) calls
     `createSubscription({ chat_jid, kinds: ["message"] })` with no `include_media`.
   - Repro: tick "include media", toggle a chat on, and the subscription is created with
     `includeMedia=false`. This is the same bug class as B1, and the sweep missed it.

2. **`staleTokenCleared` is a one-shot flag that is never reset** (`main.ts` ~L108-116).
   - After the first clear and a successful re-exchange, the page holds a fresh token.
   - If the daemon restarts again while the tab is open, the token rotates and every call
     returns 401. `clearStaleTokenOnce` returns early, so the user stays on 401s until a
     manual reload. This is the "stranded" class M2 was meant to close.
   - Fix idea: reset `staleTokenCleared = false` after a successful exchange.

3. **`clearStaleTokenOnce` can wipe a manually entered account token.**
   - Any 401 clears `settings.token`. For owners on `WA_UI_BOOTSTRAP=0`, the bridge's own
     message says to "configure the account token in the web UI settings".
   - One 401 from any endpoint (for example a scope mismatch) wipes that token. The
     re-exchange then gets 403, which is terminal (`classifyExchangeFailure`, `state.ts:83`).
   - The user ends up token-less, and the exchange can never succeed this page load.
   - There is also a race: a late 401 from an old in-flight client can clear a token that
     was just exchanged. This is plausible but not verified.

4. **Privacy selects can show a wrong state** (`pages.ts` `PRIVACY_ROWS` ~L330).
   - `profile` and `status` rows omit `contact_blacklist`. `groupadd` omits `none`.
   - The bridge accepts `contact_blacklist` for lastSeen, profilePic, status and groups,
     and `none` for groups (`WAPRIVACY_ALL`, `profile.ts:12`).
   - When the live value is not an option, no `<option selected>` exists. The browser then
     shows the first option, "all", for a setting that is actually restricted. For a
     privacy control this misreports the setting.
   - `state.ts` `PRIVACY_VALUES` has the right lists, but only `privacyOptionsFor`, which
     is test-only, uses them. The page duplicates and diverges from it.

## MINORS

1. `state.ts:92` `shouldExchange` ignores `loggedIn`, yet the field is in `ExchangeState`
   and the doc comment (`state.ts:77-79`) says "retries on the next sync once loggedIn".
   - The tests pin that behaviour (t142 L21, t145 L51), so the code and tests agree and the
     comment is wrong.
   - In practice an unpaired daemon now triggers `/api/ui-token` on every render.
2. An exchange 401 is non-terminal with no `retryAfter`. It calls `onUnauthorized`, which
   calls `renderCurrent` (debounced to 500ms), which retries the exchange. That loops at
   about 2 requests per second until the bridge's 10/min exchange cap returns 429
   (`http.ts` ~L2371). It is bounded but noisy.
3. `main.ts` `deleteSubscriptionForChat` uses `find`, so it deletes only the first match.
   The page already computes `data-sub-ids` for all of a chat's subscriptions. If a chat
   has two subscriptions (for example one created via Advanced), unticking removes one and
   the box re-renders ticked.
4. Picker toggles are not serialized or disabled while the request is in flight. The
   `renderCurrent()` after each toggle also resets the filter text and scroll position.
5. `main.ts` loader `.filter((c) => !c.jid.endsWith("@lid"))` throws on a chat without a
   `jid`. A subscription on an `@lid` chat cannot be unticked from the picker, because
   that chat is filtered out.
6. `/api/me` (`http.ts` ~L3442) awaits `socket.fetchStatus` with no local timeout. If the
   socket is half-dead the call blocks for Baileys' query timeout, and the profile loader
   `Promise.all` stalls the whole page. It also passes `socket.user.id` with the device
   suffix (`:N@s.whatsapp.net`). Whether `fetchStatus` normalizes that was not verified.
7. `auth.ts` `readOwnIdentity`:
   - It does not check the server part. If `me.id` is `…@lid`, `pn` becomes LID digits.
   - It can return `pn: ""` for an id like `"@s.whatsapp.net"`.
   - It uses sync `readFileSync` on the request path (small file, acceptable).
   - Malformed JSON and missing creds both return nulls cleanly.
   - Exposure: the response is only `{pn, name, status}` from `creds.me`, and no key
     material leaks. The route sits behind the auth gate, with the other profile routes.
8. `main.ts` `renderCurrent` catch (~L327) interpolates `err.message` into `innerHTML`
   unescaped. It is pre-existing, and the earlier review's item 22551 still stands.
   Escape it.
9. The block form and the unblock button swallow errors (`.catch(() => undefined)`), unlike
   the new save handlers, which surface errors. A failed unblock looks like a no-op.
10. Lint-sweep behaviour changes (all small, none in the hot path):
    - `mcp-server/src/tools.ts` ~L1629: a non-string `chat_jid` is now silently dropped
      instead of stringified.
    - `tools.ts` ~L176: a non-string bridge error message becomes "unknown" instead of
      `String(obj)`.
    - `bridge/src/store/export.ts` L30-32: a non-string `chat_jid` or `timestamp` becomes
      `""`. A numeric `timestamp` column would silently export empty. Schema TEXT makes this
      unlikely, but the code is now lossy where before it was not.
    - `bin.ts` ~L129: a non-string `payload.kind` falls back to "image".
11. `pages.ts` `initial = charAt(0)` splits surrogate pairs, so an emoji name gives a broken
    avatar glyph. Cosmetic.

### Verified OK
- Selectors: every `getElementById` and `querySelector` in `bindProfileControls` and
  `bindSubscriptionsControls` has matching markup, except `sub-include-media` above.
- API shapes:
  - block and unblock: `/api/block` with `{jid, block:bool}` (`http.ts:1948`).
  - profile name and status: `/api/profile` with `{name}` / `{status}` (`http.ts:1902`).
  - privacy: `POST /api/privacy` takes a patch keyed by `PRIVACY_KEYS` write names
    (`PRIVACY_READ_TO_WRITE` is correct against `profile.ts`).
  - me: `GET /api/me`.
  - subscriptions: `createSubscription` takes `chat_jid` and `kinds`.
- XSS: picker rows, the me-card and the count header all use `escapeHtml`. The count is
  numeric. Unescaped values in `PRIVACY_ROWS` come from constants.
- Auth ordering: `/api/me` sits after the auth and rate gates, in the same block as the
  other profile routes.

## TEST-GAPS

- There is no DOM environment, so none of these are tested: `bindProfileControls`,
  `bindSubscriptionsControls`, `deleteSubscriptionForChat`, `clearStaleTokenOnce`,
  `exchangeAccountToken` wiring and `renderCurrent`.
  - The only coverage is the pure helpers (`shouldExchange`, `classifyExchangeFailure`,
    `buildPrivacyPatch`).
  - That is why the dead `sub-include-media` control and the one-shot stale-token flag got
    through. A jsdom or happy-dom smoke test that clicks each control would catch this
    class of bug.
- t143's "drift guard" compares `PRIVACY_READ_TO_WRITE` against a list hard-coded in the
  test, not against the bridge's `PRIVACY_KEYS`. It guards nothing if the bridge changes.
  `privacyOptionsFor` is exercised only by tests, and `pages.ts` does not use it. Nothing
  asserts that the page options match the bridge's allowed values (major 4).
- t145 and t142 test pure verdicts only. There is no test for:
  - `ApiError` 401 in the exchange path,
  - the loop in minor 2,
  - re-clearing after a second rotation (major 2),
  - a manual token with a 403 (major 3).
- `readOwnIdentity` and `/api/me` tests (`http.test.ts`) should cover a `…@lid` id, a
  device-suffixed id, an empty id and a `fetchStatus` rejection. I did not confirm which of
  these exist.
- The `export.ts` and `tools.ts` typeof conversions have no test pinning the new
  non-string behaviour.
