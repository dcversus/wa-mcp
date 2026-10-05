Permission allow rule (.claude/settings.local.json): Write(**) is not matched by file permission checks — only Edit(path) rules are. Use Edit(**) instead (Edit rules cover all file-editing tools).
# Review: WebUI usable-round — not clean

The tests pass, but the profile page's edit controls do nothing, and the W1 latch fix doesn't do what its name and comments say. I checked the code against the diff (main.ts, http.ts, profile.ts, store/messages.ts, schema.ts, api.ts). I didn't run anything.

## BLOCKER

**B1. The new profile controls are never wired up — `main.ts:663-677`, `pages.ts:351-362`**
- `bindProfileControls` still binds `#name-form` and `#privacy-form`, which no longer exist, so both handlers are dead.
- Nothing listens on `#save-name`, `#save-status` or `select[data-privacy-key]`. Name, status and privacy are display-only.
- The commit message says the selects "post to /api/privacy". They don't.
- Wiring them isn't enough on its own:
  - There is no client method that sets status (only `setProfileName`).
  - `client.setPrivacy` posts `{privacy_key, value}` (`api.ts:201`). `updatePrivacy` expects a patch like `{lastSeen: "all"}` (`profile.ts:72-93`), so every call would get a 400.
  - The read-side keys (`last`, `profile`, `groupadd`, `calladd`, `readreceipts`) differ from the write-side keys (`lastSeen`, `profilePic`, `groups`, `calls`, `readReceipts`). A mapping is needed.
- Tests miss this: there is no handler test, dogfood only checks that pages render, and `api.test.ts:220` asserts the broken `read_receipts` request shape.

## MAJOR

**M1. The W1 latch only exists while a request is in flight, and nothing stops the retries — `main.ts:67,84,95`, `state.ts:73-80`**
- `accountTokenExchanged` is set `true` at :84. Then either a token is saved, or the catch at :95 resets it to `false`. Outside an in-flight call it is never `true`.
- So `latched && !loggedIn` only stops concurrent calls before login. After login it stops nothing, and two concurrent renders both exchange.
- The doc comment ("a failure latches only until loggedIn") is false. The first t142 test checks a state that never persists at runtime.
- Also, `syncPairingToken` no longer checks `loggedIn` first. The actual behaviour is now: exchange on every render whenever the stored token is empty.
- **Retry storm:** permanent failures are now retried on every `renderCurrent`:
  - 403 FORBIDDEN_HOST, when the UI is opened from a non-loopback origin.
  - 403 PAIRED, when `WA_UI_BOOTSTRAP=0`.
  - 429 from the exchange limiter. `ApiError.retryAfterMs` is ignored.
- `renderCurrent` runs on every hash change, on the 5s status poll, on each 401 (`onUnauthorized`, 500ms debounce) and after every handler.
- Each retry costs a `/health` call plus a `/api/ui-token` call. The exchange bucket is per-IP and holds 10 per minute (`http.ts:195,2373`). A stuck tab drains it and blocks other tabs from getting a token.
- The comment at `main.ts:70-72` ("one exchange attempt per page load … instead of retrying in a loop") now contradicts the code.
- **Fix:** classify the failure.
  - 403: latch for the rest of the page load.
  - 429: wait for retry-after.
  - Network error, or `loggedIn` changing from false to true: retry once.

**M2. A stale stored token still leaves the UI stuck on 401 — `state.ts:73-75`, `http.ts:470`**
- `uiToken = opts.uiToken ?? randomBytes(...)`, and no caller passes `opts.uiToken`, so the token changes on every daemon boot.
- After any daemon restart, `settings.token` in localStorage is stale. `shouldExchange` returns false for any non-empty token, so every call gets a 401. `onUnauthorized` only re-renders, which shows the inline token form.
- This is a likely real cause of the owner's paired-then-401 bug, since re-pairing usually means a restart. The W1 explanation is a guess ("IF an exchange attempt fires…"), and the live check probably started with a clean localStorage.
- **Fix:** on a 401 while holding a stored session token, clear it once per page load and exchange again using the bootstrap token.

**M3. The `/api/me` name fallback returns someone else's phone number — `http.ts:3447-3455`, `store/messages.ts:34-57`**
- When there is no pushName, `senderNameOf` falls back to the digits of `senderJidOf(key)`, which is `key.participant ?? key.remoteJid`.
- For a message I sent in a 1:1 chat, that is the recipient's JID.
- Messages sent by the bridge are stored with `pushName: undefined` (`http.ts:2494`). So the newest sent-by-me row usually has `sender_name` set to the last recipient's phone digits.
- `IS NOT NULL` doesn't filter these out. The profile then pre-fills that number into the editable name field. Once B1 is wired, one click on save would set the owner's WhatsApp name to a contact's number.
- The ORDER BY is present and correct (timestamps are ISO TEXT).
- Two smaller problems:
  - There is no index on `messages`, so each call does a full scan and sort.
  - The query runs even when `socket.user.name` is already known.
- The fallback has no test. The first test sets `socket.user.name`, so its `UPDATE … sender_name` seed has no effect; the second test has no rows.
- **Fix:** drop the fallback. Read `creds.me` (id and name) from the auth state instead, which also works while disconnected.

**M4. Picker toggles are racy and fail silently — `main.ts:978-1004`**
- Double-clicking a checkbox fires two `createSubscription` calls before the re-render, creating duplicate subscriptions.
- If a chat has more than one subscription (picker plus advanced form), unchecking deletes whichever is first in `activeSubRows`, possibly the custom-kinds one. The box stays checked.
- A subscription created elsewhere after the page loaded isn't in `activeSubRows`, so unchecking it silently does nothing.
- Errors from create or delete aren't caught. The result is an unhandled rejection, with the checkbox showing a state the server doesn't have.
- An all-chats subscription is left out of `subscribed` (`pages.ts:495`), so every row shows unchecked. Checking one then creates a second, overlapping per-chat subscription.
- **Fix:**
  - Disable the input while its request is in flight.
  - Store the subscription ids for each chat on the row.
  - Catch errors and revert the checkbox.

## MINOR

1. **`http.ts:3446`** — `pn` is the raw `socket.user.id`, which includes the device suffix (`358…:12@s.whatsapp.net`). The UI labels it "phone". Normalise it and strip the domain. The test fixture has no suffix, so it misses this.
2. **`http.ts:3457`** — `status: null` is hard-coded, but Baileys' `fetchStatus(ownJid)` is a single IQ call. Once wired, the always-empty about field invites the owner to overwrite their real status by accident.
3. **`pages.ts:316-325`** — The `profile` and `status` rows leave out `contact_blacklist`, which the bridge accepts (`profile.ts:12`). A live value of `contact_blacklist` would display as "all", misreporting the setting.
4. **`main.ts:424-430`** — `getChats()` in the subscriptions loader has no catch, and `.chats` is cast without `?? []`. If chats fail to load, the whole subscriptions page fails. The spec's global "include media" check-row for the picker was not built; picker subscriptions never include media.
5. **`pages.ts:501`** — `initials(...)` is not escaped here, while `:149` escapes it. A two-character tag fragment (a name like `< a`) breaks the DOM. It can't run script, but it's an inconsistent injection path.
6. **The redesign removed rules that markup still uses:**
   - `.chat-main` lost `flex:1; min-width:0`, which breaks the preview ellipsis and the time alignment in chat rows.
   - `.messages` lost `max-height`/`overflow-y`, and `.send-box` lost `sticky`. Long threads now push the send box off-screen.
   - The fixed `#nav` has no narrow-viewport breakpoint (the old ≥720px media query was deleted), so it overlaps content on small screens.
   - e2e can't catch any of these.
7. **CSS with no matching markup:** `.brand`, `.nav-group`, `.section-label` and `button.primary` exist only in CSS. The commit's "brand row + grouped links" and primary/secondary buttons were never put into `app.ts`/`pages.ts`. Conversely, `.me-card`, `.me-fields`, `.privacy-settings` and `#sub-chat-picker` have no styles; the picker `ul` still shows bullets.
8. **`.check-row` coverage:** it is used on 3 labels (picker rows plus the 2 advanced-form labels), not 4. The archived toggle uses its own `.archived-toggle` class, which copies the `.check-row` rules. Add `class="check-row"` there and delete the copy.
9. **Dead code and laundering casts:**
   - `privacyMatrixHtml` (`pages.ts:421`) is now used only by `overhaul.test.ts`.
   - `bindProfileControls`' name and privacy handlers are dead.
   - `me as {pn…}` (`main.ts:339`) launders the optional fields `getMe()` returns.
   - `handle.socket as {user?…}` (`http.ts:3442`) also launders a type.
10. **`formatStatValue` (`pages.ts:44-70`):**
    - Escaping is correct at both call sites, and recursion is safe for JSON data.
    - The key special cases run before the array check, so an array under `subscriptions` would collapse to "0".
    - The special cases also fire on nested keys (`meta.subscriptions`).
    - Nested objects flatten without delimiters, e.g. `a: b: 1, c: 2`.
    - A non-numeric value renders as "NaN / NaN".
11. **Weak t141 assertions** — `toContain("2")` passes because of "912", and `toContain("no")` matches many strings. Assert the exact `<dd>` contents instead.

## NIT

- `let activeSubRows` (`main.ts:978`) is declared after the top-level `void renderCurrent()`. It only avoids a temporal-dead-zone error because the loader runs after an `await`. Move it up next to the other module state.
- `#app > h2` and `#app > h3` never match, because every page wraps its heading in a `<section>`.

## Confirmed fine

- **`/api/me` auth scope:** it sits behind the bearer check (`http.ts:2529-2539`). It accepts the account token or the UI token, not the pairing or bootstrap token, and the host/origin guard applies. Under ADR 0012 the UI token is already full-surface, so exposing pn and name adds nothing.
- **Multi-tab token pickup:** `renderCurrent` reloads settings from localStorage, so a token minted in another tab is picked up.
- **Selectors:** all the ids and classes tests query are still present.

Suggested fix order: B1, then M3, then M1+M2 together (they belong in one error-classification change), then M4, then the minors.

Two MCP servers need attention, though this review didn't use them. The Telegram plugin server failed to connect. Several claude.ai connectors (Figma, Gmail, Notion, and others) need authorizing in claude.ai connector settings, and context7 needs authorizing via `/mcp`.
