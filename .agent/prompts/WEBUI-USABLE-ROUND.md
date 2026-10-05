# TASK: three owner-reported WebUI fixes (usable-UI round)

Owner reports (verbatim intent):
1. `#/chats` → "⚠ could not load this page: missing or invalid bearer token" right after `#/pairing` says "paired as this device — head to Chats". Not usable.
2. `#/subscriptions` — "NOT usable, i should see a list of chats and groups with configuration to enable each with PROPER config".
3. `#/profile` — "should mirror native whatsapp controls with MY name and phone and status with option to change it".

## W1 — Fix the paired-but-401 auth bug (BUG, highest priority)

Root cause (orchestrator-verified by code reading, `packages/web-ui/src/main.ts`):
`exchangeAccountToken()` sets the `accountTokenExchanged` latch to `true` BEFORE attempting
the exchange and never resets it on failure. Sequence that breaks the owner:
pairing page loads while daemon NOT yet loggedIn → syncPairingToken runs → loggedIn false →
no exchange... but IF an exchange attempt fires while pairing is mid-flight (or a stale
pairingToken causes 401) the latch sticks; QR gets scanned; health flips loggedIn; user
clicks "head to Chats"; syncPairingToken sees loggedIn → exchangeAccountToken returns
immediately (latch) → no UI token → every API call 401 → "could not load this page".

Fix (minimal, root-cause):
- Reset the latch on FAILURE: in the `catch`, set `accountTokenExchanged = false`.
- Also reset it when a subsequent syncPairingToken observes `health.loggedIn === true` but
  `settings.token.length === 0` (belt-and-braces: the guard condition already implies we
  should be able to retry — remove the latch from the success path only).
- Keep the one-exchange-per-load intent: the guard is "don't loop 401s", not "never retry
  after a failed attempt".

TDD: new test file `packages/web-ui/tests/t142-exchange-retry.test.ts`:
- simulate: exchange attempt fails (uiToken throws ApiError 401) → latch observed reset
  (export a test hook or test via main's module: prefer extracting the exchange decision
  into a pure function `shouldExchange(state)` in state.ts + test that).
- acceptance: after a failed exchange, a later call with loggedIn=true + empty token retries.

## W2 — Subscriptions page: chat/group list with per-chat toggles + proper config

Replace the raw "chat jid" text input as the PRIMARY flow with a proper picker:
- Load chats + groups (existing `client.chats()` / groups loader) and render a compact
  list: avatar-initial + name + jid (mono, dimmed) + per-row ENABLE toggle (checkbox styled
  `.check-row` from the redesign) — enabling a row creates a subscription scoped to that
  chat (kinds: message; include_media from a global default row or per-row toggle — keep
  SIMPLE: one "include media" global check-row + per-chat toggle).
- Existing advanced text form (custom jid + kinds + all_chats) stays but moves under a
  collapsed `<details>` "Advanced" — power users keep the escape hatch.
- Rows for ACTIVE subscriptions show: enabled=on, inbox path (mono), copy hook snippet,
  remove button (existing handlers — reuse `bindSubscriptionsControls`, extend for the
  per-row toggle: same create/delete API).
- Keep ALL existing ids/classes (`#subscription-form`, `#subscription-list`,
  `.subscription-row`, `data-sub-id`) so tests keep passing; the new picker adds NEW ids
  (`#sub-chat-picker`, `.sub-chat-row`, `data-chat-jid`) — the old form inside `<details>`
  keeps its ids.
- Empty state when no chats: "No chats yet — they appear after messages arrive".

TDD: extend `t114-subscriptions.test.ts`: picker renders rows from chats fixture; enabling
a row POSTs {chat_jid, kinds:["message"]} to /api/subscriptions; advanced form still
present inside details.

## W3 — Profile page: mirror native WhatsApp (my name, phone, status + edit + privacy)

Bridge first (small, TDD in bridge/tests/http.test.ts):
- NEW `GET /api/me` returning `{ pn, name, status }`:
  - pn: from the auth state / `socket.user` if available (lifecycle has myPN after connect
    — check `packages/bridge/src/lifecycle.ts` for the logged-in user id; store or cache it
    on the handle, e.g. `handle.me`), else null.
  - name: our own pushName — after connect, `socket.user?.name` or the last fromMe
    message's pushName from the store (query: newest message WHERE fromMe=1 with pushName).
  - status: Baileys has no cheap "get my about" query — return null and let the UI show
    "—" with edit box (native shows it editable anyway).
- Keep `POST /api/profile` (name/status set) as the edit path — it exists.

Web UI (`profilePageHtml` rewrite, keep id `#profile-page`):
- Header card: avatar circle with initial (name[0] or "?"), name (editable input + save
  button → POST /api/profile {name}), phone (pn, mono, read-only), status/about line
  (editable input + save → POST /api/profile {status}).
- Privacy card (native-like): render `/api/privacy` keys grouped as native labels
  (last seen = `last`, profile photo = `profile`, about = `status`, groups = `groupadd`,
  calls = `calladd`, ...) each with a select of allowed values (all / contacts / none —
  use the values the API already accepts; check `set_privacy` tool's allowed values) →
  POST /api/privacy {key, value} on change.
- Blocklist section stays (existing) below.
- All existing ids preserved (`#profile-page`, blocklist handlers); new ids: `#me-name`,
  `#me-status`, `#me-phone`, `#save-name`, `#save-status`, `.privacy-row`.

TDD: bridge test for GET /api/me (stubbed handle with me info + seeded store);
web-ui test for profilePageHtml rendering me-card + privacy rows from fixtures.

## Gates (orchestrator re-runs everything; self-reports are not proof)
- `npx vitest run packages/web-ui/ packages/bridge/` green
- `vp check` 0; `pnpm --filter @wa-mcp/web-ui build` EXIT 0
- No selector regressions: webui-e2e + dogfood must stay green (orchestrator runs on live daemon)
- Version 0.9.0 untouched; zero comments in source; TDD RED→GREEN per workstream
- Do NOT commit — leave the tree for orchestrator review
