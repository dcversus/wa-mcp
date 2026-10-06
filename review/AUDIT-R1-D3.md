# AUDIT R1 — D3 Quality assurance, deep manual (independent)

Auditor: opus (fresh eyes) · Date: 2026-10-06 · Target: live daemon v0.9.0 at
http://127.0.0.1:8080 (paired, connected), served bundle `assets/index-CLRp372T.js`.
D1 (`review/AUDIT-R1-D1.md`) and D2 (`review/AUDIT-R1-D2.md`) findings are
referenced as "(D1 #n)" / "(D2 #n)" and are not re-argued.

## Method and evidence base

- **Live, clean browser.** Headless Chrome driven over raw CDP (the D1 harness
  pattern). Every probe uses a brand-new `--user-data-dir`. The harness and
  probes are `/tmp/audit-d3/lib.mjs` and `p01…p10.mjs`. Raw JSON results are in
  `/tmp/audit-d3/r01-routes.json`, `r02-controls.json`, `r04-states.json`,
  `r05-kbd-a11y.json`, `r07-send.json` and `r08-429.json`. Screenshots are in
  `/tmp/audit-d3/*.png`. Tokens are redacted in every dump.
- **Limitation, screenshots:** the session sandbox blocks the image viewer for
  `/tmp`, so I could not *look* at the PNGs. Every visual claim below rests on
  computed styles, `getBoundingClientRect` geometry, WCAG contrast math or DOM
  text. The PNGs are there for a human reviewer.
- **Limitation, daemon stop:** `launchctl` needed approval and was denied in
  this non-interactive run, **so the daemon was never stopped and no restore
  was needed.** I simulated "daemon down" three ways instead:
  1. Block `/api/*` and `/health` mid-session with `Network.setBlockedURLs`.
  2. Point `bridgeUrl` at a dead port (fresh load).
  3. CDP offline emulation.
  After all probes, `/health` returned 200 with `connected:true` and uptime
  still counting (89 635 s), so the daemon never restarted.
- **Writes to the account, all disclosed:**
  1. **One live send to the Test group** (`120363428874442773@g.us`):
     `D3 QA probe · Привет мир · مرحبا بالعالم · 🎉👍🏽 · x×140`.
  2. **One accidental junk subscription.** The Advanced form accepted
     `chat_jid = not-a-jid` with **201** (finding 9). I removed it at once
     through the UI's own "remove" button (204). The subscription count is
     back to 1.
  3. `POST /api/block {jid:"not-a-jid"}` returned 500 and blocked nothing.
  4. About 1 200 burst requests across three 429 probes. The bucket recovered
     within 3 s.
- **Code anchors:** `file:line` refers to commit **`9a023b8`**. The FIX-R1
  wave is editing `pages.ts` and `main.ts` in the worktree during this audit
  (for example, `pages-pairing.ts` now imports an `agentConnectHtml` that
  `pages.ts` does not yet export), so worktree line numbers drift. Function
  names are given so each anchor can still be found.
- **The live bundle predates the D1 fix wave.** Everything below is what a
  user gets *today*.

---

## VERDICT

**Not shippable as a daily-use UI.** It is visually tidy, and it degrades
gracefully when the daemon dies or the token is stale. Under the paint,
though, it has three classes of QA failure that D1/D2 did not cover:

1. **It shows wrong data without saying so.** Chat-list times are UTC
   rendered as if they were local (20:03 shown at 23:03 local). Under a 429,
   Profile renders an empty name and every privacy setting as "all", and
   Subscriptions renders "No chats yet" with zero subscriptions. None of
   these shows an error.
2. **State leaks between views.** A no-match contact search leaves an
   invisible filter that survives navigation until a full reload. The events
   "pause" label resets while the feed stays paused. Focus is dropped after
   every send.
3. **Keyboard and assistive-tech users can't do the primary jobs.** Chat and
   group rows are click-only `<li>`s (tabIndex −1, no role). Input focus
   rings are 1.13:1. Most inputs are unlabeled. There is no page `h1`.

**Known-dead controls, re-verified live:** chat rows, search, the archived
toggle, reply, context, download, participant remove/promote and transcribe
are **all still dead** in the served bundle (table below). The archived
toggle has a second, latent bug: its CSS selector can never match, so it
stays broken even after the routing fix lands.

The copy is a developer console throughout: raw ISO timestamps, epoch
milliseconds, JIDs, enum values and "bridge/daemon/token". The design system
has tokens, but about half the markup ignores them: 7 font sizes, 3 radii,
browser-default bullets on 5 lists, and only one primary-styled button in the
whole app.

### Known-dead re-verification (live, this bundle)

| Control | D1/D2 ref | Live result now |
|---|---|---|
| Chat row click | D1 #1 | hash stays `#/chats`, no network (`r02.chatRowClick`) — **still dead** |
| Chat search | D1 #7 | native GET → `/?query=Lol#/chats`, 3 rows, input cleared — **still dead** |
| Show archived | D1 #7 | checkbox ticks, `ul` class unchanged, no re-render — **still dead** (+ new CSS bug, finding 13) |
| Reply (click message) | D1 #6 | placeholder stays `""` — **still dead** |
| Context button | D1 #6 | 0 requests, no `#context-view` — **still dead** |
| Download button | D2 #11 | 0 requests, label unchanged (handler never bound) — **still dead** |
| Participant remove / promote | D2 #8 | 0 requests — **still dead**. "add" posts `{group_jid}` only; the typed participant is never sent (`main.ts:695`) |
| Transcribe | D2 #11 | 0 `.transcribe-btn` in DOM — **absent** |
| Chat view scroll | D1 #6 | `scrollTop 0 / max 1969`: opens at the oldest message — **still broken** |

---

## FINDINGS (sorted by severity)

Format: **[severity · type · effort]**. "Live" means it was reproduced in the
clean-browser probe. *(code-path)* means it was reasoned from source.

### P1 — wrong data, lost state, unreachable primary actions

#### 1. [P1 · DEFECT · S] Chat-list times are UTC shown as local time, with no date
- **Live repro:** I sent a message at 23:03 local (GMT+3). The Chats list
  showed `20:03` for it (`r07.listPreview = {time:"20:03", localNow:"23:03"}`).
  A message from 5 Oct shows only `19:02`, which is indistinguishable from
  "today".
- **Cause:** `chatListHtml` does `chat.lastMessage.timestamp.slice(11, 16)` on
  an ISO-`Z` string (`pages.ts:175-176`).
- **Impact:** every user not on UTC sees wrong times, and old chats look
  recent. This is a trust breaker for a messaging UI.
- **Fix:** add one `formatWhen(iso)` helper using `Intl.DateTimeFormat`:
  today → `HH:MM` local, last 7 days → weekday, older → `6 Oct`. Use it in
  the chat list, bubbles, context view, day separators and events (see the
  consistency table).

#### 2. [P1 · DEFECT · S] Read failures render as real-looking data: Profile and Subscriptions lie under 429/5xx
- **Live repro (p09):** burst `/api/chats`, then open the page.
  - **Profile:** `/api/privacy`, `/api/blocklist` and `/api/me` all return
    429. The page renders `display name = ""`, phone `—`, and all 8 privacy
    selects = `all`, with **no error banner**.
  - **Subscriptions:** `/api/subscriptions` and `/api/chats` return 429. The
    page renders "No chats yet — they appear after messages arrive" and **zero
    subscriptions**, with **no banner** (`09-subs-429.png`).
- **Cause:** per-call `.catch(() => emptyValue)` inside loaders hides the
  error from `guardLoader`: `main.ts:378-380` (profile), `455` and `468`
  (subscriptions), and `360` (status notifications).
- **Impact:** the owner may conclude that their agent subscription
  vanished and re-create it (or create duplicates). They may also change a
  privacy select believing the current value is "Everyone". D2 #15 covers
  *mutation* failures; this is the read side, and it is worse because it is
  convincingly wrong rather than merely silent.
- **Fix:** let these reject so `guardLoader` shows the banner. If partial
  render is wanted, render a per-section "couldn't load — retry" instead of a
  default value. Disable privacy selects whose value is unknown.

#### 3. [P1 · DEFECT · S] Contacts search leaves an invisible, sticky filter
- **Live repro:**
  1. Contacts → search `zzzz-nomatch` → Enter. The page now reads "No
     contacts yet — they appear after you chat", and the search box is
     **empty** (`inputAfter: ""`).
  2. Navigate away and back to Contacts. It still reads "No contacts yet"
     (`r02.contactsPersist`).
  Only a full reload clears it.
- **Cause:** `contactsQuery` is module state (`main.ts:285`, `371`), but
  `contactsPageHtml` never echoes it into the input (`pages.ts:135`). The
  empty state can't tell "no contacts" from "no matches" (`pages.ts:133-134`).
- **Impact:** the user believes their contacts are gone, with no visible way
  back.
- **Fix:**
  - Echo the query into the input.
  - Show the empty state as "No contacts match "zzzz" · Clear search".
  - Reset the query on route entry, or keep it in the hash
    (`#/contacts?q=`).

#### 4. [P1 · A11Y · S] Chats and groups can't be opened from the keyboard
- **Live repro:** Tab from page load gives 9 nav links → chat search →
  archived checkbox → `body` → nav again (`r05.tabChats`). Chat rows have
  `tabIndex -1, role null` (`r05.chatRowFocusable`). Group rows
  (`li[data-group-jid]`, which opens participants) are the same. There is
  no skip link.
- **Cause:** rows are click-handler `<li>`s (`pages.ts:180`, `144`,
  `main.ts:554-560`, `656`).
- **Impact:** even after D1 #1's routing fix, a keyboard or switch user still
  can't open any chat. The group-row toggle is mouse-only as well.
- **Fix:** render each chat row as `<a href="#/chat/<jid>">` (this also fixes
  D1 #1 without JS). Make the group details toggle a `<button
  aria-expanded>`. Add a "Skip to content" link.

### P2 — misleading or degraded behaviour

#### 5. [P2 · DEFECT · S] Sending a message drops focus and strips chat features
- **Live repro:** type in the composer and press Enter (a real key event).
  The send succeeds (`200 /api/send`) and the input clears, but
  `document.activeElement` is `BODY` (`r07.after.active`). A second message
  needs a mouse click first.
- **Cause:** the success path replaces `#app.innerHTML` with
  `messageListHtml(chatJid, payload.messages)` and rebinds only the send box
  (`main.ts:590-593`). That re-render also:
  - drops `mediaToken`, so any image, voice or sticker in the chat loses its
    authenticated URL after a send *(code-path)*;
  - skips the `quoted`/`reactions` mapping done in the loader
    (`main.ts:415-423`);
  - skips `bindChatExtras`.
- **Fix:** append the new bubble, or call the same loader path. Keep the form
  node. `input.focus()` after success.

#### 6. [P2 · DEFECT · S] Raw machine timestamps everywhere else
- **Live:** every bubble shows `2026-10-06T20:03:40.000Z` (`r07.after.time`).
  Day separators show `2026-10-03`, uppercased by CSS. Status and Events show
  `2026-10-06T19:56:38.918Z`. Status shows `UPTIME 89054` and
  `LASTDISCONNECTAT 179…` in epoch ms.
- **Code:** `pages.ts:222`, `257`, `273`, `120`, `438`; `main.ts:220`;
  `formatStatValue` (`pages.ts:64-101`), which has no time/duration branch.
- **Fix:** the `formatWhen` helper from finding 1. Day separators should read
  "Today / Yesterday / Mon 5 Oct". Uptime should read "1 d 0 h". The last
  disconnect should read "2 h ago". (D1 #12 covers the Status dump as a
  whole.)

#### 7. [P2 · PRODUCT · S] Error states are developer text with no way forward
- **Live:**
  - **Daemon down** (`r04.downEarly`): banner "bridge unreachable at
    http://127.0.0.1:8080 — is the daemon running?" plus page body "⚠ could
    not load this page: Failed to fetch". There is no retry button and no
    command to run. The banner only clears when the user *navigates*
    (`renderCurrent`, `main.ts:337-343`), because nothing polls while down.
  - **Network off** (CDP offline): the same banner blames the daemon.
  - **429** (`r08`): "⚠ could not load this page: rate limit exceeded",
    although the server sent `Retry-After: 1`. No auto-retry, so the user
    must click away and back.
- **Fix:**
  - Human copy (copy table).
  - A "Retry" button inside `errorBannerHtml`.
  - While `bridgeDown`, poll `/health` every 2 s and re-render on recovery.
  - Auto-retry 429 once after `retryAfterMs`. `ApiError` already carries it
    (`api.ts:130-138`).

#### 8. [P2 · PRODUCT · M] No loading state: the old page stays under the new URL
- **Live (throttled 2.5 s latency, p04-E):** after clicking Contacts, the URL
  is `#/contacts` but the app still shows the **Chats** list at +0.7 s and
  +3.7 s. Contacts appears at about 9.7 s. The nav highlight is stale too,
  because `renderFrame` sets the nav only after `syncPairingToken`.
- **On loopback:** navigation takes 11-190 ms (`r05.navLatency`; Profile is
  slowest because it fans out to WhatsApp).
- **Cause:** each navigation waterfalls `/health` (plus a possible
  exchange), then the loader (`main.ts:329-336`). Nothing is painted until
  both finish.
- **Impact:** Profile, group info and privacy hit WhatsApp and can be slow,
  so users double-click or think the click failed.
- **Fix:** set the nav and a skeleton/spinner immediately on `hashchange`.
  Skip the `/health` pre-flight when a valid token is already held.

#### 9. [P2 · DEFECT (server) · S] Bridge accepts garbage JIDs: 201 for a subscription to `not-a-jid`, 500 for blocking it
- **Live:**
  - The Advanced subscription form with `chat_jid=not-a-jid` returned
    `201 /api/subscriptions`. The row appeared as `6f9d86f44a69 — not-a-jid
    ·` (I removed it).
  - The Profile block form with `not-a-jid` returned `500 /api/block`. The
    UI re-rendered silently (UI half is D2 #15).
- **Code:**
  - `http.ts:3526` only checks `typeof chat_jid === "string"`.
  - `http.ts:1949` only checks non-empty, so Baileys throws and the result
    is a 500.
- **Impact:** a typo creates a subscription that can never fire, and it looks
  identical to a working one. A 500 for user input pollutes error telemetry.
- **Fix:** add a shared `isJid()` / phone-normaliser in `@wa-mcp/shared`.
  Return 400 with "That doesn't look like a WhatsApp number or group".

#### 10. [P2 · DEFECT · S] Events "pause" label lies after the 5 s refresh
- **Live:** click "pause" (label becomes "resume"), then "clear", then wait
  6 s. The label reads **"pause"** while `eventsPaused` is still `true`
  (`r02.eventsClear.afterPoll`). Clicking "pause" now *resumes*.
- **Cause:** `eventsPageHtml` always renders "pause" (`pages.ts:441`), and
  the `/events` poll re-renders every 5 s (`main.ts:227-231`).
- **Fix:** pass `paused` into `eventsPageHtml`. Better: don't re-render the
  page on a timer; the SSE stream already updates `#events-feed`.

#### 11. [P2 · DEFECT · S] Copy buttons give no feedback and throw unhandled
- **Live:** clicking Subscriptions "copy" leaves the label as "copy". The
  rejection `NotAllowedError: … writeText … denied` is uncaught
  (`r02.exceptions`). On a normal browser a successful copy is equally
  silent.
- **Code:** `main.ts:1147-1151` (`void navigator.clipboard?.writeText(...)`
  with no `.then`/`.catch`) and the pairing `copy-btn` at `main.ts:971-974`.
- **Impact:** this is the hero-path command (D2 #3). The user can't tell
  whether it copied.
- **Fix:** "Copied ✓" for 2 s. On failure, select the text and say "Press
  ⌘C".

#### 12. [P2 · DEFECT · S] "download" and "context" render on every message, including plain text; media gets two "download" buttons
- **Live:** in the Test group, 50 of 50 text-only messages carry a "download"
  button (`r02.chatView.textMsgsWithDownload = 50`).
- **Code:**
  - `messageListHtml` appends `context` + `download` to every `<li>`
    (`pages.ts:257`).
  - The media branch already added one (`pages.ts:243`), so media rows get
    two.
- **Impact:** currently dead (D1 #6). Once bound, "download" on a text
  message posts `/api/media/<id>`, fails, and still says "downloaded ✓"
  (D2 #11).
- **Fix:** render "download" only in the media branch. Show "context" on
  hover/focus, or move it into a per-message "⋯" menu.

#### 13. [P2 · DEFECT · S] "Show archived" can never work: the CSS selector matches nothing *(latent behind D1 #7)*
- **Code:**
  - `styles.css:276` has `.chat-list li.hide-archived[data-archived="true"]
    { display:none }`.
  - The markup puts `hide-archived` on the **`ul`** (`pages.ts:183`) and
    writes `data-archived="1"` (`pages.ts:178`).
  - So nothing is ever hidden, and the checkbox is a no-op even after
    `bindChatsControls` is reachable.
- **Live:** `{ulClass:"chat-list hide-archived", archivedRows:0}`. This
  account has no archived chats, so the CSS half is a code-path finding.
- **Fix:** `.chat-list.hide-archived li[data-archived="1"] { display:none }`,
  plus a test that renders one archived chat and asserts it is hidden.

#### 14. [P2 · A11Y · S] Contrast and focus visibility fail WCAG AA in the token set
- **Computed** (`styles.css:3-25`, standard WCAG formula):

| Pair | Ratio | Where | Requirement |
|---|---|---|---|
| focus ring `--accent-soft` on white | **1.13:1** | every input `:focus` (`styles.css:194-200`) | 3:1 non-text — **fail** |
| input border `--border-strong` on white | **1.47:1** | all inputs | 3:1 — **fail** |
| `--ok` #12b76a on white | **2.62:1** | "paired as…", "name saved" | 4.5:1 — **fail** |
| `--accent` on `--accent-soft` | 3.81:1 | active nav link (13px) | 4.5:1 — **fail** |
| white on `--accent` / accent on white | 4.32:1 | unread badge (11px), Send, links | 4.5:1 — **fail (marginal)** |
| `--text-dim` on `--surface-2` | 4.51:1 | day separators (11px) | pass (barely) |

- **Live:** input focus = `outline:none` plus a `box-shadow` of
  `rgb(234,241,255)`. Buttons keep the UA outline (visible).
- **Fix:**
  - Use `--accent` for the focus ring (`outline: 2px solid var(--accent);
    outline-offset: 1px`).
  - Darken `--ok` to about `#067647` and `--accent` to about `#1f5fe0`.
  - Set `--border-strong` to about `#98a2b3`.

#### 15. [P2 · A11Y · S] Missing labels, headings and landmarks
- **Live (`r05.a11y`):**
  - **Unlabeled inputs (placeholder only):** chat search, contact search,
    group subject, participant add, group meta subject/description. The
    **send box has no label and no placeholder** (`inputPh:""`,
    `inputLabel:0`).
  - **Headings:** `h1` count is 0 on every page. Chats, Contacts, Groups,
    Unread and Settings have no `h2`. `document.title` is always "wa-mcp".
  - **Nav:** no `aria-label`, and no `aria-current` on the active link.
  - **RTL:** Arabic text renders `direction:ltr` with no `dir="auto"` on
    bubbles or previews.
- **Fix:**
  - `aria-label` (or a visually hidden `<label>`) on every input.
  - One `<h1>` per page, matching the nav label.
  - `document.title = "<Page> · wa-mcp"`.
  - `aria-current="page"` and `<nav aria-label="Main">`.
  - `dir="auto"` on `.text`, `.chat-preview` and `.chat-name`.

#### 16. [P2 · PRODUCT · S] Phone-width layout buries content under the nav
- **Live (390×844):** the nav stacks vertically and is **451 px tall**.
  Content starts at y = 451. In a chat, the composer's top is at **921 px**,
  below the fold (`p06`). No horizontal overflow on real data.
- **Fix:** at ≤720 px, render the nav as a horizontal scroll strip or a
  menu button (about 48 px). Make the chat view `100dvh` with a sticky
  composer.

### P3 — robustness and polish

#### 17. [P3 · DEFECT · S] Long unbroken names blow out the layout *(simulated by DOM injection)*
- **Repro:** set one `.chat-name` to 60 × "Ж" plus a 180-char unbroken
  string. `#app` scrollWidth becomes 2156 (client 860), the page overflows
  horizontally by **1076 px**, and the time is pushed to x = 1676, off
  screen (`r05.longName`).
- **Cause:** `.chat-name` has no `min-width:0` / `overflow-wrap` / ellipsis
  (`styles.css:305-307`). Only `.chat-preview` truncates (`styles.css:315-321`).
- **Fix:** `.chat-top { min-width:0 } .chat-name { overflow:hidden;
  text-overflow:ellipsis; white-space:nowrap }`.

#### 18. [P3 · PRODUCT · M] Lists are not virtualized or paginated
- **Repro:** injecting 3 000 cloned chat rows took **761 ms** to lay out.
  `/api/chats` returns everything, with no paging (`main.ts:397-405`). The
  status poll re-renders the whole page every 5 s (`main.ts:264-269`), and
  the subscriptions picker renders every chat.
- **Fix:** cap at 200 with "show more" (or `content-visibility:auto` on
  rows). Add a `limit/offset` to `/api/chats`.

#### 19. [P3 · DEFECT · S] Empty submits are silent no-ops; no `required`/`maxlength` anywhere
- **Live:** each of these does nothing and shows no message:
  - empty "save name": no request, empty flash (`r02.saveNameEmpty`);
  - empty "create group";
  - empty Advanced "subscribe";
  - empty Send.
- **Code:** no form uses `required`, `maxlength` or `pattern`. The group
  subject has WhatsApp's 100-char limit but no `maxlength=100`, and the
  profile name has none (25).
- **Fix:**
  - Add `required` plus native constraint validation, and inline
    "Enter a name".
  - Add `maxlength` that matches WhatsApp limits (subject 100, about 139,
    name 25).
  - Disable Send while the box is empty.

#### 20. [P3 · DEFECT · S] The transcription form has no submit button, so it can't be saved even once reachable *(extends D1 #13)*
- **Code:** `transcriptionSettingsHtml` (`pages.ts:314-320`) has 4 fields and
  no `<button type=submit>`. Under HTML implicit-submission rules, Enter does
  not submit a multi-field form with no submit button, so the handler in
  `bindTranscriptionForm` (`main.ts:994-1024`) is unreachable.
- **Fix:** add a "Save" button and a success flash instead of
  `location.reload()`.

#### 21. [P3 · PRODUCT · S] Destructive actions with no confirmation, and one with a JID confirmation
- **Live:** "remove" on a subscription deleted immediately (204, no
  confirm). Notification-rule "delete" and "unblock" behave the same
  (`main.ts:787-793`, `749-755`). "leave" confirms with
  `leave group 120363428874442773@g.us?` (`r02.leaveGroup`, `main.ts:650`).
- **Fix:** add an undo toast (5 s) for remove/delete/unblock. Confirm leave
  with the group *name* and the consequence.

#### 22. [P3 · DEFECT · S] Subscription chat filter: no "no matches" state, and a stale counter
- **Live:** filtering by `zzzz` hides every row, but the counter still reads
  "2 chats — 1 subscribed" and no empty message appears
  (`r02.subFilterNoMatch`, `main.ts:1057-1063`).
- **Fix:** update the counter ("0 of 2 shown") and show "No chats match".

#### 23. [P3 · DEFECT · S] favicon 401 still floods the console (D1 #20)
- **Live:** 12 console errors in one route sweep, all `/favicon.ico 401`.
  Reference only.

---

## CONSISTENCY TABLE

Anchors are at `9a023b8`. The tokens in `styles.css:3-25` define a 4/8/12/16
spacing scale, an 8 px radius and colour roles. Font sizes and the
primary/danger roles have no tokens.

| # | Dimension | Inconsistency (live where measured) | file:line | Normalise to |
|---|---|---|---|---|
| C1 | Button capitalisation | Sentence case: "Send", "Save", "Mark read", "Resume pairing". Lowercase: "mark all read", "create group", "leave", "set alias", "delete", "remove", "copy", "subscribe", "block", "unblock", "save name", "save status", "save", "pause", "clear", "dismiss", "context", "download", "add", "promote", "get pairing code", "copy link", "try again" | pages.ts:114,130,144,149,243,257,261,288,291,295,366,391-392,398,409,412,418,441,446,502,546; pages-pairing.ts | Sentence case everywhere |
| C2 | Heading case | h2 Title case ("Status", "Profile", "Subscriptions", "Events", "Pairing"). h3 lowercase ("pairing rules", "events", "privacy", "blocked contacts", "participants", "context"), but "Transcription" is Title | pages.ts:123,276,314,385,395,397,411,441,538 | Sentence case |
| C3 | Page headings present? | h2 on Status/Profile/Subscriptions/Events/Pairing. **None** on Chats, Unread, Contacts, Groups, Settings (live `r05.a11y`) | page fns in pages.ts | One h1 per page |
| C4 | Heading size | h2 is **19.5 px** (UA default) on most pages but **16.5 px** on Events, because `.events-header{font-size:11px}` cascades (live `p10`). `#app > h2 {15px}` never applies because every h2 is inside a `section` | styles.css:131-136, 666-672 | `h1 {18px}`, `h2 {15px}` scoped by class, not child combinator |
| C5 | Label case | Title: "Bridge URL", "Token…", "Engine", "Base URL", "Model", "API key". Lowercase: "display name", "phone", "about / status", "block a JID", "chat jid", "kinds", "all chats", "include media", "show archived" | pages.ts:295,315-318,388-390,398,542-545,168 | Sentence case |
| C6 | Empty-state copy | The same "no chats" state has two texts: "…after your first message" (`pages.ts:168`) vs "…after messages arrive" (`pages.ts:537`). Unread, Events, the rules list and the blocklist have **no** empty state (blank area or a bare "mark all read" button) | pages.ts:168,537,284-292,434-442,111-123,363-368 | One `emptyState()` per list, with the same tone |
| C7 | Date/time formats | 6 formats: `HH:MM` UTC (chat list); full ISO-Z (bubble, context); `YYYY-MM-DD` uppercased (day separator); `toISOString()` (status/events feed); raw seconds (uptime); epoch ms (lastDisconnectAt) | pages.ts:176,222,257,273,120,438; main.ts:220; pages.ts:64-101 | One `formatWhen` / `formatDuration` |
| C8 | Button height / size | 36 px default; 26 px for `.context-btn/.media-btn/.copy-btn`. But Subscriptions "copy" is `.copy-hook`, so it is **36 px** while the pairing "copy link" is 26 px. Events "pause/clear" are 36 px tall with **11 px** text (live) | styles.css:202-211, 427-433; pages.ts:501 | Two sizes (`sm` / `md`) via classes |
| C9 | Primary button | `button.primary` is defined but **never used**. Only `.send-box button` is accent-filled. "Save", "subscribe", "create group", "block" and "get pairing code" are all secondary (live: white bg) | styles.css:217-229 | One primary per form |
| C10 | Destructive styling | Only `.delete-subscription` is red. "leave", rule "delete", participant "remove" and "unblock" are neutral | styles.css:490-498 | `.danger` button variant |
| C11 | List styling | Browser-default **disc bullets** on `.unread-list`, `#contacts-list`, `#groups-list`, `.rules`, `.events` (live `r01.lists`). Chat list, picker, blocklist and events-feed are reset | styles.css:255-259,500-504,547-551,674-678 | Shared `.list` reset |
| C12 | Dead selectors | `#send-box` (the markup uses the class), `button.primary`, `.section-label` (no markup), `#group-participants` styled as a list but it is a `div` (its inner `ul` is unstyled), `#link-input` given flex-column (it's an `input`), `.chat-list li.hide-archived` (finding 13) | styles.css:218,226,763,562-574,444,276 | Delete or wire |
| C13 | Font sizes | 11, 12, 13, 14, 15, 16, 20 px, plus UA 19.5/15.21 px headings. No size tokens | styles.css passim | `--fs-xs/sm/md/lg` (11/12/13/16) |
| C14 | Radii | `--radius` 8 px, hard-coded 6 px (inputs, buttons, nav links, chat rows), 4 px (code), 999 px (pills) | styles.css:94,188,207,266,486 | `--radius-sm` 6, `--radius` 8, pill |
| C15 | Off-scale spacing | `5px` (nav links, check-row), `2px` (nav gap, label pad), `6px` (badge pad), outside the 4/8/12/16 scale | styles.css:63,88,93,235,334 | Snap to `--s1/--s2` |
| C16 | Hard-coded colours | `#fecdca`, `#d6e4ff`, `#fff` ×3 outside the tokens | styles.css:159,222,325,371,493,608 | `--danger-border`, `--accent-border`, `--on-accent` |
| C17 | Label tense/voice | Status flash "name saved" / "status saved" (past) vs privacy flash "`last` set to `contacts`" (raw key + raw value) vs "downloaded ✓" | main.ts:715,724,734,889 | "Saved ✓" pattern with human field names |
| C18 | Identity rendering | Chats show the name (or a bare lid number). Unread shows the **raw JID** only. Contacts show the JID twice. The Subscriptions picker shows name **and** JID. The leave confirm shows the JID | pages.ts:179,288,130,533; main.ts:650 | `displayName(jid)` (D1 #11) |

---

## COPY REWRITE TABLE

Developer-speak and unclear strings, with proposed human rewrites. D1 #11
covers the jargon *pattern*; this is the full list. Anchors are at `9a023b8`.

| file:line | Current | Proposed |
|---|---|---|
| pages.ts:34-37 | nav groups `chats / people / automations / system` | `Messages / People / Your agent / Settings` |
| pages.ts:27 | `Subscriptions` | `Agent alerts` |
| pages.ts:28 | `Pairing` | `Link phone` |
| pages.ts:21 | `Status` | `Connection` |
| pages.ts:108 (`/health` keys) | `loggedIn`, `pairingBlocked`, `pairingAttempts`, `uiBootstrapToken`, `channel`, `contactsWarm`, `reconnects`, `lastDisconnectAt`, `uptime` | `Signed in`, `Linking paused`, `Link attempts`, *(hide)*, *(hide)*, `Contacts loaded`, `Reconnections`, `Last disconnect: 2 h ago`, `Running for 1 d 0 h` |
| pages.ts:123 | `pairing rules` | `Notification rules` |
| pages.ts:123 | `events` | `Recent activity` |
| pages.ts:114 | `*` (rule for all chats) | `All chats` |
| pages.ts:130 | `set alias` | `Rename` |
| pages.ts:130 | `<code>123…@lid</code>` | *(hide; show the phone number if known)* |
| pages.ts:134 | `No contacts yet — they appear after you chat` | no query: `No contacts yet. They appear once your phone syncs.` · with query: `No contacts match "x". Clear search` |
| pages.ts:135 | placeholder `search contacts` | `Search contacts` (+ aria-label) |
| pages.ts:149 | `group subject` / `create group` | `New group name` / `Create group` |
| pages.ts:144 | `leave` | `Leave group` |
| main.ts:650 | `leave group 1203…@g.us?` | `Leave "Test group"? You'll stop getting its messages.` |
| main.ts:627 | `alias for 2219…@lid` | `Name to show for this contact` |
| pages.ts:168,183 | placeholder `search messages` | `Search chats` |
| pages.ts:168 | `show archived` | `Show archived chats` |
| pages.ts:168 / 537 | `No chats yet — they appear after your first message` / `…after messages arrive` | `No chats yet. They appear here once your phone finishes syncing.` |
| pages.ts:243,257 | `download` | `Save file` (media only) |
| pages.ts:257 | `context` | `Show nearby messages` |
| pages.ts:276 | `context` (h3) | `Around this message` |
| pages.ts:261 | *(no placeholder)* | `Type a message` |
| main.ts:838 | `replying to 3EB0C1A2B3C4…` | `Replying to Vasilisa: "first words…"` ✕ |
| main.ts:604 | `<engine msg> — message NOT sent, text preserved` | `Couldn't send — <human reason>. Your text is still in the box.` |
| main.ts:889 | `downloaded ✓` | `Saved to Downloads ✓` (only on success) |
| main.ts:901 | `(transcription unavailable)` | `Couldn't transcribe. Set up transcription in Settings.` |
| pages.ts:288 / 291 | `Mark read` / `mark all read` | `Mark as read` / `Mark all as read` |
| pages.ts:288 | `120363…@g.us` | the chat name (`displayName`) |
| pages.ts:295 | `Bridge URL` | `Server address` (under "Advanced") |
| pages.ts:295 | `Token (optional — the UI uses the daemon's ephemeral token automatically)` | `Access key — filled in automatically; only change this if support asks you to` |
| pages.ts:307 | engines `mock / openai / mlx / whisper-local` | `Off (test mode) / OpenAI / On this Mac (MLX) / Local Whisper` |
| pages.ts:316 | `Base URL` | `Service address` |
| pages.ts:319 | `leave the key field empty to keep the saved key; engines and keys are stored in the bridge config file` | `Leave blank to keep your current key. Keys are stored only on this computer.` |
| state.ts:239-243 (privacy values) | `all`, `contacts`, `contact_blacklist`, `none`, `match_last_seen`, `known` | `Everyone`, `My contacts`, `My contacts except…`, `Nobody`, `Same as last seen`, `People I know` |
| pages.ts:348-355 | `last seen`, `online`, `profile photo`, `about`, `groups`, `calls`, `who can message`, `read receipts` | `Last seen`, `Online`, `Profile photo`, `About`, `Who can add me to groups`, `Who can call me`, `Who can message me`, `Read receipts` |
| main.ts:734 | `last set to contacts` | `Last seen: My contacts ✓` |
| pages.ts:388-392 | `display name` / `about / status` / `save name` / `save status` | `Name` / `About` / one `Save` |
| pages.ts:398 | `block a JID` / `358…@s.whatsapp.net` | `Block a number` / `+44 7700 900123` |
| pages.ts:409 | `remove` / `promote` | `Remove` / `Make admin` |
| pages.ts:412 | placeholder `358…@s.whatsapp.net` | `Phone number with country code` |
| pages.ts:418 | `new subject` / `new description` | `Group name` / `Group description` |
| pages.ts:425 | `The route <code>#/x</code> does not exist.` | `We couldn't find that page.` |
| pages.ts:452 | `bridge unreachable at http://127.0.0.1:8080 — is the daemon running?` | `Can't reach wa-mcp on this computer. Start it with "wa-mcp start" — this page reconnects automatically.` |
| pages.ts:471 | `could not load this page: Failed to fetch` | `Couldn't load <page>: wa-mcp isn't responding. [Retry]` |
| pages.ts:471 | `could not load this page: rate limit exceeded` | `Busy — retrying in a moment…` (auto-retry) |
| main.ts:348 | `render failed: <msg>` | `Something went wrong showing this page. [Reload]` |
| pages.ts:499 | `e5997895bec4 — 1203…@g.us · message` | `Test group — new messages` (+ `with photos & files` if media) |
| pages.ts:500 | `/api/subscriptions/inbox/<id>/inbox.jsonl` | *(hide under "Details")* |
| pages.ts:501 | `wa-mcp inbox drain --inbox …` / `copy` | see D2 #3 (install command) / `Copy` → `Copied ✓` |
| pages.ts:502 | `remove` | `Stop watching` |
| pages.ts:515 | `all-chats subscription active — manage it in Advanced` | `Your agent is watching all chats. Change this under "More options".` |
| pages.ts:518 | `include media` | `Include photos, voice notes and files` |
| pages.ts:522 | `2 chats — 1 subscribed` | `Your agent watches 1 of 2 chats` |
| pages.ts:540-546 | `Advanced` / `chat jid` / `kinds` / `subscribe` | `More options` / *(picker, D2 #16)* / *(remove)* / `Start watching` |
| main.ts:1108 | `subscription failed: <msg>` | `Couldn't update alerts for this chat — <reason>` |
| pages-pairing.ts (methods pane) | `registrations used: 0/3` / `Resume pairing` | hide unless blocked (D1 #11) |
| pages-pairing.ts (blocked pane) | `pairing attempts exhausted — 3 of 3 registrations without pairing.` | `Linking is paused to protect your number. Try again in about an hour.` |
| pages-pairing.ts (error pane) | `pairing error: <msg>` | `Couldn't link your phone: <human reason>` |
| pages-pairing.ts (paired pane) | `paired as this device` | `Linked to Versus (+358…)` (D1 #14) |
| main.ts:1020 | `save failed: <msg>` | `Couldn't save — <reason>` |

---

## TOP-5 FIXES (if only five)

1. **One `formatWhen`/`formatDuration` helper, used everywhere** (findings 1
   and 6, C7). Effort S. It removes the only *factually wrong* display (UTC
   times) and 6 inconsistent formats.
2. **Stop swallowing read errors into default values** (finding 2). Remove
   the per-call `.catch(() => empty)` in the profile, subscriptions and
   status loaders, and let `guardLoader` show a banner with a Retry button
   that honours `Retry-After` (finding 7). Effort S.
3. **Make chat/group rows real links/buttons, and fix the archived
   selector** (findings 4 and 13). `<a href="#/chat/…">` fixes keyboard
   access *and* D1 #1 in one move. Then fix
   `.chat-list.hide-archived li[data-archived="1"]`. Effort S.
4. **Kill hidden state:** echo and clear the contacts query, render the
   events pause label from state, and keep composer focus while
   appending (not re-rendering) after a send (findings 3, 10 and 5).
   Effort S.
5. **One a11y/consistency pass on the tokens:**
   - focus ring `--accent` 2 px;
   - darker `--ok` / `--accent`;
   - shared `.list` reset (kills the 5 bulleted lists);
   - `.primary` on each form's main action;
   - `.danger` for destructive actions;
   - `aria-label` on every input;
   - an `h1` per page and `document.title`.

   Effort M. It addresses findings 14 and 15 and C1-C16.

Server-side companion (S): add JID validation → 400 on `/api/subscriptions`
and `/api/block` (finding 9).

---

## WHAT WORKS (fair credit, all live)

- **Self-healing auth.** With a bad token planted in localStorage, the first
  call gets 401, the UI re-runs `/health` → `/api/ui-token` → 200, and Chats
  renders with zero user action (`r04.badToken`). The stored token is
  replaced.
- **Daemon-down handling exists and recovers.** API loss mid-session shows a
  persistent `role="alert"` banner within 1.5 s. The page body shows a
  guarded error instead of a crash. On restore, the next navigation clears
  the banner and renders data (`r04.recovered`).
- **Settings stays reachable with a broken bridge URL**, so a mistyped
  server address is recoverable from the UI (`r04.deadUrlSettings`).
- **Rate limiting is real and fast to recover.** 159 of 400 burst requests
  got `429` with `Retry-After: 1`, the bucket recovered in ≤3 s, and the
  guarded page showed an error instead of breaking.
- **Unicode round-trips.** Cyrillic, Arabic, emoji with skin-tone modifiers,
  and a 140-char unbroken token sent from the UI arrive intact. The bubble
  wraps within 590 px with no page overflow, and the chat-list preview
  truncates with an ellipsis.
- **Send is solid on the happy path.** Enter submits, the input clears, the
  list scrolls to the new bubble, and the inline error banner design
  (`chatErrorHtml`: escaped, dismissable, keeps the text) is the right
  pattern to copy elsewhere.
- **Escaping discipline (code review, not a live injection test).**
  `escapeHtml` coverage in `pages.ts` is consistent, and every observed
  server string rendered as text. `unreadHtml` and the events feed are the
  known exceptions (D1 #11, D2 #17).
- **Error banners use `role="alert"`**, and the Profile save slot uses
  `aria-live="polite"`. The a11y intent is there to build on.
- **The subscription picker** disables the checkbox while the call is in
  flight and reverts it on failure. It is the best-behaved control in the
  app.
- **The clean token set** (`styles.css:3-25`) is a good foundation. The
  inconsistencies come from markup and one-off rules bypassing it, not from
  a missing system.

DIMENSION 3 COMPLETE
