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

- [ ] `git init` empty repo; first commit only `.gitignore` (`node_modules/`, `dist/`, `*.db`, `store/`, `.env`, `*.log`) — verify: `git log --oneline | wc -l` = 1
- [ ] `vp create` monorepo: pnpm workspaces `packages/{bridge,mcp-server,shared,cli,web-ui}` — verify: `ls packages/` = 5 dirs
- [ ] Root `package.json` (`wa-mcp`, `type: module`, engines node≥20, packageManager pnpm) — verify: `vp check` runs
- [ ] `tsconfig.base.json` strict: `strict`, `noUncheckedIndexedAccess`, `verbatimModuleSyntax` — verify: test file with `any` fails `vp check`
- [ ] Root `vite.config.ts` (Vite+ defineConfig) — verify: `vp build` builds 5 empty packages
- [ ] GitHub repo `dcversus/wa-mcp` (private) pushed — verify: `gh repo view` OK
- [ ] Branch protection main: `vp check` + `vp test` required — verify: `gh api .../branches/main/protection` shows checks

## 2. Bridge (`packages/bridge`) — Baileys daemon

- [ ] QR pairing: `get_login_qr`/`get_qr_code` endpoint + every rotation rendered (VGP #243/#213; biliboss/delltrak), ASCII→stderr + PNG file (VGP #242), phone pairing code `WA_PAIRING_NUMBER` / `get_pairing_code` (kahflane wa_get_pairing_code; lharries PR#248/#254/#365; VGP), companion refresh (VGP #244) — verify: `pair` shows ≥2 QR rotations, PNG opens; pair-by-code completes without QR
- [ ] Session persistence `~/.wa-mcp/auth/` 0700 — verify: restart daemon → no QR
- [ ] Reconnect: backoff, auto-reconnect unless logged-out — verify: `kill -9` → service restarts → `/health` `connected:true` ≤60s
- [ ] Single-instance lock (VGP #158) — verify: 2nd daemon start → exit 1 "session held"
- [ ] Event bus, all Baileys events typed: `messages.upsert/update`, `message-receipt.update`, `presence.update`, `chats.update/upsert`, `contacts.upsert`, `groups.update`, `groups-participants.update`, `call`, `connection.update`, `creds.update`, `group-participants.request` — verify: synthetic event → typed subscriber (unit)
- [ ] `GET /health` → `{status, connected, loggedIn, version, uptime}`, 127.0.0.1 only — verify: curl loopback OK; LAN IP refused
- [ ] Bridge token `~/.wa-mcp/token` (0600); `Authorization: Bearer` on ALL endpoints (VGP #153) — verify: no-token → 401 on every route (matrix test)
- [ ] Graceful shutdown SIGTERM → flush + exit 0 (VGP #186) — verify: `launchctl stop` → exit 0, no SIGABRT
- [ ] `WA_DEVICE_NAME` (VGP #157) — verify: paired device shows that name on phone

- [ ] Windows live pairing page: auto-refreshing QR in browser (VGP P#163) — verify: `pair --web` serves page on 127.0.0.1, QR auto-refreshes on rotation
- [ ] Full-history-at-pair flag `WA_SYNC_FULL_HISTORY` (VGP P#37; kahflane env) — verify: pair with flag → history-sync includes older chats (log check)
- [ ] Disappearing-message settings tracked per chat (VGP P#82) — verify: chat with 7-day disappearing → store records setting
- [ ] Windows console Unicode hardening: QR render + logs never crash on cp1252/chcp consoles; ASCII fallback (chigwell I#150/P#250) — verify: Windows CI run under chcp 437, no UnicodeEncodeError
- [ ] Socket staleness detection: periodic ping, force-reconnect on stale TCP instead of silent hang (chigwell P#98) — verify: synthetic dead-socket → reconnect ≤30s
- [ ] App-state conflict auto-recovery: on LTHash 409 "SendAppState failed", retry FetchAppState(fullSync=true) + runbook entry (VGP I#111) — verify: synthetic 409 → recovery attempt logged, bridge stays up
- [ ] Connection-quality tracking: KeepAliveRestored events counted, exposed in /health + /metrics (Felix I#7) — verify: metrics series wa_keepalive_total present
- [ ] Alert on N consecutive reconnect failures → webhook/notification + log (Felix I#12) — verify: 3 synthetic failures → alert fired once
- [ ] stdio MCP server exits on stdin EOF / parent death — no orphan processes (VGP P#177; chigwell P#177) — verify: kill parent → child exits ≤2s
- [ ] Business-account pairing path verified or documented limitation (VGP I#205) — verify: live pair on Business account OR ACCOUNTING row with reproduction notes
- [ ] Concurrent MCP clients: 2 harnesses (e.g. Claude Code + Cursor) simultaneously against ONE daemon, both streams served (chigwell I#214/P#215) — verify: parallel tools/call from 2 clients, both 200
## 3. Store (`packages/bridge/src/store`)

- [ ] better-sqlite3 (prebuilt, no compiler), WAL, busy_timeout=5000 — verify: fresh CI runner installs without gcc
- [ ] Tables: `chats, messages, contacts, events, poll_options, poll_votes, read_state, media_files, aliases, scheduled, templates, autoreply_rules, meta` — verify: `PRAGMA table_list` matches spec (snapshot test)
- [ ] `messages` cols: id, chat_jid, sender_jid, sender_name, timestamp ISO-8601-with-offset (VGP #232/#236, lharries #146), content, media_type, media_path, quoted_message_id, mentions, is_from_me, is_unread, reactions — verify: schema snapshot test
- [ ] FTS5 `messages_fts` + sync triggers (MuhammadMustafa18), accent-insensitive — verify: insert "Schröder" → search "schroder" hits
- [ ] Migrations from lharries-layout AND Go-fork layout (`~/Documents/GitHub/whatsapp-mcp/store` real fixture) — verify: row counts equal, 0 NULL sender_name where resolvable
- [ ] Perms 0700/0600 (VGP #241) — verify: `stat` shows 700
- [ ] Nightly backup + retention (Felix #8/#13) — verify: retention=1, two runs → 1 backup left
- [ ] Read-state persisted + history backfill (VGP #155/#201/#203; lharries #59) — verify: synthetic receipt → read_state updated; unread counts correct

- [ ] media_path stored as ABSOLUTE path, never relative (Felix I#85) — verify: unit — stored rows resolve from any cwd
- [ ] Sync-status metadata: last history-sync watermark + per-chat backfill state (lharries PR#341) — verify: sync_status tool reflects fixture backfill
- [ ] Docker volume permissions: PUID/PGID env or documented chmod for mounted store (Felix I#4) — verify: container run with UID 1000 writes to mounted volume
## 4. Send path

- [ ] `send_text`: phone/JID/group, "+" strip (lharries live fix), mentions[], reply_to_message_id + reply_to_sender_jid (lharries #201/#277/#325; VGP #212), link-preview toggle (biliboss) — verify: live Test-group sends of each variant → 200 + stored
- [ ] `send_media` (aliases `send_image`/`send_video`/`send_audio`/`send_document`): image/video/audio/document/sticker; MIME by ext+magic bytes; fileName; caption (lharries #350, VGP #193); base64 input (Felix #76); URL input — verify: live PDF arrives named not `.bin` (#327/#342), image+caption, sticker webp, audio playable, document preview
- [ ] `send_voice`: ffmpeg → ogg/opus PTT, temp cleanup (VGP #227) — verify: mp3 → playable voice note; no temp leftover
- [ ] `send_location` (kahflane/biliboss) — verify: live send → pin on phone
- [ ] `send_link_preview` (delltrak) — verify: live send → link card renders on phone
- [ ] `send_view_once` (delltrak) — verify: live send → view-once badge on phone
- [ ] `check_number_exists` (delltrak) — verify: own number → true; random → false
- [ ] `send_text_status`/`send_image_status`/`send_video_status` (delltrak; kahflane post_status) — verify: live text status → visible on phone
- [ ] `send_contact` vCard (kahflane/biliboss) — verify: live send → tappable card
- [ ] `send_poll` + options stored for vote decode (lharries #345; Felix #84) — verify: live send; phone vote → poll_votes row with option name
- [ ] `send_buttons`/`send_list` (kahflane; lharries #15/#197) — verify: live send renders (document Business-account caveat)
- [ ] `edit_message`, `delete_message` for-everyone + `delete_message_for_me` (local-only) (kahflane wa_delete_message_for_me; VGP #192; lharries #90) — verify: live edit + both delete modes reflected on phone/store
- [ ] `forward_message` (kahflane/biliboss) — verify: live forward Test-group → own chat
- [ ] `react`/`send_reaction` (kahflane/biliboss/delltrak wa_send_reaction) — verify: live reaction visible on phone
- [ ] `send_presence` typing/recording + `subscribe_presence` (kahflane) — verify: phone shows "typing…" during send
- [ ] `send_broadcast` + `broadcast_info` (kahflane) — verify: 2-recipient broadcast → 200
- [ ] Outbound persistence + media upload metadata (lharries #229; VGP #221) — verify: `list_messages` shows own sends is_from_me=1
- [ ] Send-safety: min-interval pacing, daily cap `WA_DAILY_CAP`, kill-switch `WA_SENDS_DISABLED=1` (kahflane), rate-limit error surfaced (ste-bah) — verify: unit — 6 rapid sends → 5 pass 1 limited; kill-switch → all refused
- [ ] `schedule_message`/`list_scheduled`/`cancel_scheduled` daemon scheduler (kahflane) — verify: schedule +2s → fires, listed, then removed
- [ ] Templates: `create_template`/`list_templates`/`render_template` ({{var}}) + `send_template` (kahflane) — verify: render with vars → expected string
- [ ] `send_event` calendar event card (kahflane) — verify: live send → event card renders
- [ ] `restrict_sending` per-target send blocklist rules (kahflane wa_restrict_sending) — verify: rule blocks send to Test group → structured refusal
- [ ] `logout` tool: unpair current device session (kahflane wa_logout) — verify: logout → /health loggedIn=false; re-pair cycle works
- [ ] Autoreply rules `autoreply_set`/`autoreply_add_rule`/`autoreply_list_rules`/`autoreply_remove_rule` (kahflane; lharries #67 as opt-in only, default OFF) — verify: rule ping→pong; phone sends "ping" → "pong" received; default state = off

- [ ] `send_album`: 2-10 media as one grouped album (chigwell P#127) — verify: live 3-image album arrives grouped on phone
- [ ] `forward_message` batch mode + album grouping preserved (chigwell P#129) — verify: forward album → arrives as album
- [ ] Forwarded messages preserve original sender attribution (chigwell P#182) — verify: forwarded row keeps original sender_name
- [ ] `schedule_message` supports media payloads, not just text (chigwell P#205) — verify: schedule image +2s → media fires
- [ ] Poll validation: ≥2 options, ≤12, unique, non-empty (chigwell P#240) — verify: 1-option poll → structured validation error
- [ ] Send-to-number resolves the JID the number is REGISTERED under (LID-aware lookup) (VGP P#259) — verify: send to LID-registered contact number → delivered
- [ ] WhatsApp rate-limit / ban-risk errors surfaced as structured error with retryAfter seconds + actionable hint (chigwell P#204 FloodWait pattern) — verify: synthetic 429 → {code: RATE_LIMITED, retryAfter: N}
## 5. Read path

- [ ] `list_chats`: pagination, unread counts, last_message preview, archived flag, JID-prefix filter (MuhammadMustafa18), name fallback chain pushname→business→phone, never own number for DMs (VGP #261/#260/#262) — verify: fixture store → real names
- [ ] `list_messages`: filters chat/sender/date-as-instant, clamped pagination ≥0 (VGP #226), sender_name (lharries #276/#144), filename (VGP #217) — verify: fixture query correct
- [ ] `get_message_context`, `get_last_interaction` (Jochem), `get_direct_chat_by_contact`, `get_contact_chats` (Jochem) — verify: fixture context returns adjacent rows
- [ ] `search_messages`: FTS5 operators (AND/OR/*/"phrase"), LIKE fallback, ranking (MuhammadMustafa18; lharries #281; VGP #198) — verify: `pizza OR burger` on fixture; <50ms on 100k-row bench
- [ ] `search_contacts`/`list_contacts`/`get_contact`: full Baileys contact store (thousands — lharries #9/#37/#48), LIMIT param, business profile (biliboss), picture URL (kahflane), blocklist, `resolve_name` (kahflane) — verify: partial-name search finds non-recent contact
- [ ] `get_picture_url` / avatar retrieval for chats + contacts + own profile (kahflane; chigwell P#199) — verify: Test-group picture URL resolves; own avatar download works
- [ ] `fetch_history` tool: per-chat history fetch beyond local store, watermark-paged (kahflane wa_fetch_history; VGP P#168 on-demand sync) — verify: empty fresh store → fetch_history(Test group) → messages present
- [ ] `get_unread`/`get_unread_messages`/`check_new_messages` (NIXKnight, kahflane) + `get_unanswered_messages` (Jochem) — verify: fixture read_state → correct sets
- [ ] `catch_up` activity digest: active chats, message counts, questions directed at you, media summary (jonzarecki/eddmann) — verify: fixture → digest lists Test-group question addressed to owner
- [ ] `digest_group` + MCP Prompts (guided workflows: group digest, person catch-up, action-item extraction) (jonzarecki) — verify: prompts/list returns 3 prompts
- [ ] `list_unread_chats` + `mark_as_read` (jonzarecki) — verify: fixture → unread chats listed; mark → zero
- [ ] Ingest ALL message types → text: reactions, polls+votes, edits, revokes, location, vCards (VGP #214), buttons/lists (lharries #15/#197), business msgs (lharries #264), view-once placeholder, stickers, ephemeral, status mentions — verify: synthetic upsert per type → stored with extracted text
- [ ] Remembered contacts (chigwell): `set_contact_alias`/`list_contact_aliases`/`delete_contact_alias`; all recipient-taking tools resolve aliases; exact-only sends, fuzzy → suggest-not-send — verify: alias "андрей бекендер" resolves; case-variant → structured confirm, nothing sent
- [ ] `get_poll_votes` decoded via poll_options (Felix #84, kahflane) — verify: synthetic vote → option names
- [ ] Tool annotations: readOnlyHint/destructiveHint (lharries #142) — verify: tools/list JSON contains annotations

- [ ] Full-fidelity message records: get_history/get_messages return complete message object (chigwell P#254/#133), attached media surfaced in listings (P#132), engagement metrics (views/reactions counts — P#48), reply quotes in reads (P#154), unread mentions count (P#84), unmuted-only filter + mute status (P#78), with_about for chats (P#106), links exposed in context (P#225), message entities preserved as markdown (P#63)
- [ ] Output size limits with truncation metadata (chigwell I#16/P#18) — verify: oversized chat dump returns first N + "truncated, X more" marker
- [ ] Bulk export: export_unread_messages + full chat export (JSONL/MD/HTML/TXT, media, transcription) (chigwell P#237/#202) — verify: export Test-group fixture → file with correct message count
- [ ] mark_read MCP tool + /api endpoint (lharries P#314/#313; VGP P#209) — verify: live mark-read zeroes unread + phone shows blue ticks
- [ ] get_chat includes group participants (VGP P#152) — verify: Test-group get_chat lists participants
- [ ] Label management tools (lharries P#235) — gated on Baileys label support — verify: capability probe; else ACCOUNTING NA-ENGINE row
- [ ] Query semantics: limit applied AFTER date/sender filtering, never over-fetch then trim (chigwell I#27/P#245) — verify: fixture — ask 10 msgs from empty date range → 0 rows, one SQL page
- [ ] Global message search (no chat filter) across all chats (chigwell P#74) — verify: fixture query without chat_jid hits multiple chats
- [ ] Contact cache warmed in BACKGROUND at startup — MCP tools never block on warmup (chigwell P#140) — verify: tools/call within 100ms of server start
- [ ] `get_chat` reports has_photo + profile picture URL (chigwell P#191) — verify: Test-group get_chat includes both fields
- [ ] View profile pictures through MCP: list + open contact avatars as images (chigwell P#199) — verify: avatar download returns image bytes
- [ ] Alias favorites flag + non-ASCII aliases resolve everywhere (chigwell P#173/P#178) — verify: Cyrillic alias resolves; favorite listed first
- [ ] Manually-marked-unread detection distinct from auto read-state (chigwell P#46) — verify: mark-unread on phone → unread count +1 in next list_chats
- [ ] `request_history` tool: on-demand older-message backfill for ONE chat (VGP P#168; lharries PR#364) — verify: live request on Test group → older messages appear
- [ ] WhatsApp username lookup — capability probe; if Baileys lacks support → ACCOUNTING NA-ENGINE row (chigwell P#57 analog) — verify: probe documented
- [ ] Bulk cleanup: delete/clear multiple chats in one call (chigwell P#102) — verify: fixture — bulk_clear([chatA, chatB]) empties both
## 6. Media pipeline

- [ ] Auto-download all types, opt-out `WA_AUTO_DOWNLOAD` (VGP #237), skip status media (VGP #237), skip-if-row-failed (VGP #231) — verify: image in → file exists + path in DB; opt-out → no file
- [ ] Message-ID filenames, collision-safe (lharries #156/#320) — verify: 2 images same second → both files
- [ ] Path guard: media reads confined to `~/.wa-mcp/media` (CWE-22, symlink-resolved, boundary — Felix #74) — verify: `../../etc/passwd` rejected (unit)
- [ ] `download_media(message_id)` (NIXKnight) — verify: live image → path
- [ ] `view_image`/`view_video`/`view_media`: image content to model; video → ≤8 frames scene-sampled 640px + transcript (lharries #360; VGP #246) — verify: live image → base64 JPEG; video → frames+transcript
- [ ] `transcribe_voice`: engines `local` (whisper.cpp node), `openai` (any OpenAI-compatible: Groq/LocalAI/speaches), `elevenlabs` (aserranoni; chigwell 4-engine pattern); per-call engine + default env; cache (chat_id, message_id, engine); size caps; language hint — verify: mock engine → transcript; 2nd call cache-hit (no re-invoke)
- [ ] `send_tts`: text→speech→voice note (aserranoni) — verify: mock TTS → PTT sent

- [ ] download_media strips caller-supplied extension; real type from magic bytes (chigwell I#85/P#86) — verify: request .png on a JPEG → saved as .jpg
- [ ] Per-engine input normalization (.oga→.ogg etc.) before engine upload (chigwell I#219/P#229) — verify: .oga voice note transcribes via openai-compat engine
- [ ] `mlx` transcription engine (macOS on-device) (Felix P#55) — verify: macOS run transcribes without network
- [ ] Media download size cap + staging to disk, never whole-file-in-memory for >50MB (chigwell P#206) — verify: >cap → structured error, no OOM
- [ ] `WA_ALLOWED_EXTENSIONS` per-tool configurable allowlist for downloads (chigwell I#226/P#227) — verify: .exe download refused when not allowlisted
## 7. Groups & social

- [ ] `groups_list`/`list_groups` + `group_metadata`/`group_info`/`group_participants`/`get_group_members` (participants + roles + description + settings) (kahflane/biliboss/delltrak) — verify: live Test group → ≥2 participants with admin flags
- [ ] `create_group`, `leave_group`/`group_leave` (lharries #239 pattern; kahflane/biliboss/delltrak) — verify: live create+leave cycle
- [ ] `group_add_participants`/`group_remove_participants`/`group_promote`/`group_demote` (biliboss/delltrak) — verify: live add+remove participant on Test group
- [ ] `group_invite_code`/`group_get_invite_code` + `group_revoke_invite` + `group_info_by_code` + `group_join` (kahflane/biliboss/delltrak) — verify: Test group code → info resolves; live join via code on throwaway group
- [ ] `group_join_requests` list + `group_join_decision` approve/reject + `group_handle_request` (kahflane/biliboss) — verify: synthetic request → handled (unit)
- [ ] `group_update_subject`, `group_update_description`, `group_update_settings`/`group_setting` (announcement/admin-only/edit-subject perms), `group_add_mode` (kahflane/biliboss/delltrak) — verify: live subject change + restore
- [ ] `group_ephemeral`/`group_toggle_ephemeral` + `disappearing_chat` per-chat timer + `default_disappearing` global (kahflane; VGP P#82) — verify: live set 24h timer → phone shows disappearing
- [ ] `group_member_label` set/clear (kahflane) — gated on Baileys support — verify: capability probe, else ACCOUNTING NA-ENGINE row
- [ ] `newsletter_follow`/`newsletter_unfollow`/`newsletter_send` (biliboss/delltrak) — gated on Baileys support; else ACCOUNTING row N/A — verify: capability probe
- [ ] `reject_call` (biliboss/kahflane/delltrak) — verify: synthetic call event → reject called (mock)

- [ ] `get_participants` pagination with async iteration for 1000+ member groups (chigwell I#14/P#109) — verify: synthetic 1000-member fixture pages without timeout
## 8. Profile, privacy, status

- [ ] `post_status` text/image/video/voice + `post_status_to` (privacy-limited audience) + `history_status` (recent statuses) + `get_status` (kahflane) — verify: live text status → visible on phone; history lists it
- [ ] `set_name`/`update_profile_name`, `set_status`/`update_profile_status`, `set_picture`/`update_profile_picture`, `remove_picture`/`remove_profile_picture` (kahflane/biliboss/delltrak) — verify: live about-text change + restore
- [ ] `get_business_profile` (biliboss/delltrak) — verify: Business-account contact returns catalog/description fields
- [ ] `get_privacy`/`set_privacy`/`update_privacy` (kahflane/biliboss/delltrak) — verify: live read-receipts toggle + restore
- [ ] `block_contact`/`unblock_contact` + `blocklist` (kahflane/biliboss/delltrak) — verify: live block+unblock test number; blocklist lists it while blocked
- [ ] `star_message`/`unstar`, `pin_message`/`unpin`, `pin_chat`/`unpin_chat` (kahflane/biliboss) — verify: live star on Test-group message
- [ ] `archive_chat`/`unarchive`, `mute_chat`/`unmute` (duration), `delete_chat`, `clear_chat`, `mark_chat_read`, `mark_chat_unread` (kahflane/biliboss/delltrak) — verify: live mark-read zeroes unread; archive flag in list_chats

## 9. Events & integrations

- [ ] SSE `/events`: message/receipt/presence/poll/edit/revoke + 20s heartbeat, slow-client skip (lharries #191 pattern) — verify: curl stream + live send → event <2s
- [ ] Incoming feed JSONL (chigwell callback): `~/.wa-mcp/incoming_feed.jsonl` 0600, `enable_feed`/`feed_status` return `tail -f` watch command — verify: live inbound → JSONL line; command valid
- [ ] `wait_for_new_message`/`wait_for_settled_message` debounce (chigwell) — verify: 3-msg burst → one settled return with all 3
- [ ] Webhooks: register/list/delete, HMAC header, token auth, opt-out env (VGP #204; lharries #326), inbound+outbound fire — verify: local receiver gets signed payload; bad signature rejected
- [ ] Desktop notification unanswered (Jochem) — verify: osascript fires in test mode
- [ ] Prometheus `/metrics`: msgs in/out, uptime, reconnects, queue depth (Felix #10) — verify: curl returns series
- [ ] JSON logs with phone redaction last-4 (Felix #11; ste-bah) — verify: logs valid JSON; full number → 0 grep hits

- [ ] Incoming call events captured + reject_call (VGP P#39; biliboss) — verify: synthetic call event → stored + event fired
- [ ] Typing/presence tracking inbound (VGP P#210) — verify: synthetic presence event → read_state/contact updated
- [ ] Caller fingerprinting on /api/send: identify which registered harness sent (VGP P#92/#96) — verify: two different tokens → logs distinguish senders
- [ ] Programmatic relink: start REST server before pairing + GET /api/qr HTTP QR endpoint (VGP P#131; lharries P#311) — verify: curl /api/qr returns QR PNG data before session exists
- [ ] Webhook event coverage: reactions (VGP P#129), captionless audio (P#175), vCard shares (P#176), image media in webhook payload (P#45), activation metadata (P#173) — verify: fixture-driven webhook payloads per type
- [ ] Typed failure-mode error codes EC1/EC2/EC5… (VGP P#114) — verify: every tool error returns {code, message, hint}
- [ ] Session-conflict recovery: StreamReplaced event handling (VGP P#27) — verify: synthetic event → reconnect initiated + warning logged
- [ ] Webhook chat-type filter: option to skip group messages (lharries PR#112) — verify: group msg with filter on → no webhook fire
- [ ] Feed mention-gating: WA_FEED_MENTION_ONLY — only messages mentioning me enter JSONL feed (chigwell P#253) — verify: non-mention message excluded
- [ ] `wait_for_new_message(chat_id?)`: per-chat wait, not only all-chats (chigwell P#183) — verify: wait on chat A while chat B receives → timeout, chat A msg returns
## 10. Security & safety (release gate)

- [ ] Loopback default bind; `WA_BIND_HOST` override documented — verify: default 127.0.0.1, LAN refused
- [ ] Token on every endpoint — verify: 401 matrix (§2)
- [ ] Whitelist `WA_ALLOWED_JIDS` fail-closed: reads+sends+context+events (lharries #319 incl. context-bypass fix) — verify: fixture whitelist=Test group → N→1 chats; foreign send refused
- [ ] `WA_READ_ONLY=1` (VGP #255) — verify: every send tool → structured refusal
- [ ] Tool gating `WA_EXPOSED_TOOLS` (chigwell) + `--profile=minimal|standard|full` (Felix #42) — verify: minimal → exactly 6 tools
- [ ] Pagination caps limit≤200 offset≥0 (lharries #271) — verify: unit clamp test
- [ ] At-rest encryption option (VGP #223): `WA_STORE_PASSPHRASE` or documented mitigation — verify: encrypted roundtrip OR docs section with steps
- [ ] Prompt-injection sanitization: user content in structured fields marked untrusted (chigwell) — verify: "ignore instructions" wrapped+flagged in output
- [ ] `pnpm audit` 0 HIGH, CodeQL clean, gitleaks clean — verify: CI green

- [ ] Lethal-trifecta mitigation: approval gate on writes, audit log of sends, rate limiting, path restriction (lharries P#291, I#42 invariantlabs) — verify: audit-log row per send with tool+recipient+timestamp
- [ ] Rate limiting with LimitReader body caps on HTTP endpoints (lharries I#340) — verify: >1MB request body → 413
- [ ] Input validation decorators on tool params (chigwell I#11) — verify: invalid JID/phone → structured error, never crash
- [ ] DNS-rebinding protection on HTTP transport (VGP P#252/#216) — verify: request with foreign Host header → rejected
- [ ] Read-only mode can expose NAMED write tools (chigwell P#168) — verify: read-only + allowlist mark_read → mark_read works, sends refused
- [ ] Per-tool-call timeout (default 30s) with structured TIMEOUT error naming the tool (chigwell P#223/P#231) — verify: synthetic 60s tool → timeout error ≤31s
- [ ] Install guard: npx package provenance check (repository field + tarball integrity) + README warning about impersonator packages (chigwell I#117/P#119) — verify: doctor verifies installed tarball origin
- [ ] macOS Keychain storage for bridge token (chigwell P#47) — verify: token absent from disk files on macOS, served from Keychain
- [ ] Annotation correctness: export/invite/link tools NOT marked readOnlyHint; gated/hidden tools listed at startup (chigwell P#251) — verify: tools/list JSON annotations audit script green
## 11. Distribution (`packages/cli` → `wa-mcp` npx)

- [ ] `npx wa-mcp install`: daemon → service start → register platforms → print pairing steps — verify: fresh `node:20` Docker container → all steps logged, `doctor` green
- [ ] Service: launchd `com.wa-mcp.bridge` (KeepAlive, RunAtLoad); systemd user unit; Windows Task Scheduler — verify: macOS `launchctl list | grep wa-mcp`; Linux CI `systemctl --user is-active`
- [ ] Subcommands `install pair status doctor start stop restart update uninstall logs [--follow]` — verify: each exits 0 on fresh container
- [ ] `doctor`: daemon, /health, store, ffmpeg (common-path fallback), token perms, registrations, FTS — verify: all-green dev machine; seeded failures → correct diagnosis
- [ ] `pair` foreground QR — verify: ≥2 rotations before timeout
- [ ] `update`: npm check → install → restart — verify: downgrade → update → version bumped
- [ ] Registrations (path written + read-back verified):
  - Claude Code `~/.claude.json` → `mcpServers.wa-mcp`
  - Claude Desktop `~/Library/Application Support/Claude/claude_desktop_config.json`
  - Codex `~/.codex/config.toml` `[mcp_servers.wa-mcp]`
  - Cursor `~/.cursor/mcp.json`
  - Antigravity `~/.gemini/antigravity/mcp_config.json` (uses `command`/`args` or `serverUrl`, NOT `url`)
  - Hermes `~/.hermes/mcp/wa-mcp.json`
  - Pi `~/.pi/mcp/wa-mcp.json`
  - Grok `~/.grok/mcp.json`
  - auto-detect bonus: Windsurf, Gemini CLI, opencode, VS Code `.vscode/mcp.json`
- [ ] HTTP transport `/mcp` (remote harness mode, loopback default) — verify: MCP client connects over HTTP + token
- [ ] DXT manifest for Claude Desktop Extensions (lharries I#87) — verify: manifest.json validates against DXT schema
- [ ] Codex hub + opencode hub listings (lharries P#203, P#362) — verify: hub metadata files present + valid
- [ ] Docker compose (bridge + MCP) — verify: `docker compose config` valid; container healthy
- [ ] Official MCP Registry listing: `server.json` via mcp-publisher, npm package metadata matches (registry.modelcontextprotocol.io) — verify: registry entry live + tool scan passes
- [ ] Directory listings: Glama, mcp.directory (auto-imports registry), PulseMCP (if open), Smithery (static server card at /.well-known/mcp/server-card.json if hosted) — verify: each directory page live after publish

- [ ] stdout purity in stdio mode: NOTHING but JSON-RPC frames on stdout — all logs/diagnostics to stderr (chigwell P#70; lharries PR#346) — verify: capture stdout across 20 tool calls, 0 non-protocol bytes
- [ ] `WA_PROXY` outbound proxy (SOCKS5/HTTP) for WhatsApp connection (chigwell I#99/P#113) — verify: local SOCKS proxy → connection routes through it
- [ ] Windows hidden autostart + QR-recovery watchdog (lharries PR#284) — verify: scheduled task survives reboot, auto-shows QR when session lost
- [ ] Docker: multistage build, image <500MB, store+media volumes, healthcheck (chigwell I#112/P#238; Felix PR#43 2.43GB→837MB lesson) — verify: `docker images` size check in CI
## 12. Skills + plugins

- [ ] Skills (`skills/`, SKILL.md + scripts, installed `~/.wa-mcp/skills/` + synced per platform):
  - [ ] `wa-onboarding` — pair, doctor, first send
  - [ ] `wa-search` — FTS operators, date filters, alias recipes
  - [ ] `wa-send` — media/sticker/poll/buttons/broadcast + rate care
  - [ ] `wa-inbox` — unread triage, unanswered, summarize-latest, draft-without-sending (chigwell workflows)
  - [ ] `wa-media` — view/transcribe/tts + engine config
  - [ ] `wa-groups` — create/manage/invite/join
  - [ ] `wa-guard` — whitelist/read-only/kill-switch/audit
  - [ ] `wa-ops` — status/logs/backup/restore runbook
  - verify: each has frontmatter+steps; `claude` loads wa-search in smoke test
- [ ] Claude Code plugin `plugins/claude-code`: `.claude-plugin/plugin.json` + `marketplace.json`, commands `/wa /wa-status /wa-unread /wa-search /wa-doctor`, SessionStart hook → health check — verify: `claude plugin validate` OK
- [ ] Per-platform plugins `plugins/{antigravity,codex,cursor,grok,hermes,pi}/`: manifest + skills sync + registration snippet — verify: manifest valid; install writes config
- [ ] Root `marketplace.json` — verify: schema valid, lists all
- [ ] Plugins version-locked to CLI, changesets — verify: release PR bumps all in lockstep

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

- [ ] Disposition vocabulary: ABSORBED (→ tool/feature + verify-ref) / SUPERSEDED-BY (item X) /
      NA-ENGINE (Baileys-vs-whatsmeow difference, with note) / ALREADY-CORE (design covers it) /
      OUT-OF-SCOPE-0.9 (→ Phase-10 row) / NOISE (dep bump, spam, meta) — every row uses exactly one
- [ ] Tool-parity rows: kahflane 87 tools, biliboss 62 tools, chigwell 80+ tools each listed by
      name → mapped to our tool or OUT-OF-SCOPE with reason
- [ ] lharries 235 PRs: 405-family (~50) → one SUPERSEDED-BY-ENGINE row each (Baileys has no
      client-outdated problem); 24 already-absorbed-in-Go → ABSORBED rows mapping to TS tools;
      remainder dispositioned individually
- [ ] lharries 127 issues: connectivity/CGO/Windows-install classes → NA-ENGINE or
      ALREADY-CORE; feature asks → ABSORBED rows; meta/spam → NOISE
- [ ] VGP 223 PRs: merged-and-relevant → ABSORBED; dependency/release chores → NOISE; open PRs → ABSORBED rows
- [ ] FelixIsaac 59 PRs + 25 issues: same treatment
- [ ] chigwell 252 items: Telegram-specific → NA-ENGINE with "pattern borrowed" note where
      applicable (aliases, event feed, transcription engines, annotations, sanitization);
      portable patterns → ABSORBED rows
- [ ] Count-assert script `review/accounting-check.ts`: totals per source match BACKLOG-FULL.md
      counts; every line dispositioned; exit 1 on any missing — verify: `vp run accounting:check` green in CI

## 14. Tests & CI

- [ ] Unit: shared utils (JID, alias, instants, path guard, whitelist), store (migrations ×3 layouts, FTS triggers, read-state), event bus, send-safety — verify: `vp test` green; coverage bridge+server ≥80%, shared ≥90%
- [ ] Integration: recorded Baileys event fixtures (message/poll/receipt/group/presence/undecryptable from live session) replayed → store assertions — verify: suite green offline
- [ ] MCP conformance: initialize → tools/list (count+annotations) → tools/call per tool (mock bridge) — verify: scripted client green
- [ ] CLI tests: install/uninstall/doctor vs temp `$HOME` sandbox — verify: green on macOS + Linux CI
- [ ] Live smoke (nightly opt-in, cached session artifact): Test-group send/read-back, SSE event, transcription — verify: nightly green
- [ ] CI: `check` (vp check), `test` (ubuntu/macos/windows × node 20/22), `build` (vp build + pack dry-run, CLI <15MB), `release` (changesets → npm `wa-mcp` + `@wa-mcp/*`), `security` (audit+CodeQL+gitleaks) — verify: main badges green
- [ ] commitlint conventional commits; changesets semver 0.x — verify: bad commit msg → CI fail

## 15. Docs

- [ ] VitePress `docs/`: quickstart, per-platform install ×8 (exact JSON each), full tool reference (every tool: params/examples/errors), env-var config reference, service mgmt (launchd/systemd/TaskScheduler), security model, migration (lharries/Go-fork), troubleshooting runbook (Felix #15), disaster recovery (Felix #14), FAQ from 93 issues — verify: `docs:build` green; doc-coverage script = every tool documented
- [ ] ADRs 0001–0010: engine choice, monorepo layout, store schema, daemon model, auth model, event delivery, alias design, safety model, migration, release model — verify: 10 files indexed
- [ ] README: pitch, install matrix, feature list, credits (lharries + every fork author + PR #s), architecture diagram — verify: links valid (lychee CI)
- [ ] CHANGELOG (changesets), SECURITY, CONTRIBUTING, AGENTS.md, LICENSE MIT — verify: present + linted

## 16. Web UI (`packages/web-ui`) — auth-gated, loopback default

- [ ] QR pairing page with auto-refresh on rotation (VGP P#163; lharries PR#145) — verify: open page pre-pairing → QR renders + refreshes without manual reload
- [ ] Chat list + message history browser, read-only (Felix PR#62) — verify: Test group renders history matching store rows
- [ ] Unread inbox view + mark-read action (jonzarecki patterns) — verify: mark-read click zeroes unread in store
- [ ] Analytics dashboard: message volume, top chats, activity heatmap, media mix (lharries PR#26) — verify: dashboard renders from fixture store with correct counts
- [ ] Settings editor: whitelist, read-only, profiles, webhook config (chigwell I#116) — verify: whitelist change via UI enforced on next tools/call
- [ ] Health/sync status panel (lharries PR#101) — verify: panel shows connected state + sync watermark from /health
- [ ] Web UI auth: bearer token, loopback bind default — verify: no-token request → 401; LAN refused by default

## 17. MCP surfaces beyond tools

- [ ] MCP resources: `wa://health`, `wa://chats`, `wa://sync-status`, `wa://config` (read-only) (delltrak PR#18; lharries PR#101) — verify: resources/list + resources/read return current data
- [ ] MCP prompts: catch-up digest, group digest, action-item extraction (jonzarecki) — verify: prompts/list → 3 entries; prompts/get renders
- [ ] initialize response declares full capabilities: tools, resources, prompts, logging, notifications (delltrak I#3) — verify: client sees logging capability; log/notification messages delivered
- [ ] MCP `notifications/message` stream per spec for subscribed clients (lharries PR#183) — verify: live inbound message → notification frame to subscribed client


## 18. Meta Cloud API dual-channel (parallel engine)

Channel-adapter architecture: `ChannelAdapter` interface implemented by `BaileysAdapter` (default, personal accounts, free) and `CloudApiAdapter` (official Meta WhatsApp Business Cloud API). Both share the same store, tools, MCP surface, events, security layer. Per-account channel selection + hybrid mode (Cloud API for sends where reliability matters, Baileys for read/coverage).

- [ ] `ChannelAdapter` interface: connect/disconnect/pair, sendMessage, fetchChats, fetchHistory, downloadMedia, events → normalized internal types (delltrak channels/ pattern) — verify: two adapters pass identical contract test suite
- [ ] `CloudApiAdapter` auth: access token + phone number ID + verify token; WABA credentials in env/config, never in store (Meta doc pattern) — verify: unit — creds absent from DB; /health reports channel+credentials-valid
- [ ] Cloud API send: text, media (by URL + asset id), template messages, location, contact, interactive (buttons/lists) (Meta endpoints) — verify: sandbox WABA send text+template → message id returned, stored is_from_me=1
- [ ] Cloud API templates: list templates, send approved template, template variables (Meta: /message_templates) — verify: sandbox template with {{1}} renders + delivers
- [ ] Cloud API webhooks: registration, GET verify (hub.challenge), POST signature validation (X-Hub-Signature-256), payload → normalized events (message/status) — verify: signed webhook fixture → event stored; bad signature → 403
- [ ] Cloud API media: upload (POST /media), retrieve (GET /media/id), download URL handling — verify: sandbox media round-trip
- [ ] Cloud API read model: mark read via /messages read marker, phone-number lookup via contacts endpoint (Meta: /contacts) — verify: sandbox contacts check returns valid/invalid
- [ ] Phone-number ID / WABA discovery via API (GET /waba_id, /phone_numbers) — verify: sandbox lists numbers
- [ ] Cloud API rate limits surfaced (Meta 429 + headers) → same RATE_LIMITED structured error as Baileys engine (chigwell P#204 pattern) — verify: synthetic 429 → {code, retryAfter}
- [ ] Account-level channel config: `wa-mcp config set-channel <account> baileys|cloud|hybrid` — verify: config switch → /health channel field changes
- [ ] Docs: decision matrix personal vs Business, cost model (per-conversation pricing), when hybrid wins — verify: docs page published with pricing table sourced from Meta docs
- [ ] Sandbox CI: Cloud API tests mocked at HTTP boundary (nock-style fixtures) — verify: suite green offline; live sandbox smoke = manual gate flag

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
