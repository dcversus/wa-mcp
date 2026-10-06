# AUDIT R1 — D1 First-run onboarding (independent, read-only)

Auditor: opus (fresh eyes) · Date: 2026-10-06 · Target: live daemon v0.9.0 at
http://127.0.0.1:8080 (paired, connected) · Repo HEAD `3ecd8f5`.

## Method and evidence base

- **Clean browser:** headless Chrome via CDP, with a brand-new `--user-data-dir`
  per run, so localStorage starts empty. Probe scripts:
  `/tmp/audit-d1/probe.mjs` (all routes plus interaction probes) and
  `/tmp/audit-d1/probe2.mjs` (chat view, search, status, pairing poll growth).
  The raw DOM/text dumps are `/tmp/audit-d1/report.json` and `report2.json`.
  All tokens are redacted in the dumps.
- **Screenshots:** captured to `/tmp/audit-d1/*.png` (00-root … 21-pairing-after-30s).
  **Limitation:** this session's permission sandbox blocked me from opening
  files under /tmp with the image viewer. I could not visually inspect the
  PNGs, so every finding below rests on DOM/innerText excerpts, network
  counts and source line references. The PNGs are there for a human
  reviewer.
- **Unpaired state:** this was simulated, not observed. The daemon is paired,
  so I reasoned from `pages-pairing.ts`, `main.ts` (`syncPairingToken`,
  `refreshPairing`, `bindPairingFlow`), the `/health` handler
  (`http.ts:2402-2437`) and the `/api/ui-token` handler (`http.ts:4209-4229`).
  Findings that come from that reasoning are marked *(code-path)*.
- **No writes to the account.** No sends, no pairing, no subscription changes.
  Side effect to disclose: probe2 reproduced finding 2 and drove about 10k
  rate-limited `/health` requests at the daemon over ~40s. I re-checked
  afterwards: `/health` returns 200, `connected:true`, and uptime kept counting,
  so no restart happened.

---

## VERDICT

The paired, returning-user path partly works. A clean browser on an
already-paired daemon authenticates with zero clicks and shows the chat list
in under 500 ms, which is a real achievement. **The onboarding path does not
work, though.** Of the three onboarding moments the product exists for, two
are broken by defects:

- **Pairing → first chat:** the pairing page starts an exponential polling
  storm. Within about 15–30 s it rate-limits itself, and the QR or "paired"
  state is replaced by a permanent "connecting to WhatsApp…" spinner (measured
  live).
- **Opening a chat:** clicking a chat in the chat list does nothing. A routing
  bug means the click handler is never attached (measured live: the hash stays
  `#/chats`).
- **First subscription:** the copy-able agent hook command points at a file
  path that does not exist, and it fails *silently* with exit 0.

Around those defects, the product never tells a non-engineer what it is,
never sends an unpaired user to pairing (they land on an empty "No chats yet"
page), and never mentions the step that matters most: connecting an AI agent.
The UI speaks in JIDs, `@lid` numbers, raw `/health` keys,
`contact_blacklist`, "kinds" and "Bridge URL / Token". It is a competent
engineer's debug console wearing a nicer stylesheet, not an onboarding flow.

---

## FINDINGS (sorted by severity)

Format: **[severity · label · effort]** title, then repro/evidence, analysis
and fix.

### P0 — broken core flow

#### 1. [P0 · DEFECT · S] Clicking a chat in the chat list does nothing
- **Repro (live, clean profile):** open `#/chats`, which has 3 rows, and click
  the first `li[data-jid]`. Probe result:
  `clickProbe = {"before":"#/chats","after":"#/chats","rowCount":3}`.
- **Root cause:** `packages/web-ui/src/main.ts:492`.
  `if (hash.startsWith("#/chat")) { bindSendBox(); return; }` also matches
  `"#/chats"`, so `bindChatClicks()` (line 496-498) is never reached. The
  branches at lines 505-508 (`bindChatsControls`) and 509-517
  (`bindChatExtras` plus scroll-to-bottom) can't be reached either. The rows
  are plain `<li>` elements with no `<a href>`, so nothing else is clickable.
- **Analysis:** "Open my first chat" is the moment a new user confirms the
  bridge works. Today the only way into a chat from the UI is the **Groups**
  page, which uses real `<a>` links, and only for groups. 1:1 chats can't be
  reached by clicking anywhere: Unread rows aren't links either (finding 11). A
  non-engineer will decide the app is broken.
- **Fix:** match the exact routes (`hash === "#/chats"` before the
  `startsWith("#/chat/")` check, with the trailing slash), and remove the
  duplicate dead branches. Render each row as `<a href="#/chat/<jid>">` so it
  works without JS binding and is keyboard-accessible. Add a DOM test that
  clicks a row and asserts the hash.

#### 2. [P0 · DEFECT · S] The pairing page starts an exponential poll storm: QR/paired state collapses into a "connecting…" spinner
- **Repro (live, clean profile):** open `#/pairing` and count `/health`
  requests per 5 s window:
  `pairingHealthPer5s = [2, 12, 48, 64, 384, 1343]`. After navigating away to
  `#/chats`, there were **2971 `/health` requests in 10 s**, and
  **9876 HTTP 429s** in total over 42 s. After 30 s, the pane text on a
  *connected* daemon was
  `"Pairing\n\nWhatsApp → Settings → Linked devices → Link a device\n\nconnecting to WhatsApp…"`.
- **Root cause:** `main.ts:975-982`. `bindPairingFlow()` creates a new
  `setInterval` every time it runs. Every tick calls `rerenderPairing()`
  (`main.ts:985-991`), which calls `bindPairingFlow()` again, which adds
  another interval. `pairingPoll` is overwritten, so earlier intervals leak.
  The count doubles every 3 s, and the hashchange cleanup (`main.ts:1047`)
  only clears the latest one. Once the bucket is drained, `getHealth` fails,
  so `health = {}`, and `pairingState` returns `"connecting"`
  (`pages-pairing.ts:61`).
- **Unpaired impact *(code-path)*:** the same leak also polls `/api/qr`.
  Within about 15 s the QR image is replaced by the spinner. Each tick also
  rewrites `#app.innerHTML`, which **wipes whatever the user is typing into
  the phone-number field** and steals focus every few seconds, so the
  "phone number code" method can't be used. Leaked pollers also survive
  navigation and keep starving `/health` for every other tab on the same
  loopback IP.
- **Fix:** keep a single interval. Bind event listeners once (or delegate
  them from `#app`), and have the poller only re-render when the view model
  changes. Never replace a focused form. Clear the interval on hashchange.
  Add a fake-timer test that asserts exactly one `/health` fetch per 3 s
  after 60 s on `#/pairing`.

#### 3. [P0 · PRODUCT · S] An unpaired fresh user lands on an empty Chats page that tells them to "send your first message", with no route to pairing
- **Evidence:** `router.ts:18-19` sends an empty hash to `#/chats`. Nothing
  in `main.ts` redirects based on `health.loggedIn`; a grep for a pairing
  redirect finds nothing. On an empty store, `chatListHtml` renders
  `"No chats yet — they appear after your first message"` (`pages.ts:168`).
  *(code-path: on a fresh install the store is empty. `/api/ui-token`
  succeeds while unpaired because `hasPairedAccount()` is false,
  `http.ts:4218`, so `/api/chats` returns `[]` rather than a 401.)*
  "Pairing" is the 8th of 9 nav links, under a "SYSTEM" heading
  (`pages.ts:33-38`).
- **Analysis:** the user has never linked WhatsApp, and the first screen
  tells them to send a message, which they can't do. Nothing on the page says
  "you're not connected". Native WhatsApp Desktop, Telegram Desktop and
  Signal Desktop all open *on* the link screen until linking succeeds.
- **Fix:** if `/health.loggedIn !== true`, render the pairing pane as the
  whole app (or redirect `#/` to `#/pairing`), with a one-line explanation of
  what wa-mcp is. Show a persistent "Not linked — Link WhatsApp" banner on
  every route while unpaired. Change the empty-chats copy depending on whether
  the account is paired and history is syncing (finding 16).

#### 4. [P0 · PRODUCT · M] The UI never mentions the reason the product exists: connecting an AI agent
- **Evidence:** across all 12 routes (`report.json` text dumps), no page
  mentions MCP, an agent, Claude, Cursor or `wa-mcp install`. In
  `packages/web-ui/src/pages.ts`, the only matches for "mcp" are the brand
  name and the hook-snippet CLI string (`pages.ts:39`, `pages.ts:486`). The
  only surface for agents is Subscriptions, which shows a hook command that
  is itself broken (finding 5). On the CLI side, `wa-mcp start` prints only
  `bridge started (pid N); logs: <path>` (`packages/cli/src/bin.ts:375`), with
  no UI URL and no next step.
- **Analysis:** the README quick start is CLI-first (`start → install
  --target … → doctor → pair`, `README.md:20-23`), but a user who opens the
  web UI finds no bridge back to it. After pairing succeeds there is no
  "Now connect your agent" step, so the user reaches "it works" for WhatsApp
  but not for the thing they installed it for.
- **Fix:** add a "Connect an agent" page (and post-pair step) listing the
  detected/installable targets, with the exact `wa-mcp install --target X`
  command, a copy button, and live status for each target ("registered ✓ /
  not yet"). The data already exists in `doctor`. Have `wa-mcp start` print
  `Web UI: http://127.0.0.1:8080 — open it to link WhatsApp`.

### P1 — confusing or broken secondary flows

#### 5. [P1 · DEFECT · S] The subscription hook command points at a nonexistent path and fails silently
- **Evidence (live):** the Subscriptions page shows
  `wa-mcp inbox drain --inbox /api/subscriptions/inbox/e5997895bec4/inbox.jsonl`.
  The UI builds that HTTP-style path itself
  (`main.ts:466`: `` inboxPath: `/api/subscriptions/inbox/${sub.id}/inbox.jsonl` ``).
  Filesystem check: `/api/subscriptions/inbox/e5997895bec4/inbox.jsonl`
  doesn't exist, while `~/.wa-mcp/subs/e5997895bec4/inbox.jsonl` does
  (175 bytes). `drainInbox` returns `{exit: 0, summary: "inbox: no file"}`
  for a missing file (`packages/cli/src/subscribe.ts:98-99`).
- **Analysis:** a user who copies the snippet into an agent hook gets a hook
  that reports success and never delivers a message. It is the worst kind of
  failure because nothing signals it. The server already returns the correct
  absolute `inboxPath` when a subscription is created (`http.ts:3559-3565`);
  the UI throws it away.
- **Fix:** have `GET /api/subscriptions` return the real `inboxPath` and
  render that. Make `inbox drain` exit non-zero with
  "no such inbox: <path>" when the file is missing. Add a test that the
  rendered snippet path exists on disk.

#### 6. [P1 · DEFECT · S] The chat view opens at the oldest message, and reply/context controls are dead
- **Evidence (live, Test group):** `chatView = {scrollTop:0, scrollHeight:2485, clientHeight:516}`,
  so the user sees the oldest of 50 messages and the newest are off-screen.
  Clicking a message left the composer placeholder `""` (the reply-to code
  never ran). Clicking "context" gave `contextViewPresent: false`. Same root
  cause as finding 1: `bindChatExtras()` and the scroll-to-bottom code
  (`main.ts:509-517`) can't be reached.
- **Fix:** the same routing fix as finding 1. Then scroll to the bottom after
  render.

#### 7. [P1 · DEFECT · S] Chat search and "show archived" do nothing, and search corrupts the URL
- **Evidence (live):** after typing in search and submitting:
  `{"href":"http://127.0.0.1:8080/?query=zzzz-no-match#/chats","rows":3,"inputVal":""}`.
  The form was submitted natively as a GET, the page reloaded, and the query
  was lost. The archived toggle gave
  `{before:"chat-list hide-archived", after:"chat-list hide-archived", checked:true}`.
  Root cause: `bindChatsControls` is unreachable (`main.ts:505`, see
  finding 1). Also, the `chats` loader never passes `chatSearchQuery` to the
  API: `chatListHtml` only echoes it back into the input (`main.ts:397-405`).
- **Fix:** the routing fix, plus actually filter by the query (client-side
  over name/preview, or call `/api/search`).

#### 8. [P1 · DEFECT · S] The pairing error pane is a dead end
- **Evidence *(code-path)*:** the error pane offers only
  `<a href="#/pairing">try again</a>` (`pages-pairing.ts:81`). On
  `#/pairing` that link is a same-hash no-op, so no hashchange fires.
  `pairingView.error` is only cleared by the `#resume-pairing` click handler
  (`main.ts:966-969`), and that button isn't rendered on the error pane.
  `pairingState` returns `"error"` while `error` is set
  (`pages-pairing.ts:52-54`).
- **Analysis:** one mistyped phone number traps the user on an error pane
  until they think to hard-reload the page.
- **Fix:** make "try again" a button that clears `error`/`code` and
  re-renders. Show the specific validation reason, for example "include the
  country code".

#### 9. [P1 · PRODUCT · S] The "3 · Copy-paste link" pairing method isn't a real method
- **Evidence:** `pages-pairing.ts:110` says "paste this into your phone's
  browser:" next to `view.qr.qr`, which is the raw Baileys QR ref string
  (`handle.getLastQr()`, `http.ts:586`). It is a comma-separated
  ref/key blob, not a URL. *(code-path; I didn't verify on a phone.)*
  Pasting it into a mobile browser does nothing; WhatsApp only accepts it
  through the camera scanner.
- **Analysis:** it is presented as equal to QR scanning and phone codes, so a
  user who can't scan, which is exactly who reaches for option 3, will hit a
  dead end and blame themselves.
- **Fix:** remove it, or relabel it honestly ("raw QR payload, for
  debugging") and collapse it. Make the phone-code method the clear fallback.

#### 10. [P1 · SECURITY (PII) · S] The owner's real phone number ships as a placeholder
- **Evidence:** `pages-pairing.ts:104` has `placeholder="358497773518"`. The
  live Profile page shows `phone 358497773518` for the paired account
  (`report.json` → `10-profile`), so it is the owner's own number.
- **Analysis:** a personal phone number is hard-coded in a publishable
  package and shown to every user. It is also bad UX: a new user may think
  the field is pre-filled.
- **Fix:** use an obviously fake example in the same format, such as
  `e.g. 447700900123`, and grep the repo for other copies.

#### 11. [P1 · PRODUCT · M] Jargon leaks on every first-run surface
Each item below is from the live DOM (`report.json`):
- **Unread:** `120363428874442773@g.us4Mark read` and
  `351930017568@s.whatsapp.net14Mark read`. These are raw JIDs, with no name
  and no link to the chat (`pages.ts:288`, which also lacks `escapeHtml`).
- **Contacts:** `221900000001937@lid 221900000001937@lid set alias`. The
  "name" is the `@lid` JID repeated twice, and all three contacts are
  `@lid` (`pages.ts:130`).
- **Chats:** one chat's display name is `55600000009854`, a bare lid number
  with avatar initials "5".
- **Subscriptions:** every chat row shows its JID. The rows are labelled
  `e5997895bec4 — 120363428874442773@g.us · message`. "Advanced" asks for
  `chat jid` (`1203…@g.us`) and `kinds`.
- **Profile:** privacy options are raw enums (`contact_blacklist`,
  `match_last_seen`, `known`), and the block form says "block a JID"
  (`pages.ts:398`).
- **Settings:** "Bridge URL" and "Token (optional — the UI uses the daemon's
  ephemeral token automatically)" (`pages.ts:295`).
- **Pairing:** "registrations used: 0/3" plus a "Resume pairing" button on
  the happy path (`pages-pairing.ts:112`).

**Analysis:** a user who "knows WhatsApp, not JIDs" can't tell who is who in
Unread or Contacts, and has no idea what "kinds" or "Resume pairing" mean.

**Fix:** add one `displayName(jid)` helper (contact or alias name, then the
formatted phone number, then "Unknown contact"). Hide JIDs behind a
"details" disclosure. Map the privacy enums to WhatsApp's own labels
("Everyone / My contacts / My contacts except… / Nobody"). Move Bridge
URL/Token under "Advanced". Hide the attempts counter and Resume button
unless `pairingBlocked`.

#### 12. [P1 · PRODUCT + SECURITY · S] Status is a raw `/health` dump that paints a credential on screen
- **Evidence (live):** labels are rendered
  `STATUS / CONNECTED / LOGGEDIN / PAIRINGBLOCKED / PAIRINGATTEMPTS / UIBOOTSTRAPTOKEN / … / UPTIME 87733 / LASTDISCONNECTAT 1791313750747`.
  Probe: `statusTokenOnScreen = {labelPresent:true, valueLength:48, valueIsHex:true, equalsStoredBootstrap:true}`.
  The section headed **"pairing rules"** actually lists *notification* rules
  (`pages.ts:123`). Separately, Settings shows the full account token in a
  plain-text `<input value=…>` (`pages.ts:295`).
- **Analysis:** a newcomer checking "is it working?" gets epoch milliseconds
  and uptime in seconds. A screenshot shared for support leaks the bootstrap
  credential, and that credential mints a full UI token (finding 18).
- **Fix:** add a human status card ("✅ Linked as +358 … · online · last
  reconnect 2 h ago · 1 agent subscription"), with the raw keys under
  "Diagnostics". Filter `uiBootstrapToken` out of the render. Use
  `type=password` with a reveal toggle for the token. Rename the section to
  "notification rules".

### P2 — polish

#### 13. [P2 · DEFECT · S] Transcription settings can't be reached in the UI
- **Evidence (live):** the `#/settings` text is only
  `Bridge URL / Token (optional…) / Save`. `app.ts:71-74` short-circuits the
  `settings` route to `settingsHtml(settings)` before any loader runs, so
  `loaders.settings` (`main.ts:432-453`, which appends
  `transcriptionSettingsHtml`) is dead. The transcription form also has no
  submit button (`pages.ts:314-320`).
- **Fix:** delete the short-circuit, and add a Save button to the
  transcription form.

#### 14. [P2 · DEFECT · S] The success screen says "paired as **this device**" instead of the account
- **Evidence (live):** `04-pairing` text: `paired as this device — head to Chats`.
  Nothing in `main.ts` ever sets `pairingView.me` (`pages-pairing.ts:78`
  falls back to the literal "this device").
- **Fix:** fill `me` from `GET /api/me` (already used by Profile) and show
  the name and number.

#### 15. [P2 · DEFECT · S] The QR countdown bar doesn't reset when the QR rotates
- **Evidence *(code-path)*:** `main.ts:178-183` sets `qrSeenAt` only when it
  is 0 and resets it only when the QR becomes null. Baileys rotates the QR ref
  roughly every 20 s without going null, so after the first 20 s the bar sits
  at 0% while a fresh, valid QR is showing. That suggests "expired" at the
  very moment the user should scan.
- **Fix:** reset `qrSeenAt` whenever the `qr` string changes. Better still,
  have `/api/qr` return `expiresAt`.

#### 16. [P2 · PRODUCT · M] No progress indicator between "linked" and "chats appear"
- **Evidence *(code-path)*:** after pairing, the pairing pane says
  "head to Chats", and Chats renders the generic empty state
  (`pages.ts:168`) until history sync fills the store. `/health` has a
  `contactsWarm` flag, but no UI uses it.
- **Fix:** while paired with an empty store or `contactsWarm:false`, show
  "Syncing your chats from your phone… keep WhatsApp open on your phone"
  with a spinner, the way WhatsApp and Signal Desktop do.

#### 17. [P2 · PRODUCT · S] The CLI start step gives no next step
- **Evidence:** `packages/cli/src/bin.ts:375` prints only the pid and the
  log path.
- **Fix:** print the UI URL, plus `wa-mcp pair` if the daemon is unpaired or
  `wa-mcp install --target …` if it is paired. This is covered in finding 4;
  listed separately because the effort is S.

#### 18. [P2 · SECURITY · —] The stable bootstrap credential is published on unauthenticated `/health` (accepted risk, verify it stays accepted)
- **Evidence (live):** unauthenticated `GET /health` → 200 with a 48-hex
  `uiBootstrapToken` (value not printed). `http.ts:2419`. `/health` sits
  outside the Host/Origin guard (`http.ts:2395`), but `/api/ui-token` is
  inside it, so DNS rebinding can't complete the exchange. ADR 0012
  (`docs/adr/0012-…md:114-118`) states the residual risk plainly: any local
  process, including another OS user's, can mint a full UI token. Note that
  the comment at `http.ts:2412-2415` describes this exact leak as the reason
  to hide the pairing token, and the next field re-opens it.
- **Recommendation:** this is a deliberate owner decision, so no change is
  required in D1. Do surface it in onboarding, for example a one-line note in
  the Diagnostics view: "Anyone on this computer can open this UI. Set
  WA_UI_BOOTSTRAP=0 on shared machines."

#### 19. [P2 · PRODUCT · S] Chat view basics are missing
- **Evidence (live):** no chat title or header (`chatHeader: null`).
  Timestamps are raw ISO (`2026-10-03T06:46:46.000Z`). Every text message has
  `context` and `download` buttons (`buttonsPerMsg: 2`, `pages.ts:257`). The
  composer has no placeholder and no label (`sendPlaceholder: null`,
  `sendLabel: false`).
- **Fix:** add a header with the chat name and a back link, show `HH:MM`
  with day separators (already present), show the download button only when
  `mediaType` is set, put actions in a hover menu, and set the composer
  placeholder to "Type a message".

### P3 — nice-to-have

#### 20. [P3 · DEFECT · S] `/favicon.ico` returns 401 on every page load
- **Evidence (live):** 16 × `401 http://127.0.0.1:8080/favicon.ico` in
  probe 1. Static serving only covers `/` and `/assets/`
  (`http.ts:2505-2507`), so the favicon falls through to auth.
- **Fix:** serve a favicon (and a recognizable tab title, for example
  "wa-mcp · WhatsApp for your agent").

#### 21. [P3 · PRODUCT · S] The "blocked" pane gives contradictory advice
- **Evidence:** `pages-pairing.ts:87-89` says "retrying now deepens the
  lockout. Wait for the cooldown to clear, then resume — **or restart the
  daemon**", with a "Resume pairing" button right below. The user gets no
  wait time.
- **Fix:** show an estimated time ("try again after ~HH:MM"), and drop the
  "restart" advice if restarting also counts as a retry.

---

## Comparative: how native clients onboard

| Step | WhatsApp Desktop | Telegram Desktop | Signal Desktop | wa-mcp (today) |
|---|---|---|---|---|
| First screen | Full-screen "Use WhatsApp on your computer" with 3 numbered steps and the QR | "Start Messaging" welcome, then QR or phone login | QR with "Link your phone" steps | Chat list (empty when unpaired) with a 9-item nav; pairing is buried under SYSTEM (findings 3, 4) |
| QR lifecycle | Auto-refreshes; "click to reload" overlay when expired | Auto-refreshes | Auto-refreshes | Countdown wrong (finding 15); QR collapses into a spinner within ~15–30 s (finding 2) |
| Alternate method | "Link with phone number instead" (8-char code) | Phone number + SMS code | none | Phone code (good) plus a bogus "copy-paste link" method (finding 9); the phone field is wiped by re-renders (finding 2) |
| After linking | "Loading your chats" progress bar, then the chat list | Sync, then chats | "Syncing messages", then chats | "paired as this device — head to Chats" (finding 14), then an empty list with no sync hint (finding 16) |
| Open a chat | Click | Click | Click | **Broken** (finding 1) |
| Identity | Names and avatars everywhere | Names | Names | JIDs and `@lid` numbers (finding 11) |

**Where wa-mcp is better:** a zero-account, zero-click credential bootstrap
(no login wall at all on loopback). The phone-code method sits alongside the
QR instead of hiding behind a link. The anti-abuse budget is explicit, which
none of the native clients expose and which is genuinely protective for a
Baileys-based bridge. Groups can be created and left directly from the
web UI.

**Where it is worse:** it doesn't gate on link state, doesn't say what it is,
has no sync progress, is unusable once you're on the page (findings 1 and 2),
and, unlike any native client, has a second onboarding goal (connect an agent)
that it never mentions.

---

## Ideal first 5 minutes, and the gap

| # | Ideal | Reality | Gap |
|---|---|---|---|
| 0 | `wa-mcp start` prints "Open http://127.0.0.1:8080 to link WhatsApp" (and optionally opens it) | Prints the pid and log path only | Finding 17 |
| 1 | The UI opens on **"Link WhatsApp to your AI agent"**: a one-sentence explanation plus the QR, with "Use phone number instead" | Opens on `#/chats` with an empty state saying "after your first message" | Finding 3 |
| 2 | The QR auto-refreshes with an honest countdown; the phone-code form keeps its input | The poll storm turns the QR into a spinner within ~15–30 s and wipes the phone field | Findings 2, 15 |
| 3 | On link: "✅ Linked as Name (+358…)", then "Syncing your chats…" progress | "paired as this device", then an empty list | Findings 14, 16 |
| 4 | The chat list shows names; clicking opens the chat scrolled to the newest message, with a title and a composer placeholder | Rows don't open; the view starts at the oldest message; no title | Findings 1, 6, 19 |
| 5 | **"Connect your agent"** step: pick Claude Code / Cursor / … and copy one install command, with a live "registered ✓" check | No such step anywhere in the UI | Finding 4 |
| 6 | "Let your agent watch a chat": tick a chat, and a working hook command is shown and verified | The picker works, but the hook command points at a nonexistent file and fails silently | Finding 5 |
| 7 | Human-readable status card; diagnostics behind a disclosure | Raw `/health` dump including a credential | Finding 12 |

Score: of the ideal steps 1–6, today **0 are fully met**, 2 are partly met
(steps 2 and 6 have the right shape but are broken), and 4 are missing or
broken.

---

## TOP-5 FIXES (if only five)

1. **Routing fix in `bindRoute`, covering findings 1, 6 and 7.** One line of
   root cause (`main.ts:492`, `startsWith("#/chat")` matching `#/chats`)
   disables opening chats, scroll-to-newest, reply, context, search and
   archived. Effort S, and it unblocks the core "first chat" moment. Render
   rows as `<a href>` so this can't silently regress.
2. **Kill the pairing poll storm (finding 2).** A single interval, no
   re-binding, and no re-render of focused forms. Without this, the
   onboarding screen breaks itself within seconds and the phone-code method
   is unusable. Effort S.
3. **Gate the app on link state (findings 3 and 16).** An unpaired daemon
   opens on pairing with a one-line "what this is". Paired with an empty
   store shows "syncing…". This turns a dead end into a guided path.
   Effort S–M.
4. **A "Connect your agent" step, plus a working hook command
   (findings 4, 5 and 17).** It is the product's reason to exist: render the
   real `inboxPath`, make `inbox drain` fail loudly on a missing file, and
   show the per-target `wa-mcp install` commands with a live status check.
   Effort M.
5. **A human identity layer (findings 11, 12, 14 and 10).** Names instead of
   JIDs everywhere, WhatsApp-style privacy labels, a human status card with
   the credential removed from the render, "Linked as …", and the owner's
   phone number removed from the placeholder. Effort M.

---

## WHAT WORKS (fair credit)

- **Zero-action bootstrap on a clean profile.** With empty localStorage, the
  chat list rendered **within 500 ms** (`00-root-500ms` already shows 3
  chats). localStorage was seeded automatically
  (`wa-mcp-pairing-token`, `wa-mcp-settings`) and there was no token prompt.
  The T94-G/ADR 0012 design does what it promises.
- **Zero JS console errors or exceptions** across the 12 routes plus the
  interaction probes (`report.console = []`).
- **The daemon is resilient.** It absorbed a ~10k-request storm, answering
  each with 429 plus `retry-after`, and stayed `connected:true` without
  restarting. The rate limiter and the separate exchange bucket work.
- **The Host/Origin guard on `/api/*`, `/events` and `/mcp`** (`http.ts:2395`)
  correctly blocks DNS rebinding from completing the token exchange.
- **The pairing pane structure is right in principle:** three panes
  (connecting / methods / blocked), the WhatsApp menu path spelled out
  (`WhatsApp → Settings → Linked devices → Link a device`), numbered phone-code
  steps including "Link with phone number instead", and an explicit, honest
  anti-abuse budget.
- **The Subscriptions chat picker** (a checkbox per chat, groups first, a
  filter box, "N chats — M subscribed") is the right mental model for
  "let my agent watch this chat". It only needs names instead of JIDs and a
  working hook path.
- **Groups list links work** (`<a href="#/chat/…">`). It is currently the
  only working way into a chat.
- **Unknown routes get a proper 404 pane** with a "Go to chats" link, and
  empty states exist on Contacts, Groups and Chats (even though the Chats copy
  is wrong for unpaired users).
- **Pairing remembers being paired.** `pairingPossible()` correctly stops QR
  polling once logged in (the T75 intent), although finding 2's leak still
  polls `/health`.

DIMENSION 1 COMPLETE
