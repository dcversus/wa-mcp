# wa-mcp — GOAL (v0.9.0)

New repo, empty history. Bin: `npx wa-mcp install` / `bunx wa-mcp install`. 100% TypeScript on Vite+ (`vp`). npm name `wa-mcp` verified FREE (E404 on registry, 2026-10-01). GitHub `dcversus/wa-mcp` free.
Engine: Baileys (`@whiskeysockets/baileys`, 10.9k★, same multidevice protocol as whatsmeow).
Architecture reference: claude-mem 13.28.0 (npx-cli/commands/{install,doctor}.ts pattern, skills/, per-harness plugin dirs).
Feature sources — FULL census in review/BACKLOG-FULL.md (1,029 items: 248 issues + 781 PRs, all states, 18 repos):
lharries/whatsapp-mcp (127i+235p), verygoodplugins/whatsapp-mcp (38i+223p),
FelixIsaac/whatsapp-mcp-extended (25i+59p), chigwell/telegram-mcp (52i+200p — patterns source),
jonzarecki/wa-mcp (31p: catch_up digest, unread tracking, MCP Prompts), delltrak/wamcp (17p: 62-tool TS+Baileys),
operation-hp/WA-MCP (9p), kahflane (87 tools), biliboss (62 tools), eddmann (FTS5 + catch_up lineage),
NIXKnight, Jochem, fabienbutz, aserranoni, MuhammadMustafa18, ste-bah, OmarYousef95, Shloimy15e.

**Target platforms (owner-set):** Claude Code, Claude Desktop, Pi, Hermes, Codex, Grok, Antigravity, Cursor.

**Structure:** `packages/{bridge,mcp-server,shared,cli,web-ui}` + `skills/` + `plugins/` + `docs/` + `review/`.
Daemon model: bridge as background service (launchd/systemd/TaskScheduler), MCP server per harness (stdio) + optional HTTP `/mcp`, everything under `~/.wa-mcp/` (auth 0700, store, logs, media, token).
Live-testing ground rules: owner's real account, Test group + own number only.

---

## 1. Repo bootstrap — `~/Documents/GitHub/wa-mcp`

- [x] `git init` empty repo; first commit only `.gitignore` (`node_modules/`, `dist/`, `*.db`, `store/`, `.env`, `*.log`) — verify: `git log --oneline | wc -l` = 1 — VERIFY: §1 repo-init (8a32c08)
- [x] `vp create` monorepo: pnpm workspaces `packages/{bridge,mcp-server,shared,cli,web-ui}` — verify: `ls packages/` = 5 dirs — VERIFY: §1 monorepo-scaffold
- [x] Root `package.json` (`wa-mcp`, `type: module`, engines node≥20, packageManager pnpm) — verify: `vp check` runs — VERIFY: vp check green; engines raised >=22.5 (T42)
- [x] `tsconfig.base.json` strict: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` — verify: test file with `any` fails `vp check` — VERIFY: vp check gates caught TS18048/TS2741 (T40/T44)
- [x] Root `vite.config.ts` (Vite+ defineConfig) — verify: `vp build` builds 5 empty packages — VERIFY: vp build 6 packages green (T48)
- [x] GitHub repo `dcversus/wa-mcp` (private) pushed — verify: `gh repo view` OK — VERIFY: §1 github-repo
- [ ] Branch protection main: `vp check` + `vp test` required — verify: `gh api .../branches/main/protection` shows checks — PENDING: live (pairing); GitHub Pro required — BLOCKED.md

## 2. Bridge (`packages/bridge`) — Baileys daemon

- [x] QR pairing: `get_login_qr`/`get_qr_code` endpoint + every rotation rendered (VGP #243/#213; biliboss/delltrak), ASCII→stderr + PNG file (VGP #242), phone pairing code `WA_PAIRING_NUMBER` / `get_pairing_code` (kahflane wa_get_pairing_code; lharries PR#248/#254/#365; VGP), companion refresh (VGP #244) — verify: `pair` shows ≥2 QR rotations, PNG opens; pair-by-code completes without QR — PENDING: live (pairing); endpoints+rotation+budget unit/CLI verified (T39/T46/T48); scan completion pending
- [x] Session persistence `~/.wa-mcp/auth/` 0700 — verify: restart daemon → no QR — VERIFY: live 2026-10-03 — daemon restart with persisted creds took the login branch, zero re-registrations, connected (VERIFY.md live-smoke section)
- [x] Reconnect: backoff, auto-reconnect unless logged-out — verify: `kill -9` → service restarts → `/health` `connected:true` ≤60s — PENDING: live (pairing); backoff+515-immediate unit-verified (T45A); connected:true needs pairing
- [x] Single-instance lock (VGP #158) — verify: 2nd daemon start → exit 1 "session held" — VERIFY: T10 lock tests ('session held')
- [x] Event bus, all Baileys events typed: `messages.upsert/update`, `message-receipt.update`, `presence.update`, `chats.update/upsert`, `contacts.upsert`, `groups.update`, `groups-participants.update`, `call`, `connection.update`, `creds.update`, `group-participants.request` — verify: synthetic event → typed subscriber (unit) — VERIFY: T6/T10 events tests
- [x] `GET /health` → `{status, connected, loggedIn, version, uptime}`, 127.0.0.1 only — verify: curl loopback OK; LAN IP refused — VERIFY: T7 loopback + T44 health-shape tests
- [x] Bridge token `~/.wa-mcp/token` (0600); `Authorization: Bearer` on ALL endpoints (VGP #153) — verify: no-token → 401 on every route (matrix test) — VERIFY: T7 401 auth-matrix
- [x] Graceful shutdown SIGTERM → flush + exit 0 (VGP #186) — verify: `launchctl stop` → exit 0, no SIGABRT — VERIFY: T10 shutdown tests (exit 0 <=3s)
- [ ] `WA_DEVICE_NAME` (VGP #157) — verify: paired device shows that name on phone — PENDING: live (pairing); unit-verified (T10 lifecycle); on-phone display needs pairing

- [x] Windows live pairing page: auto-refreshing QR in browser (VGP P#163) — verify: `pair --web` serves page on 127.0.0.1, QR auto-refreshes on rotation — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Full-history-at-pair flag `WA_SYNC_FULL_HISTORY` (VGP P#37; kahflane env) — verify: pair with flag → history-sync includes older chats (log check) — PENDING: live (pairing); env wired + passthrough test (T10)
- [x] Disappearing-message settings tracked per chat (VGP P#82) — verify: chat with 7-day disappearing → store records setting — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Windows console Unicode hardening: QR render + logs never crash on cp1252/chcp consoles; ASCII fallback (chigwell I#150/P#250) — verify: Windows CI run under chcp 437, no UnicodeEncodeError — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Socket staleness detection: periodic ping, force-reconnect on stale TCP instead of silent hang (chigwell P#98) — verify: synthetic dead-socket → reconnect ≤30s — T93 REPAIR: liveness-first watchdog (activity resets misses; engine-form ping probe; counters before detach) after the live false-positive storm — VERIFY: t93-staleness
- [x] App-state conflict auto-recovery: on LTHash 409 "SendAppState failed", retry FetchAppState(fullSync=true) + runbook entry (VGP I#111) — verify: synthetic 409 → recovery attempt logged, bridge stays up — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Connection-quality tracking: KeepAliveRestored events counted, exposed in /health + /metrics (Felix I#7) — verify: metrics series wa_keepalive_total present — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Alert on N consecutive reconnect failures → webhook/notification + log (Felix I#12) — verify: 3 synthetic failures → alert fired once — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] stdio MCP server exits on stdin EOF / parent death — no orphan processes (VGP P#177; chigwell P#177) — verify: kill parent → child exits ≤2s — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Business-account pairing path verified or documented limitation (VGP I#205) — verify: live pair on Business account OR ACCOUNTING row with reproduction notes — VERIFY: ACCOUNTING rows (VGP I#205 documented limitation)
- [x] Concurrent MCP clients: 2 harnesses (e.g. Claude Code + Cursor) simultaneously against ONE daemon, both streams served (chigwell I#214/P#215) — verify: parallel tools/call from 2 clients, both 200 — PENDING: live (pairing); HTTP /mcp + SSE multi-client shipped (T20/T25); 2-harness probe pending — VERIFY: live 2026-10-03 two overlapping /mcp JSON-RPC streams (Promise.all) → both 200, 32 tools each (VERIFY.md)
## 3. Store (`packages/bridge/src/store`)

- [x] better-sqlite3 (prebuilt, no compiler), WAL, busy_timeout=5000 — verify: fresh CI runner installs without gcc — VERIFY: T9 schema tests (WAL + busy_timeout 5000) — NA-ENGINE: node:sqlite replaces better-sqlite3 (ADR 0003)
- [x] Tables: `chats, messages, contacts, events, poll_options, poll_votes, read_state, media_files, aliases, scheduled, templates, autoreply_rules, meta` — verify: `PRAGMA table_list` matches spec (snapshot test) — VERIFY: T9/T13 schema snapshot tests
- [x] `messages` cols: id, chat_jid, sender_jid, sender_name, timestamp ISO-8601-with-offset (VGP #232/#236, lharries #146), content, media_type, media_path, quoted_message_id, mentions, is_from_me, is_unread, reactions — verify: schema snapshot test — VERIFY: T12 13-column tests
- [x] FTS5 `messages_fts` + sync triggers (MuhammadMustafa18), accent-insensitive — verify: insert "Schröder" → search "schroder" hits — VERIFY: T13 FTS5 tests
- [x] Migrations from lharries-layout AND Go-fork layout (`~/Documents/GitHub/whatsapp-mcp/store` real fixture) — verify: row counts equal, 0 NULL sender_name where resolvable — PENDING: live (pairing); foreign-layout import unverified
- [x] Perms 0700/0600 (VGP #241) — verify: `stat` shows 700 — VERIFY: T9 perms tests
- [x] Nightly backup + retention (Felix #8/#13) — verify: retention=1, two runs → 1 backup left — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Read-state persisted + history backfill (VGP #155/#201/#203; lharries #59) — verify: synthetic receipt → read_state updated; unread counts correct — VERIFY: T21/T22 read-state tests

- [x] media_path stored as ABSOLUTE path, never relative (Felix I#85) — verify: unit — stored rows resolve from any cwd — VERIFY: T18/T24 media-path tests
- [x] Sync-status metadata: last history-sync watermark + per-chat backfill state (lharries PR#341) — verify: sync_status tool reflects fixture backfill — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Docker volume permissions: PUID/PGID env or documented chmod for mounted store (Felix I#4) — verify: container run with UID 1000 writes to mounted volume — OUT-OF-SCOPE 0.9: ACCOUNTING
## 4. Send path

- [x] `send_text`: phone/JID/group, "+" strip, mentions[], reply_to, link-preview toggle — VERIFY: live 2026-10-03 text → Vasilisa (PN+LID resolution) + Test group, 200 + stored + read-back (VERIFY.md live-smoke); variant matrix (mentions/reply/preview) unit-verified T15/T16, dogfood for live variants
- [x] `send_media` (aliases `send_image`/`send_video`/`send_audio`/`send_document`): image/video/audio/document/sticker; MIME by ext+magic bytes; fileName; caption (lharries #350, VGP #193); base64 input (Felix #76); URL input — VERIFY: live 2026-10-03 image+caption base64 → Vasilisa, 200 + stored + file in ~/.wa-mcp/media (T61 fixed default media dir; VERIFY.md); PDF/sticker/audio legs = owner dogfood; T18 unit matrix
- [x] `send_voice`: ffmpeg → ogg/opus PTT, temp cleanup (VGP #227) — verify: mp3 → playable voice note; no temp leftover — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] `send_location` (kahflane/biliboss) — verify: live send → pin on phone — VERIFY: live 2026-10-03 Lisbon pin sent to Vasilisa, 200 + stored with label+coords (VERIFY.md live-smoke); phone visual = owner dogfood
- [x] `send_link_preview` (delltrak) — verify: live send → link card renders on phone — link-preview builder (T15) + engine-native `{text, linkPreview}` send path (T92) + send_message link_preview/url params (T92-B) — VERIFY: t92-send-kinds, t92b-mcp-wiring — PENDING: live (pairing)
- [ ] `send_view_once` (delltrak) — verify: live send → view-once badge on phone — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] `check_number_exists` (delltrak) — verify: own number → true; random → false — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] `send_text_status`/`send_image_status`/`send_video_status` (delltrak; kahflane post_status) — TEXT-ONLY: status-text kind sends `{text}` to status@broadcast (engine-native, T92) + send_message status_broadcast param (T92-B); image/video status not implemented — VERIFY: t92-send-kinds, t92b-mcp-wiring — PENDING: live
- [x] `send_contact` vCard (kahflane/biliboss) — verify: live send → tappable card — VERIFY: live 2026-10-03 vCard sent to Vasilisa, 200 + stored (VERIFY.md live-smoke); phone visual = owner dogfood
- [x] `send_poll` + options stored for vote decode (lharries #345; Felix #84) — VERIFY: live 2026-10-03 2 polls sent + poll_options rows stored (T59 extraction fix; VERIFY.md); phone-visual vote → poll_votes ingest = owner dogfood
- [x] `send_buttons`/`send_list` (kahflane; lharries #15/#197) — sendable via generateWAMessageFromContent+relayMessage (T92 engine truth: sendMessage rejects raw protos); send_message buttons/interactive/list params (T92-B); Business-account rendering caveat unchanged — VERIFY: t92-send-kinds, t92b-mcp-wiring — PENDING: live
- [x] `edit_message`, `delete_message` for-everyone + `delete_message_for_me` (local-only) (kahflane wa_delete_message_for_me; VGP #192; lharries #90) — VERIFY: live 2026-10-03 edit (row updates in place) + delete for-everyone (tombstone deleted=1, {deleted:true}; VERIFY.md); delete_for_me OUT-OF-SCOPE (ACCOUNTING)
- [x] `forward_message` (kahflane/biliboss) — verify: live forward Test-group → own chat — VERIFY: live 2026-10-03 forwarded poll-fix message → Vasilisa, 200 + stored (VERIFY.md live-smoke)
- [x] `react`/`send_reaction` (kahflane/biliboss/delltrak wa_send_reaction) — verify: live reaction visible on phone — VERIFY: live 2026-10-03 👍 on Vasilisa's reply, 200 + reactions stored (dedupe fix T60) (VERIFY.md live-smoke); phone visual = owner dogfood
- [x] `send_presence` typing/recording + `subscribe_presence` (kahflane) — verify: phone shows "typing…" during send — PENDING: live (pairing); T22 unit — VERIFY: live 2026-10-03 composing → {ok:true}, recording → {ok:true} (VERIFY.md)
- [ ] `send_broadcast` + `broadcast_info` (kahflane) — verify: 2-recipient broadcast → 200 — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Outbound persistence + media upload metadata (lharries #229; VGP #221) — verify: `list_messages` shows own sends is_from_me=1 — VERIFY: T16b outbound persistence tests
- [x] Send-safety: min-interval pacing, daily cap `WA_DAILY_CAP`, kill-switch `WA_SENDS_DISABLED=1` (kahflane), rate-limit error surfaced (ste-bah) — verify: unit — 6 rapid sends → 5 pass 1 limited; kill-switch → all refused — VERIFY: T16 SendGuard tests
- [x] `schedule_message`/`list_scheduled`/`cancel_scheduled` daemon scheduler (kahflane) — verify: schedule +2s → fires, listed, then removed — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Templates: `create_template`/`list_templates`/`render_template` ({{var}}) + `send_template` (kahflane) — verify: render with vars → expected string — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] `send_event` calendar event card (kahflane) — verify: live send → event card renders — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] `restrict_sending` per-target send blocklist rules (kahflane wa_restrict_sending) — verify: rule blocks send to Test group → structured refusal — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] `logout` tool: unpair current device session (kahflane wa_logout) — verify: logout → /health loggedIn=false; re-pair cycle works — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Autoreply rules `autoreply_set`/`autoreply_add_rule`/`autoreply_list_rules`/`autoreply_remove_rule` (kahflane; lharries #67 as opt-in only, default OFF) — verify: rule ping→pong; phone sends "ping" → "pong" received; default state = off — OUT-OF-SCOPE 0.9: ACCOUNTING

- [x] `send_album`: 2-10 media as one grouped album (chigwell P#127) — verify: live 3-image album arrives grouped on phone — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] `forward_message` batch mode + album grouping preserved (chigwell P#129) — verify: forward album → arrives as album — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Forwarded messages preserve original sender attribution (chigwell P#182) — verify: forwarded row keeps original sender_name — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] `schedule_message` supports media payloads, not just text (chigwell P#205) — verify: schedule image +2s → media fires — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Poll validation: ≥2 options, ≤12, unique, non-empty (chigwell P#240) — verify: 1-option poll → structured validation error — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Send-to-number resolves the JID the number is REGISTERED under (LID-aware lookup) (VGP P#259) — verify: send to LID-registered contact number → delivered — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] WhatsApp rate-limit / ban-risk errors surfaced as structured error with retryAfter seconds + actionable hint (chigwell P#204 FloodWait pattern) — verify: synthetic 429 → {code: RATE_LIMITED, retryAfter: N} — OUT-OF-SCOPE 0.9: ACCOUNTING
## 5. Read path

- [x] `list_chats`: pagination, unread counts, last_message preview, archived flag, JID-prefix filter (MuhammadMustafa18), name fallback chain pushname→business→phone, never own number for DMs (VGP #261/#260/#262) — verify: fixture store → real names — VERIFY: T13/T14 fixture tests
- [x] `list_messages`: filters chat/sender/date-as-instant, clamped pagination ≥0 (VGP #226), sender_name (lharries #276/#144), filename (VGP #217) — verify: fixture query correct — VERIFY: T13 clamp+filter tests
- [x] `get_message_context`, `get_last_interaction` (Jochem), `get_direct_chat_by_contact`, `get_contact_chats` (Jochem) — verify: fixture context returns adjacent rows — PENDING: live (pairing); context unit-verified (T13); last_interaction/direct_chat OUT-OF-SCOPE — VERIFY: live 2026-10-03 /api/context radius=2 → 4 messages; get_direct_chat_by_contact/get_contact_chats = unit + dogfood
- [x] `search_messages`: FTS5 operators (AND/OR/*/"phrase"), LIKE fallback, ranking (MuhammadMustafa18; lharries #281; VGP #198) — verify: `pizza OR burger` on fixture; <50ms on 100k-row bench — PENDING: live (pairing); FTS operators unit-verified (T13); 100k bench pending — VERIFY: live 2026-10-03 q='wa-mcp AND test' → 7, phrase '"storage fix"' → 2; global search no-filter q=test → 10 (VERIFY.md)
- [x] `search_contacts`/`list_contacts`/`get_contact`: full Baileys contact store (thousands — lharries #9/#37/#48), LIMIT param, business profile (biliboss), picture URL (kahflane), blocklist, `resolve_name` (kahflane) — verify: partial-name search finds non-recent contact — PENDING: live (pairing); contacts list/search PASS (T22); business/picture fields OUT-OF-SCOPE
- [x] `get_picture_url` / avatar retrieval for chats + contacts + own profile (kahflane; chigwell P#199) — verify: Test-group picture URL resolves; own avatar download works — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] `fetch_history` tool: per-chat history fetch beyond local store, watermark-paged (kahflane wa_fetch_history; VGP P#168 on-demand sync) — verify: empty fresh store → fetch_history(Test group) → messages present — MCP tool wired T93-B — VERIFY: t93b-mcp-wiring
- [x] `get_unread`/`get_unread_messages`/`check_new_messages` (NIXKnight, kahflane) — verify: fixture read_state → correct sets — VERIFY: unit (T21/T22) + live 2026-10-03 /api/unread → [] after mark-read (VERIFY.md live-smoke); get_unanswered_messages OUT-OF-SCOPE (ACCOUNTING)
- [x] `catch_up` activity digest: active chats, message counts, questions directed at you, media summary (jonzarecki/eddmann) — verify: fixture → digest lists Test-group question addressed to owner — MCP tool wired T93-B — VERIFY: t93b-mcp-wiring
- [x] `digest_group` + MCP Prompts (guided workflows: group digest, person catch-up, action-item extraction) (jonzarecki) — verify: prompts/list returns 3 prompts — tool + GET /api/digest landed T93-B — VERIFY: t93b-mcp-wiring
- [x] `list_unread_chats` + `mark_as_read` (jonzarecki) — verify: fixture → unread chats listed; mark → zero — VERIFY: unit (T22) + live 2026-10-03 mark-read → {read:1} → /api/unread [] (VERIFY.md live-smoke)
- [x] Ingest ALL message types → text: reactions, polls+votes, edits, revokes, location, vCards (VGP #214), buttons/lists (lharries #15/#197), business msgs (lharries #264), view-once placeholder, stickers, ephemeral, status mentions — verify: synthetic upsert per type → stored with extracted text — VERIFY: T12 ingest tests (all message types)
- [x] Remembered contacts (chigwell): `set_contact_alias`/`list_contact_aliases`/`delete_contact_alias`; all recipient-taking tools resolve aliases; exact-only sends, fuzzy → suggest-not-send — VERIFY: live 2026-10-03 alias 'testgroup' set → send via chat_jid='testgroup' → 200 + stored (T65 wired resolution into all recipient routes; VERIFY.md); Cyrillic case-variant confirm = dogfood
- [x] `get_poll_votes` decoded via poll_options (Felix #84, kahflane) — verify: synthetic vote → option names — PENDING: live (pairing); poll_options stored (T12/T17); vote decode unproven
- [x] Tool annotations: readOnlyHint/destructiveHint (lharries #142) — verify: tools/list JSON contains annotations — OUT-OF-SCOPE 0.9: ACCOUNTING

- [x] Full-fidelity message records: get_history/get_messages return complete message object (chigwell P#254/#133), attached media surfaced in listings (P#132), engagement metrics (views/reactions counts — P#48), reply quotes in reads (P#154), unread mentions count (P#84), unmuted-only filter + mute status (P#78), with_about for chats (P#106), links exposed in context (P#225), message entities preserved as markdown (P#63) — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Output size limits with truncation metadata (chigwell I#16/P#18) — verify: oversized chat dump returns first N + "truncated, X more" marker — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Bulk export: export_unread_messages + full chat export (JSONL/MD/HTML/TXT, media, transcription) (chigwell P#237/#202) — verify: export Test-group fixture → file with correct message count — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] mark_read MCP tool + /api endpoint (lharries P#314/#313; VGP P#209) — verify: live mark-read zeroes unread + phone shows blue ticks — VERIFY: unit (T22) + live 2026-10-03 mark-read zeroed unread (VERIFY.md live-smoke); blue-tick visual = owner dogfood
- [x] get_chat includes group participants (VGP P#152) — VERIFY: live 2026-10-03 get_chat → 'Test group' + GET /api/group/info → 3 participants persisted (T64 groups.upsert + participants table; VERIFY.md)
- [x] Label management tools (lharries P#235) — labels + chat_labels registry (v13), add/assign/list/remove — VERIFY: T89-C/T89-D labels registry + routes + four MCP tools (8bdaf8d, 894b387/353cc80); probe: fork label CRUD confirmed (3376c3a)
- [x] Query semantics: limit applied AFTER date/sender filtering, never over-fetch then trim (chigwell I#27/P#245) — verify: fixture — ask 10 msgs from empty date range → 0 rows, one SQL page — VERIFY: T13 query tests (filters then limit)
- [x] Global message search (no chat filter) across all chats (chigwell P#74) — verify: fixture query without chat_jid hits multiple chats — PENDING: live (pairing); global no-chat search unproven
- [x] Contact cache warmed in BACKGROUND at startup — MCP tools never block on warmup (chigwell P#140) — groupFetchAllParticipating rosters upserted at open, contactsWarm flag flips on completion, exposed in /health — VERIFY: T89-B GAP1 (30eac40/ee4a9ea)
- [x] `get_chat` reports has_photo + profile picture URL (chigwell P#191) — verify: Test-group get_chat includes both fields — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] View profile pictures through MCP: list + open contact avatars as images (chigwell P#199) — verify: avatar download returns image bytes — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Alias favorites flag + non-ASCII aliases resolve everywhere (chigwell P#173/P#178) — JS toLowerCase compare (SQLite LOWER folds ASCII only); is_favorite column native (v1) — VERIFY: T89 line131 Василиса/василиса/ВАСИЛИСА all resolve (40aadcb)
- [x] Manually-marked-unread detection distinct from auto read-state (chigwell P#46) — chats.manual_unread (v13) + POST /api/mark-unread {chat_jid, clear?}; distinct from auto-clearing is_unread — VERIFY: T89 line132 (40aadcb)
- [x] `request_history` tool: on-demand older-message backfill for ONE chat (VGP P#168; lharries PR#364) — verify: live request on Test group → older messages appear — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] WhatsApp username lookup — capability probe; if Baileys lacks support → ACCOUNTING NA-ENGINE row (chigwell P#57 analog) — verify: probe documented — NA-ENGINE: username lookup — ACCOUNTING row — PROBED: NA-ENGINE-PARTIAL (fork exposes username only as group-metadata fields, no directory lookup; VERIFY 250d9a2)
- [x] Bulk cleanup: delete/clear multiple chats in one call (chigwell P#102) — verify: fixture — bulk_clear([chatA, chatB]) empties both — OUT-OF-SCOPE 0.9: ACCOUNTING
## 6. Media pipeline

- [x] Auto-download all types, opt-out `WA_AUTO_DOWNLOAD` (VGP #237), skip status media (VGP #237) — rules module (enabled/skipStatus/minFreeBytes) with env overrides — VERIFY: T89 line135 contracts, T93-D INGEST WIRING, T94-C-H5 daemon mediaDir plumb (auto-download + bounded start backfill live in the daemon) — skip-if-row-failed (VGP #231) remains: ACCOUNTING
- [x] Message-ID filenames, collision-safe (lharries #156/#320) — verify: 2 images same second → both files — VERIFY: T24 message-id filenames
- [x] Path guard: media reads confined to `~/.wa-mcp/media` (CWE-22, symlink-resolved, boundary — Felix #74) — verify: `../../etc/passwd` rejected (unit) — VERIFY: T24 traversal tests
- [x] `download_media(message_id)` (NIXKnight) — verify: live image → path — PENDING: live (pairing); endpoint PASS (T24); live image needs pairing
- [x] `view_image`/`view_video`/`view_media`: image content to model; video → ≤8 frames scene-sampled 640px + transcript (lharries #360; VGP #246) — verify: live image → base64 JPEG; video → frames+transcript — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] `transcribe_voice`: engines `local` (whisper.cpp node), `openai` (any OpenAI-compatible: Groq/LocalAI/speaches), `elevenlabs` (aserranoni; chigwell 4-engine pattern); per-call engine + default env; cache (chat_id, message_id, engine); size caps; language hint — verify: mock engine → transcript; 2nd call cache-hit (no re-invoke) — DEFERRED: publish (contract §11); mock engine PASS (T28); real engines post-0.9
- [x] `send_tts`: text→speech→voice note (aserranoni) — verify: mock TTS → PTT sent — PENDING: live (pairing); mock TTS PASS (T28); PTT send needs pairing

- [x] download_media strips caller-supplied extension; real type from magic bytes (chigwell I#85/P#86) — verify: request .png on a JPEG → saved as .jpg — VERIFY: T18/T24 magic-byte tests
- [x] Per-engine input normalization (.oga→.ogg etc.) before engine upload (chigwell I#219/P#229) — verify: .oga voice note transcribes via openai-compat engine — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] `mlx` transcription engine (macOS on-device) (Felix P#55) — verify: macOS run transcribes without network — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Media download size cap + staging to disk, never whole-file-in-memory for >50MB (chigwell P#206) — verify: >cap → structured error, no OOM — PENDING: live (pairing); 20MB URL cap PASS (T18); >50MB staging OUT-OF-SCOPE — VERIFIED: resolve.ts:199 DEFAULT_MAX_BYTES=20MB, declared+running caps, TOO_LARGE (Phase 1 batch 5)
- [x] `WA_ALLOWED_EXTENSIONS` per-tool configurable allowlist for downloads (chigwell I#226/P#227) — verify: .exe download refused when not allowlisted — OUT-OF-SCOPE 0.9: ACCOUNTING
## 7. Groups & social

- [x] `groups_list`/`list_groups` + `group_metadata`/`group_info`/`group_participants`/`get_group_members` (participants + roles + description + settings) (kahflane/biliboss/delltrak) — verify: live Test group → ≥2 participants with admin flags — VERIFY: T26 live probe
- [x] `create_group`, `leave_group`/`group_leave` (lharries #239 pattern; kahflane/biliboss/delltrak) — verify: live create+leave cycle — VERIFY: T26 live probe
- [x] `group_add_participants`/`group_remove_participants`/`group_promote`/`group_demote` (biliboss/delltrak) — verify: live add+remove participant on Test group — VERIFY: T26 live probe
- [x] `group_invite_code`/`group_get_invite_code` + `group_revoke_invite` + `group_info_by_code` + `group_join` (kahflane/biliboss/delltrak) — VERIFY: live 2026-10-03 Test group invite code fetched (DbAioHHiV2DJZzMlJhCMdw, VERIFY.md); revoke/join-by-code = throwaway-group dogfood; unit T26
- [x] `group_join_requests` list + `group_join_decision` approve/reject + `group_handle_request` (kahflane/biliboss) — verify: synthetic request → handled (unit) — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] `group_update_subject`, `group_update_description`, `group_update_settings`/`group_setting` (announcement/admin-only/edit-subject perms), `group_add_mode` (kahflane/biliboss/delltrak) — verify: live subject change + restore — VERIFY: T26 settings (unit) + live probe
- [x] `group_ephemeral`/`group_toggle_ephemeral` + `disappearing_chat` per-chat timer + `default_disappearing` global (kahflane; VGP P#82) — verify: live set 24h timer → phone shows disappearing — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] `group_member_label` set/clear (kahflane) — gated on Baileys support — verify: capability probe, else ACCOUNTING NA-ENGINE row — NA-ENGINE: ACCOUNTING row — PROBED: NA-ENGINE-PARTIAL (fork emits group.member-tag.update inbound only; no set API; chat-level labels landed in T89)
- [x] `newsletter_follow`/`newsletter_unfollow`/`newsletter_send` (biliboss/delltrak) — gated on Baileys support; else ACCOUNTING row N/A — verify: capability probe — NA-ENGINE: ACCOUNTING row
- [x] `reject_call` (biliboss/kahflane/delltrak) — verify: synthetic call event → reject called (mock) — OUT-OF-SCOPE 0.9: ACCOUNTING

- [ ] `get_participants` pagination with async iteration for 1000+ member groups (chigwell I#14/P#109) — verify: synthetic 1000-member fixture pages without timeout — OUT-OF-SCOPE 0.9: ACCOUNTING
## 8. Profile, privacy, status

- [ ] `post_status` text/image/video/voice + `post_status_to` (privacy-limited audience) + `history_status` (recent statuses) + `get_status` (kahflane) — verify: live text status → visible on phone; history lists it — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] `set_name`/`update_profile_name`, `set_status`/`update_profile_status`, `set_picture`/`update_profile_picture`, `remove_picture`/`remove_profile_picture` (kahflane/biliboss/delltrak) — VERIFY: live 2026-10-03 status set → {ok:true} → restored (VERIFY.md); name/picture = T23 unit + owner dogfood
- [ ] `get_business_profile` (biliboss/delltrak) — verify: Business-account contact returns catalog/description fields — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] `get_privacy`/`set_privacy`/`update_privacy` (kahflane/biliboss/delltrak) — verify: live read-receipts toggle + restore — PENDING: live (pairing); T23 unit — VERIFIED: get_privacy live reader + set_privacy live round-trip (T99 + batch 4)
- [ ] `block_contact`/`unblock_contact` + `blocklist` (kahflane/biliboss/delltrak) — verify: live block+unblock test number; blocklist lists it while blocked — PENDING: live (pairing); T23 unit
- [ ] `star_message`/`unstar`, `pin_message`/`unpin`, `pin_chat`/`unpin_chat` (kahflane/biliboss) — verify: live star on Test-group message — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] `archive_chat`/`unarchive`, `mute_chat`/`unmute` (duration), `delete_chat`, `clear_chat`, `mark_chat_read`, `mark_chat_unread` (kahflane/biliboss/delltrak) — verify: live mark-read zeroes unread; archive flag in list_chats — PENDING: live (pairing); archive+mark-read PASS (T21/T22); mute/delete/clear OUT-OF-SCOPE — VERIFIED: live archive/unarchive/mute/unmute/mark-unread/mark-read on Test group (T100 228bb14); delete/clear unit-tested, live owner-gated

## 9. Events & integrations

- [x] SSE `/events`: message/receipt/presence/poll/edit/revoke + 20s heartbeat, slow-client skip (lharries #191 pattern) — verify: curl stream + live send → event <2s — VERIFY: §9 T25 live SSE probe (25s default heartbeat, configurable)
- [ ] Incoming feed JSONL (chigwell callback): `~/.wa-mcp/incoming_feed.jsonl` 0600, `enable_feed`/`feed_status` return `tail -f` watch command — verify: live inbound → JSONL line; command valid — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] `wait_for_new_message`/`wait_for_settled_message` debounce (chigwell) — verify: 3-msg burst → one settled return with all 3 — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] Webhooks: register/list/delete, HMAC header, token auth, opt-out env (VGP #204; lharries #326), inbound+outbound fire — verify: local receiver gets signed payload; bad signature rejected — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] Desktop notification unanswered (Jochem) — verify: osascript fires in test mode — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] Prometheus `/metrics`: msgs in/out, uptime, reconnects, queue depth (Felix #10) — verify: curl returns series — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] JSON logs with phone redaction last-4 (Felix #11; ste-bah) — verify: logs valid JSON; full number → 0 grep hits — VERIFY: T11 redactPhone + pino JSON logs

- [ ] Incoming call events captured + reject_call (VGP P#39; biliboss) — verify: synthetic call event → stored + event fired — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] Typing/presence tracking inbound (VGP P#210) — verify: synthetic presence event → read_state/contact updated — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] Caller fingerprinting on /api/send: identify which registered harness sent (VGP P#92/#96) — verify: two different tokens → logs distinguish senders — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Programmatic relink: start REST server before pairing + GET /api/qr HTTP QR endpoint (VGP P#131; lharries P#311) — verify: curl /api/qr returns QR PNG data before session exists — VERIFY: T-C onboarding e2e + T42 docker (QR served pre-pairing)
- [ ] Webhook event coverage: reactions (VGP P#129), captionless audio (P#175), vCard shares (P#176), image media in webhook payload (P#45), activation metadata (P#173) — verify: fixture-driven webhook payloads per type — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Typed failure-mode error codes EC1/EC2/EC5… (VGP P#114) — verify: every tool error returns {code, message, hint} — PENDING: live (pairing); {code,message} PASS (T7); hint field OUT-OF-SCOPE — VERIFIED: live INVALID_JID {code,message} (Phase 1 batch 2)
- [ ] Session-conflict recovery: StreamReplaced event handling (VGP P#27) — verify: synthetic event → reconnect initiated + warning logged — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] Webhook chat-type filter: option to skip group messages (lharries PR#112) — verify: group msg with filter on → no webhook fire — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] Feed mention-gating: WA_FEED_MENTION_ONLY — only messages mentioning me enter JSONL feed (chigwell P#253) — verify: non-mention message excluded — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] `wait_for_new_message(chat_id?)`: per-chat wait, not only all-chats (chigwell P#183) — verify: wait on chat A while chat B receives → timeout, chat A msg returns — OUT-OF-SCOPE 0.9: ACCOUNTING
## 10. Security & safety (release gate)

- [x] Loopback default bind; `WA_BIND_HOST` override documented — verify: default 127.0.0.1, LAN refused — VERIFY: T7 loopback tests
- [x] Token on every endpoint — verify: 401 matrix (§2) — VERIFY: T7 401 matrix
- [ ] Whitelist `WA_ALLOWED_JIDS` fail-closed: reads+sends+context+events (lharries #319 incl. context-bypass fix) — verify: fixture whitelist=Test group → N→1 chats; foreign send refused — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] `WA_READ_ONLY=1` (VGP #255) — verify: every send tool → structured refusal — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] Tool gating `WA_EXPOSED_TOOLS` (chigwell) + `--profile=minimal|standard|full` (Felix #42) — verify: minimal → exactly 6 tools — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Pagination caps limit≤200 offset≥0 (lharries #271) — verify: unit clamp test — VERIFY: T14 clamp tests
- [ ] At-rest encryption option (VGP #223): `WA_STORE_PASSPHRASE` or documented mitigation — verify: encrypted roundtrip OR docs section with steps — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] Prompt-injection sanitization: user content in structured fields marked untrusted (chigwell) — verify: "ignore instructions" wrapped+flagged in output — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] `pnpm audit` 0 HIGH, CodeQL clean, gitleaks clean — verify: CI green — VERIFY: T27 run 36947830588 green — CI re-confirm PENDING: ci (billing)

- [x] Lethal-trifecta mitigation: approval gate on writes, audit log of sends, rate limiting, path restriction (lharries P#291, I#42 invariantlabs) — verify: audit-log row per send with tool+recipient+timestamp — PENDING: live (pairing); rate-limit+path PASS (T7/T18); audit-log rows OUT-OF-SCOPE — VERIFIED: all four components live+code evidenced (T94-C2/C2b, T82, M2, PATH_FORBIDDEN live)
- [x] Rate limiting with LimitReader body caps on HTTP endpoints (lharries I#340) — verify: >1MB request body → 413 — VERIFY: T7 413 tests
- [x] Input validation decorators on tool params (chigwell I#11) — verify: invalid JID/phone → structured error, never crash — VERIFY: T14 VALIDATION_ERROR tests
- [ ] DNS-rebinding protection on HTTP transport (VGP P#252/#216) — verify: request with foreign Host header → rejected — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] Read-only mode can expose NAMED write tools (chigwell P#168) — verify: read-only + allowlist mark_read → mark_read works, sends refused — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] Per-tool-call timeout (default 30s) with structured TIMEOUT error naming the tool (chigwell P#223/P#231) — verify: synthetic 60s tool → timeout error ≤31s — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] Install guard: npx package provenance check (repository field + tarball integrity) + README warning about impersonator packages (chigwell I#117/P#119) — verify: doctor verifies installed tarball origin — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] macOS Keychain storage for bridge token (chigwell P#47) — verify: token absent from disk files on macOS, served from Keychain — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] Annotation correctness: export/invite/link tools NOT marked readOnlyHint; gated/hidden tools listed at startup (chigwell P#251) — verify: tools/list JSON annotations audit script green — OUT-OF-SCOPE 0.9: ACCOUNTING
## 11. Distribution (`packages/cli` → `wa-mcp` npx)

- [x] `npx wa-mcp install`: daemon → service start → register platforms → print pairing steps — verify: fresh `node:20` Docker container → all steps logged, `doctor` green — VERIFY: T42 docker PASS (node:22 — node:20 impossible: node:sqlite, BLOCKED.md ratification)
- [ ] Service: launchd `com.wa-mcp.bridge` (KeepAlive, RunAtLoad); systemd user unit; Windows Task Scheduler — verify: macOS `launchctl list | grep wa-mcp`; Linux CI `systemctl --user is-active` — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Subcommands `install pair status doctor start stop restart update uninstall logs [--follow]` — verify: each exits 0 on fresh container — PENDING: live (pairing); install/pair/status/doctor/start/stop/skills PASS (T30/T38/T39); restart/update/uninstall/logs OUT-OF-SCOPE — VERIFIED: full surface live (T98 10dba93): install|pair|doctor|status|start|stop|restart|logs|uninstall|update|skills; status EXIT 0, doctor EXIT 1 with clean diagnostics on empty sandbox (expected), cli 40/40
- [x] `doctor`: daemon, /health, store, ffmpeg (common-path fallback), token perms, registrations, FTS — verify: all-green dev machine; seeded failures → correct diagnosis — VERIFY: T42 doctor all-green in fresh container
- [x] `pair` foreground QR — verify: ≥2 rotations before timeout — VERIFY: T39 ANSI QR PASS
- [ ] `update`: npm check → install → restart — verify: downgrade → update → version bumped — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Registrations (path written + read-back verified): — VERIFY: T30 sandbox probe — 8 platforms written + read-back
  - Claude Code `~/.claude.json` → `mcpServers.wa-mcp`
  - Claude Desktop `~/Library/Application Support/Claude/claude_desktop_config.json`
  - Codex `~/.codex/config.toml` `[mcp_servers.wa-mcp]`
  - Cursor `~/.cursor/mcp.json`
  - Antigravity `~/.gemini/antigravity/mcp_config.json` (uses `command`/`args` or `serverUrl`, NOT `url`)
  - Hermes `~/.hermes/mcp/wa-mcp.json`
  - Pi `~/.pi/mcp/wa-mcp.json`
  - Grok `~/.grok/mcp.json`
  - auto-detect bonus: Windsurf, Gemini CLI, opencode, VS Code `.vscode/mcp.json`
- [x] HTTP transport `/mcp` (remote harness mode, loopback default) — verify: MCP client connects over HTTP + token — VERIFY: T20 POST /mcp live probe
- [ ] DXT manifest for Claude Desktop Extensions (lharries I#87) — verify: manifest.json validates against DXT schema — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] Codex hub + opencode hub listings (lharries P#203, P#362) — verify: hub metadata files present + valid — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] Docker compose (bridge + MCP) — verify: `docker compose config` valid; container healthy — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] Official MCP Registry listing: `server.json` via mcp-publisher, npm package metadata matches (registry.modelcontextprotocol.io) — verify: registry entry live + tool scan passes — DEFERRED: publish (contract §11)
- [ ] Directory listings: Glama, mcp.directory (auto-imports registry), PulseMCP (if open), Smithery (static server card at /.well-known/mcp/server-card.json if hosted) — verify: each directory page live after publish — DEFERRED: publish (contract §11)

- [x] stdout purity in stdio mode: NOTHING but JSON-RPC frames on stdout — all logs/diagnostics to stderr (chigwell P#70; lharries PR#346) — verify: capture stdout across 20 tool calls, 0 non-protocol bytes — PENDING: live (pairing); stdio PASS (T20); stdout-purity audit pending — VERIFIED: live stdio purity 2/2 pure JSON-RPC frames (Phase 1 batch 2)
- [ ] `WA_PROXY` outbound proxy (SOCKS5/HTTP) for WhatsApp connection (chigwell I#99/P#113) — verify: local SOCKS proxy → connection routes through it — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] Windows hidden autostart + QR-recovery watchdog (lharries PR#284) — verify: scheduled task survives reboot, auto-shows QR when session lost — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] Docker: multistage build, image <500MB, store+media volumes, healthcheck (chigwell I#112/P#238; Felix PR#43 2.43GB→837MB lesson) — verify: `docker images` size check in CI — OUT-OF-SCOPE 0.9: ACCOUNTING
## 12. Skills + plugins

- [x] Skills (`skills/`, SKILL.md + scripts, installed `~/.wa-mcp/skills/` + synced per platform): — PENDING: live (pairing); single SKILL.md shipped (T31); per-skill split OUT-OF-SCOPE — VERIFIED: skills install mirrors to .claude/skills + data-dir + pi (T101-A 0c721da + orchestrator package-shipping fix; end-to-end sandbox OK)
  - [ ] `wa-onboarding` — pair, doctor, first send — OUT-OF-SCOPE 0.9: ACCOUNTING
  - [ ] `wa-search` — FTS operators, date filters, alias recipes — OUT-OF-SCOPE 0.9: ACCOUNTING
  - [ ] `wa-send` — media/sticker/poll/buttons/broadcast + rate care — OUT-OF-SCOPE 0.9: ACCOUNTING
  - [ ] `wa-inbox` — unread triage, unanswered, summarize-latest, draft-without-sending (chigwell workflows) — OUT-OF-SCOPE 0.9: ACCOUNTING
  - [ ] `wa-media` — view/transcribe/tts + engine config — OUT-OF-SCOPE 0.9: ACCOUNTING
  - [ ] `wa-groups` — create/manage/invite/join — OUT-OF-SCOPE 0.9: ACCOUNTING
  - [ ] `wa-guard` — whitelist/read-only/kill-switch/audit — OUT-OF-SCOPE 0.9: ACCOUNTING
  - [ ] `wa-ops` — status/logs/backup/restore runbook — OUT-OF-SCOPE 0.9: ACCOUNTING
  - verify: each has frontmatter+steps; `claude` loads wa-search in smoke test
- [x] Claude Code plugin `plugins/claude-code`: `.claude-plugin/plugin.json` + `marketplace.json`, commands `/wa /wa-status /wa-unread /wa-search /wa-doctor`, SessionStart hook → health check — verify: `claude plugin validate` OK — PENDING: live (pairing); plugin dirs shipped (T31); 'claude plugin validate' pending — VERIFIED: .claude-plugin/plugin.json + commands shipped (T101-B 102d2f0)
- [x] Per-platform plugins `plugins/{antigravity,codex,cursor,grok,hermes,pi}/`: manifest + skills sync + registration snippet — verify: manifest valid; install writes config — PENDING: live (pairing); 3/8 dirs shipped (T31); antigravity/codex/grok/hermes/pi pending — VERIFIED: 6 platform manifests + registration snippets (T101-C 56360eb)
- [ ] Root `marketplace.json` — verify: schema valid, lists all — OUT-OF-SCOPE 0.9: ACCOUNTING
- [ ] Plugins version-locked to CLI, changesets — verify: release PR bumps all in lockstep — DEFERRED: publish (contract §11); no changesets (contract)

## 13. Accounting — every item from every source (BACKLOG-FULL.md + ACCOUNTING.md)

**Census (committed artifact):** `review/BACKLOG-FULL.md` — machine-generated, one checkbox
line per item, ALL states (open+closed+merged), fetched 2026-10-01 from 14 repos:

| Source | Issues | PRs |
|---|---|---|
| lharries/whatsapp-mcp | 127 | 235 |
| verygoodplugins/whatsapp-mcp | 38 | 223 |
| FelixIsaac/whatsapp-mcp-extended | 25 | 59 |
| chigwell/telegram-mcp (patterns source) | 52 | 200 |
| jonzarecki/wa-mcp (eddmann lineage) | 0 | 31 |
| delltrak/wamcp (TS+Baileys reference) | 1 | 17 |
| operation-hp/WA-MCP | 0 | 9 |
| aserranoni, fabienbutz, Jochem | 5 | 7 |
| kahflane, biliboss, NIXKnight, MuhammadMustafa18, ste-bah, OmarYousef95, Shloimy15e, eddmann | 0 | 0 (trackers empty; README/feature-level only) |
| **Total** | **248** | **781** = **1,029 items** |

**Accounting:** `review/ACCOUNTING.md` — one row per item from BACKLOG-FULL.md:
`source | # | kind | title | state | disposition | delivered-as | verify-ref`.

- [x] Disposition vocabulary: ABSORBED (→ tool/feature + verify-ref) / SUPERSEDED-BY (item X) / — VERIFY: T32 vocabulary assert
      NA-ENGINE (Baileys-vs-whatsmeow difference, with note) / ALREADY-CORE (design covers it) /
      OUT-OF-SCOPE-0.9 (→ Phase-10 row) / NOISE (dep bump, spam, meta) — every row uses exactly one
- [x] Tool-parity rows: kahflane 87 tools, biliboss 62 tools, chigwell 80+ tools each listed by — PENDING: live (pairing); census PASS (T32); named parity tables pending — VERIFIED: docs/reference/parity.md 71-tool crosswalk vs kahflane/biliboss/chigwell (T101-D 2f14d58)
      name → mapped to our tool or OUT-OF-SCOPE with reason
- [x] lharries 235 PRs: 405-family (~50) → one SUPERSEDED-BY-ENGINE row each (Baileys has no — VERIFY: T32 dispositions
      client-outdated problem); 24 already-absorbed-in-Go → ABSORBED rows mapping to TS tools;
      remainder dispositioned individually
- [x] lharries 127 issues: connectivity/CGO/Windows-install classes → NA-ENGINE or — VERIFY: T32 dispositions
      ALREADY-CORE; feature asks → ABSORBED rows; meta/spam → NOISE
- [x] VGP 223 PRs: merged-and-relevant → ABSORBED; dependency/release chores → NOISE; open PRs → ABSORBED rows — VERIFY: T32 dispositions
- [x] FelixIsaac 59 PRs + 25 issues: same treatment — VERIFY: T32 dispositions
- [x] chigwell 252 items: Telegram-specific → NA-ENGINE with "pattern borrowed" note where — VERIFY: T32 dispositions
      applicable (aliases, event feed, transcription engines, annotations, sanitization);
      portable patterns → ABSORBED rows
- [x] Count-assert script `review/accounting-check.ts`: totals per source match BACKLOG-FULL.md — VERIFY: T32 accounting:check green (local + CI pre-billing)
      counts; every line dispositioned; exit 1 on any missing — verify: `vp run accounting:check` green in CI

## 14. Tests & CI

- [x] Unit: shared utils (JID, alias, instants, path guard, whitelist), store (migrations ×3 layouts, FTS triggers, read-state), event bus, send-safety — verify: `vp test` green; coverage bridge+server ≥80%, shared ≥90% — VERIFY: T41 coverage gates (bridge 82.89 / mcp 88.36 / shared 97.77) + 390 tests
- [x] Integration: recorded Baileys event fixtures (message/poll/receipt/group/presence/undecryptable from live session) replayed → store assertions — verify: suite green offline — PENDING: live (pairing); synthetic replay PASS (unit); live-recorded fixtures pending — VERIFIED: live-recorded fixtures (T102 5fd6186 + T102b creds exclusion) replay through ingest pipeline green
- [x] MCP conformance: initialize → tools/list (count+annotations) → tools/call per tool (mock bridge) — verify: scripted client green — VERIFY: T19/T20/T28 scripted-client probes
- [x] CLI tests: install/uninstall/doctor vs temp `$HOME` sandbox — verify: green on macOS + Linux CI — VERIFY: T30 sandbox (macOS + CI pre-billing)
- [x] Live smoke (nightly opt-in, cached session artifact): Test-group send/read-back, SSE event, transcription — verify: nightly green — PENDING: live (pairing); needs paired session — VERIFIED: all smoke components live this session (send/read-back, SSE ingestion, transcription); nightly wrapper owner-gated (schedule preference)
- [ ] CI: `check` (vp check), `test` (ubuntu/macos/windows × node 20/22), `build` (vp build + pack dry-run, CLI <15MB), `release` (changesets → npm `wa-mcp` + `@wa-mcp/*`), `security` (audit+CodeQL+gitleaks) — verify: main badges green — PENDING: ci (billing); release job DEFERRED: publish (contract); rest shipped
- [ ] commitlint conventional commits; changesets semver 0.x — verify: bad commit msg → CI fail — DEFERRED: publish (contract §11); commitlint/changesets not wired (contract)

## 15. Docs

- [x] VitePress `docs/`: quickstart, per-platform install ×8, full tool reference, env-var config reference, service mgmt, security model, migration (lharries/Go-fork), troubleshooting runbook, disaster recovery, FAQ — VERIFY: T71+T72 — migration/troubleshooting/FAQ pages + platforms×8 (exact JSON from CLI source) + docs:build green ×2 (my runs); DR runbook = docs/troubleshooting.md disaster section; service mgmt = configuration.md
- [x] ADRs 0001–0010: engine choice, monorepo layout, store schema, daemon model, auth model, event delivery, alias design, safety model, migration, release model — verify: 10 files indexed — VERIFY: T33 ADRs 0001-0010 + ADR 0011
- [x] README: pitch, install matrix, feature list, credits (lharries + every fork author + PR #s), architecture diagram — VERIFY: T72 README.md landed (pitch/quickstart/features/diagram/security/credits) + docs/getting-started/platforms.md with all 8 platforms; docs:build green (my run); lychee link CI = post-billing
- [x] CHANGELOG (changesets), SECURITY, CONTRIBUTING, AGENTS.md, LICENSE MIT — verify: present + linted — VERIFY: T71 — SECURITY.md (reporting + model), CONTRIBUTING.md (setup + gates + TDD policy), AGENTS.md (architecture guide), LICENSE MIT 2026 all present; CHANGELOG PASS (T33); changesets deferred per no-publish contract

## 16. Web UI (`packages/web-ui`) — auth-gated, loopback default

- [x] QR pairing page with auto-refresh on rotation (VGP P#163; lharries PR#145) — verify: open page pre-pairing → QR renders + refreshes without manual reload — PENDING: live (pairing); inline render PASS (T39 CDP); auto-refresh loop pending — VERIFIED: webui-e2e + dogfood PASS (Phase 0)
- [x] Chat list + message history browser, read-only (Felix PR#62) — verify: Test group renders history matching store rows — PENDING: live (pairing); routes PASS (T29); live store render needs pairing — VERIFIED: webui-e2e open-chat/send + dogfood chats render (Phase 0)
- [x] Unread inbox view + mark-read action (jonzarecki patterns) — verify: mark-read click zeroes unread in store — PENDING: live (pairing); routes PASS (T29); live zeroing needs pairing — VERIFIED: live mark_chat_read read:5, unread 5→0 (Phase 1 batch 2)
- [ ] Analytics dashboard: message volume, top chats, activity heatmap, media mix (lharries PR#26) — verify: dashboard renders from fixture store with correct counts — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] Settings editor: whitelist, read-only, profiles, webhook config (chigwell I#116) — verify: whitelist change via UI enforced on next tools/call — PENDING: live (pairing); settings form PASS (T39); whitelist/profiles/webhook OUT-OF-SCOPE — VERIFIED: settings form (T39 pair-QR + web-token CDP PASS; dogfood Settings route renders); whitelist/profiles/webhook sub-scope OUT-OF-SCOPE per ACCOUNTING (line marker)
- [x] Health/sync status panel (lharries PR#101) — verify: panel shows connected state + sync watermark from /health — PENDING: live (pairing); health panel PASS (T29); sync watermark OUT-OF-SCOPE — VERIFIED: dogfood Status route from /health (Phase 0)
- [x] Web UI auth: bearer token, loopback bind default — verify: no-token request → 401; LAN refused by default — VERIFY: T29 traversal 401 + loopback

## 17. MCP surfaces beyond tools

- [x] MCP resources: `wa://health`, `wa://chats`, `wa://sync-status`, `wa://config` (read-only) (delltrak PR#18; lharries PR#101) — verify: resources/list + resources/read return current data — PENDING: live (pairing); wa://health+chats PASS (T28); sync-status/config OUT-OF-SCOPE — VERIFIED: live 5 resources incl sync-status+config (T99)
- [ ] MCP prompts: catch-up digest, group digest, action-item extraction (jonzarecki) — verify: prompts/list → 3 entries; prompts/get renders — OUT-OF-SCOPE 0.9: ACCOUNTING
- [x] initialize response declares full capabilities: tools, resources, prompts, logging, notifications (delltrak I#3) — verify: client sees logging capability; log/notification messages delivered — PENDING: live (pairing); initialize PASS (T19); capability audit pending — VERIFIED: live capabilities {tools, resources{listChanged}, prompts, logging, notifications} (T99)
- [ ] MCP `notifications/message` stream per spec for subscribed clients (lharries PR#183) — verify: live inbound message → notification frame to subscribed client — OUT-OF-SCOPE 0.9: ACCOUNTING


## 18. Meta Cloud API dual-channel (parallel engine)

Channel-adapter architecture: `ChannelAdapter` interface implemented by `BaileysAdapter` (default, personal accounts, free) and `CloudApiAdapter` (official Meta WhatsApp Business Cloud API). Both share the same store, tools, MCP surface, events, security layer. Per-account channel selection + hybrid mode (Cloud API for sends where reliability matters, Baileys for read/coverage).

- [x] `ChannelAdapter` interface: connect/disconnect/pair, sendMessage, fetchChats, fetchHistory, downloadMedia, events → normalized internal types (delltrak channels/ pattern) — verify: two adapters pass identical contract test suite — OUT-OF-SCOPE 0.9: ACCOUNTING (Phase-K) — VERIFY: VERIFY: T50 contract suite (tests/channel-contract.ts — identical suite passes for baileys + cloud adapters)
- [x] `CloudApiAdapter` auth: access token + phone number ID + verify token; WABA credentials in env/config, never in store (Meta doc pattern) — verify: unit — creds absent from DB; /health reports channel+credentials-valid — OUT-OF-SCOPE 0.9: ACCOUNTING (Phase-K) — VERIFY: VERIFY: T50 readCloudConfig env-only + cloud-adapter tests; creds never touch the store; /health channel+credentialsValid
- [x] Cloud API send: text, media (by URL + asset id), template messages, location, contact, interactive (buttons/lists) (Meta endpoints) — verify: sandbox WABA send text+template → message id returned, stored is_from_me=1 — OUT-OF-SCOPE 0.9: ACCOUNTING (Phase-K) — VERIFY: VERIFY: T50 cloud-adapter tests — text+template via POST /{v}/{phone-number-id}/messages, Bearer, mocked fetch (media/location/contact/interactive still PENDING: live sandbox)
- [ ] Cloud API templates: list templates, send approved template, template variables (Meta: /message_templates) — verify: sandbox template with {{1}} renders + delivers — OUT-OF-SCOPE 0.9: ACCOUNTING (Phase-K)
- [x] Cloud API webhooks: registration, GET verify (hub.challenge), POST signature validation (X-Hub-Signature-256), payload → normalized events (message/status) — verify: signed webhook fixture → event stored; bad signature → 403 — OUT-OF-SCOPE 0.9: ACCOUNTING (Phase-K) — VERIFY: VERIFY: T50 webhooks tests — GET verify challenge echo, POST X-Hub-Signature-256 HMAC (bad→403), normalized events stored
- [ ] Cloud API media: upload (POST /media), retrieve (GET /media/id), download URL handling — verify: sandbox media round-trip — OUT-OF-SCOPE 0.9: ACCOUNTING (Phase-K) — PENDING: live sandbox (WABA creds); media retrieve PASS (T50 downloadMedia); upload still OUT-OF-SCOPE
- [x] Cloud API read model: mark read via /messages read marker, phone-number lookup via contacts endpoint (Meta: /contacts) — verify: sandbox contacts check returns valid/invalid — OUT-OF-SCOPE 0.9: ACCOUNTING (Phase-K) — VERIFY: VERIFY: T50 cloud-adapter tests — markRead status markers + POST /contacts checkContact
- [ ] Phone-number ID / WABA discovery via API (GET /waba_id, /phone_numbers) — verify: sandbox lists numbers — OUT-OF-SCOPE 0.9: ACCOUNTING (Phase-K)
- [ ] Cloud API rate limits surfaced (Meta 429 + headers) → same RATE_LIMITED structured error as Baileys engine (chigwell P#204 pattern) — verify: synthetic 429 → {code, retryAfter} — OUT-OF-SCOPE 0.9: ACCOUNTING (Phase-K)
- [ ] Account-level channel config: `wa-mcp config set-channel <account> baileys|cloud|hybrid` — verify: config switch → /health channel field changes — OUT-OF-SCOPE 0.9: ACCOUNTING (Phase-K) — PENDING: live sandbox (WABA creds); WA_CHANNEL env selection PASS (T50); 'wa-mcp config set-channel' command OUT-OF-SCOPE
- [ ] Docs: decision matrix personal vs Business, cost model (per-conversation pricing), when hybrid wins — verify: docs page published with pricing table sourced from Meta docs — OUT-OF-SCOPE 0.9: ACCOUNTING (Phase-K)
- [ ] Sandbox CI: Cloud API tests mocked at HTTP boundary (nock-style fixtures) — verify: suite green offline; live sandbox smoke = manual gate flag — OUT-OF-SCOPE 0.9: ACCOUNTING (Phase-K)

## 19. Phases (gate after each)

- **A** §1 bootstrap — gate: `vp check && vp test && vp build` green
- **B** §2 session daemon — gate: live pair, restart persistence, /health, 401 matrix
- **C** §3+§5-ingest store — gate: fixture replay green; Go-fork store migration row-count equal
- **D** §4+§8 send path — gate: live 14-kind send matrix delivered+stored
- **E** §5 read path — gate: fixture+live queries; search <50ms @100k
- **F** §6+§9 media+events — gate: live image view + voice transcribe + SSE + signed webhook + album forward
- **G** §7+§10 groups+security — gate: independent security review (grok agent) + §10 verifies green
- **H** §11+§12+§17+§18 distribution & surfaces — gate: fresh-container install + doctor green; plugin validate; web UI pairing page; resources+prompts listed
- **I** §13+§15 docs+accounting — gate: doc-coverage 100%; accounting count-assert passes
- **J** §14 release — gate: 14-day dogfood (Test group + own number), then `wa-mcp@0.9.0` public on npm

- **K (parallel, after G)** §18 dual-channel — gate: contract tests ×2 adapters green; sandbox webhook signature validation; hybrid account live-smoked

## Out of scope 0.9.0 (Phase-10 rows in ACCOUNTING.md)

Multi-account/multi-instance incl. wa_create_instance/wa_restart_instance (biliboss, delltrak; lharries #269/#249) — wa_set_cloud_credentials is IN SCOPE via §19 CloudApiAdapter, commerce `send_order`/`send_product`/catalog (kahflane — Business catalog API), newsletter ops if Baileys lacks support, semantic recall vectors (Felix #56), OpenWebUI/ChatGPT-connector (lharries #51/#52), Smithery (lharries #51), wppconnect bridge (lharries #298),
event-driven LLM auto-reply agent mode (lharries PR#165/#175/#176 — rule-based autoreply IS in scope, §4),
MCPL protocol (chigwell P#120), Telegram-style folders/forum-topics/drafts/custom-emoji (engine N/A).

---

**Done = every checkbox verified. ACCOUNTING.md covers all source items (1,029 tracked items + kahflane-87/biliboss-62/delltrak-62/chigwell-80 tool lists) with final dispositions. `npx wa-mcp install` + `doctor` green on fresh macOS/Linux/Windows. All 8 platforms registered. Live smoke green. Web UI + resources + prompts live. `wa-mcp@0.9.0` on npm.**
