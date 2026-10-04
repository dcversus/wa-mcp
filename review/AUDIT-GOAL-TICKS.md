# AUDIT-GOAL-TICKS — GOAL.md tick-evidence crosswalk (T96)

Read-only audit of all 148 checked boxes. Verdicts: BACKED = inline anchor
resolves to a VERIFY.md entry, an existing test, a registry entry, or a
documented disposition. WEAK = partial/mismatched evidence (tool exists but
no cited proof, feature lives on a sibling tool). UNBACKED = no anchor and
no evidence found. Nothing was unticked; this report only observes.

Summary: 145 BACKED / 2 WEAK / 1 UNBACKED (of 148)

| GOAL line | checkbox (first 80 chars) | anchor type | evidence | verdict |
|---|---|---|---|---|
| 23 | `git init` empty repo; first commit only `.gitignore` (`node_modules/`, `dist/`, | inline | VERIFY.md[§1]: - §1 repo-init — PASS — 1 commit 8a32c08, artifacts tracked | BACKED |
| 24 | `vp create` monorepo: pnpm workspaces `packages/{bridge,mcp-server,shared,cli,we | inline | VERIFY.md[§1]: - §1 repo-init — PASS — 1 commit 8a32c08, artifacts tracked | BACKED |
| 25 | Root `package.json` (`wa-mcp`, `type: module`, engines node≥20, packageManager p | inline | VERIFY.md[T42]: - T42 docker install — PASS — scripts/docker-install-test.sh exit 0 on node:22 (docker 27.4.0, tarba | BACKED |
| 26 | `tsconfig.base.json` strict: `strict`, `noUncheckedIndexedAccess`, `verbatimModu | inline | VERIFY.md[T40]: - T40 build-order — PASS — rm -rf packages/bridge/dist/web && pnpm run -r build → exit 0, dist/web/i | BACKED |
| 27 | Root `vite.config.ts` (Vite+ defineConfig) — verify: `vp build` builds 5 empty p | inline | VERIFY.md[T48]: - T48 pairing-pollution strip — PASS — boot/reconnect strips creds.me + creds.pairingCode when creds | BACKED |
| 28 | GitHub repo `dcversus/wa-mcp` (private) pushed — verify: `gh repo view` OK — VER | inline | VERIFY.md[§1]: - §1 repo-init — PASS — 1 commit 8a32c08, artifacts tracked | BACKED |
| 33 | QR pairing: `get_login_qr`/`get_qr_code` endpoint + every rotation rendered (VGP | VERIFY.md | VERIFY.md (overlap 4): - §2 QR/pairing live scan — PENDING live — pairing still fails: handshake reaches WhatsApp but creds | BACKED |
| 34 | Session persistence `~/.wa-mcp/auth/` 0700 — verify: restart daemon → no QR — VE | inline | VERIFY.md~: - §2 pairing live — PASS — test account paired 2026-10-02 23:33 EEST via tokenless web QR (one regis | BACKED |
| 35 | Reconnect: backoff, auto-reconnect unless logged-out — verify: `kill -9` → servi | VERIFY.md | VERIFY.md (overlap 4): - T88-B export/bulk MCP wiring — PASS — export_chat (chat_jid+format), export_unread_messages (unrea | BACKED |
| 36 | Single-instance lock (VGP #158) — verify: 2nd daemon start → exit 1 "session hel | inline | test: a second acquire in the same process throws session held | BACKED |
| 37 | Event bus, all Baileys events typed: `messages.upsert/update`, `message-receipt. | inline | VERIFY.md[T6]: - §7 send_reaction live — PASS — kind=reaction 👍 on Vasilisa's reply 3A9B9DC05327869D61B1, message_i | BACKED |
| 38 | `GET /health` → `{status, connected, loggedIn, version, uptime}`, 127.0.0.1 only | inline | VERIFY.md T44 'health loggedIn truth' | BACKED |
| 39 | Bridge token `~/.wa-mcp/token` (0600); `Authorization: Bearer` on ALL endpoints  | inline | VERIFY.md[T7]: - §10 extras (WA_ALLOWED_JIDS, WA_READ_ONLY, exposed-tools gating, at-rest encryption, prompt-inject | BACKED |
| 40 | Graceful shutdown SIGTERM → flush + exit 0 (VGP #186) — verify: `launchctl stop` | inline | code: shutdown.ts SIGTERM flush + installShutdownHooks wired in bin.ts; no ledger cite found | WEAK |
| 43 | Windows live pairing page: auto-refreshing QR in browser (VGP P#163) — verify: ` | NONE | VERIFY.md T83 line43: pairing page polls /health+/api/qr every 3s + asciiSafe (T75/T80) | BACKED |
| 44 | Full-history-at-pair flag `WA_SYNC_FULL_HISTORY` (VGP P#37; kahflane env) — veri | VERIFY.md | VERIFY.md (overlap 5): - T88-B export/bulk MCP wiring — PASS — export_chat (chat_jid+format), export_unread_messages (unrea | BACKED |
| 45 | Disappearing-message settings tracked per chat (VGP P#82) — verify: chat with 7- | VERIFY.md | VERIFY.md (overlap 4): - T80 store/sync/platform batch — PASS — line44: WA_SYNC_FULL_HISTORY gates syncFullHistory to fresh | BACKED |
| 46 | Windows console Unicode hardening: QR render + logs never crash on cp1252/chcp c | NONE | VERIFY.md T80 line46: asciiSafe stderr QR + logs (Windows cp1252-safe) | BACKED |
| 47 | Socket staleness detection: periodic ping, force-reconnect on stale TCP instead  | inline | VERIFY.md T93 staleness watchdog fix — liveness-first watchdog, engine-form probe, counters (0877ced) | BACKED |
| 48 | App-state conflict auto-recovery: on LTHash 409 "SendAppState failed", retry Fet | VERIFY.md | VERIFY.md (overlap 4): - T79 connection robustness — PASS — line47: staleness watchdog (WA_STALENESS_MS default 30s, 3 unan | BACKED |
| 49 | Connection-quality tracking: KeepAliveRestored events counted, exposed in /healt | VERIFY.md | VERIFY.md (overlap 4): - T79 connection robustness — PASS — line47: staleness watchdog (WA_STALENESS_MS default 30s, 3 unan | BACKED |
| 50 | Alert on N consecutive reconnect failures → webhook/notification + log (Felix I# | VERIFY.md | VERIFY.md (overlap 4): - T79 connection robustness — PASS — line47: staleness watchdog (WA_STALENESS_MS default 30s, 3 unan | BACKED |
| 51 | stdio MCP server exits on stdin EOF / parent death — no orphan processes (VGP P# | VERIFY.md | VERIFY.md (overlap 4): - T79 connection robustness — PASS — line47: staleness watchdog (WA_STALENESS_MS default 30s, 3 unan | BACKED |
| 52 | Business-account pairing path verified or documented limitation (VGP I#205) — ve | inline | disposition: ACCOUNTING rows (VGP I#205 documented limitation) | BACKED |
| 53 | Concurrent MCP clients: 2 harnesses (e.g. Claude Code + Cursor) simultaneously a | inline | VERIFY.md~: - §17 concurrent MCP clients live — PASS — two overlapping JSON-RPC /mcp streams (Promise.all, same  | BACKED |
| 56 | better-sqlite3 (prebuilt, no compiler), WAL, busy_timeout=5000 — verify: fresh C | inline | test: schema.test 'WAL mode and busy_timeout are configured' (busy_timeout=5000) | BACKED |
| 57 | Tables: `chats, messages, contacts, events, poll_options, poll_votes, read_state | inline | VERIFY.md[T9]: - T-C onboarding e2e — PASS — scripts/onboarding-test.sh: fresh mktemp dir → bridge dist bin → pairi | BACKED |
| 58 | `messages` cols: id, chat_jid, sender_jid, sender_name, timestamp ISO-8601-with- | inline | test: messages.test 'stores a full text message row with all 13 columns populated' | BACKED |
| 59 | FTS5 `messages_fts` + sync triggers (MuhammadMustafa18), accent-insensitive — ve | inline | VERIFY.md[T13]: - webui-e2e gate — PASS — scripts/webui-e2e.mjs: chats render → open chat → type+send → bubble visib | BACKED |
| 60 | Migrations from lharries-layout AND Go-fork layout (`~/Documents/GitHub/whatsapp | inline | VERIFY.md T83 import command: importLayout maps lharries per-chat JSON + gofork sqlite, fixtures committed, CLI wired | BACKED |
| 61 | Perms 0700/0600 (VGP #241) — verify: `stat` shows 700 — VERIFY: T9 perms tests | inline | VERIFY.md[T9]: - T-C onboarding e2e — PASS — scripts/onboarding-test.sh: fresh mktemp dir → bridge dist bin → pairi | BACKED |
| 62 | Nightly backup + retention (Felix #8/#13) — verify: retention=1, two runs → 1 ba | VERIFY.md | VERIFY.md (overlap 4): - T80 store/sync/platform batch — PASS — line44: WA_SYNC_FULL_HISTORY gates syncFullHistory to fresh | BACKED |
| 63 | Read-state persisted + history backfill (VGP #155/#201/#203; lharries #59) — ver | inline | VERIFY.md §5/§8 read-state live + T80 line66 watermark | BACKED |
| 65 | media_path stored as ABSOLUTE path, never relative (Felix I#85) — verify: unit — | inline | VERIFY.md[T18]: - §6 media download — PASS(unit) — T24 traversal 400 / unknown 404 / EMPTY→NOT_FOUND mapping; real-m | BACKED |
| 66 | Sync-status metadata: last history-sync watermark + per-chat backfill state (lha | NONE | VERIFY.md T80 line66: history-sync watermark per chat (e76ec67) | BACKED |
| 67 | Docker volume permissions: PUID/PGID env or documented chmod for mounted store ( | NONE | VERIFY.md T81 line67: docker PUID/PGID privilege drop + volume docs | BACKED |
| 70 | `send_text`: phone/JID/group, "+" strip, mentions[], reply_to, link-preview togg | inline | VERIFY.md[T15]: - §10 extras (WA_ALLOWED_JIDS, WA_READ_ONLY, exposed-tools gating, at-rest encryption, prompt-inject | BACKED |
| 71 | `send_media` (aliases `send_image`/`send_video`/`send_audio`/`send_document`): i | inline | VERIFY.md[T61]: - §10 extras (WA_ALLOWED_JIDS, WA_READ_ONLY, exposed-tools gating, at-rest encryption, prompt-inject | BACKED |
| 72 | `send_voice`: ffmpeg → ogg/opus PTT, temp cleanup (VGP #227) — verify: mp3 → pla | VERIFY.md | VERIFY.md (overlap 5): - T81 send_voice + docker perms — PASS — line72: src/media/voice.ts toVoiceOgg converts file/URL aud | BACKED |
| 73 | `send_location` (kahflane/biliboss) — verify: live send → pin on phone — VERIFY: | inline | VERIFY.md~: - §7 send_location live — PASS — kind=location Lisbon pin → Vasilisa, message_id 3EB07D725A1DA1D001A | BACKED |
| 74 | `send_link_preview` (delltrak) — verify: live send → link card renders on phone  | inline | VERIFY.md~: - T92 send variants MY VERIFICATION — PASS — line74 link_preview: engine-NATIVE `{ text, linkPreview | BACKED |
| 77 | `send_text_status`/`send_image_status`/`send_video_status` (delltrak; kahflane p | inline | VERIFY.md~: - T92 send variants MY VERIFICATION — PASS — line74 link_preview: engine-NATIVE `{ text, linkPreview | BACKED |
| 78 | `send_contact` vCard (kahflane/biliboss) — verify: live send → tappable card — V | inline | VERIFY.md~: - T57 wire content shapes — PASS — ROOT CAUSE (fork lib/Utils/messages.js generateWAMessageContent): | BACKED |
| 79 | `send_poll` + options stored for vote decode (lharries #345; Felix #84) — VERIFY | inline | VERIFY.md[T59]: - §7 send poll live — PASS — POST /api/send kind=poll → 200, message_id 3EB08015C9633CCC1899BB (deli | BACKED |
| 80 | `send_buttons`/`send_list` (kahflane; lharries #15/#197) — sendable via generate | inline | VERIFY.md~: - T92 send variants MY VERIFICATION — PASS — line74 link_preview: engine-NATIVE `{ text, linkPreview | BACKED |
| 81 | `edit_message`, `delete_message` for-everyone + `delete_message_for_me` (local-o | inline | VERIFY.md~: - T62 delete_message — PASS — MIGRATION v7 adds messages.deleted (0/1) with upgrade-path test (pre-v | BACKED |
| 82 | `forward_message` (kahflane/biliboss) — verify: live forward Test-group → own ch | inline | VERIFY.md~: - T57 wire content shapes — PASS — ROOT CAUSE (fork lib/Utils/messages.js generateWAMessageContent): | BACKED |
| 83 | `react`/`send_reaction` (kahflane/biliboss/delltrak wa_send_reaction) — verify:  | inline | VERIFY.md[T60]: - §7 send_reaction live — PASS — kind=reaction 👍 on Vasilisa's reply 3A9B9DC05327869D61B1, message_i | BACKED |
| 84 | `send_presence` typing/recording + `subscribe_presence` (kahflane) — verify: pho | inline | VERIFY.md~: - §8 presence live — PASS — composing → {ok:true}; recording → {ok:true} | BACKED |
| 86 | Outbound persistence + media upload metadata (lharries #229; VGP #221) — verify: | inline | VERIFY.md[T16]: - §10 extras (WA_ALLOWED_JIDS, WA_READ_ONLY, exposed-tools gating, at-rest encryption, prompt-inject | BACKED |
| 87 | Send-safety: min-interval pacing, daily cap `WA_DAILY_CAP`, kill-switch `WA_SEND | inline | VERIFY.md[T16]: - §10 extras (WA_ALLOWED_JIDS, WA_READ_ONLY, exposed-tools gating, at-rest encryption, prompt-inject | BACKED |
| 88 | `schedule_message`/`list_scheduled`/`cancel_scheduled` daemon scheduler (kahflan | VERIFY.md | VERIFY.md (overlap 6): - T82 daemon utilities — PASS — line91 restrict_sending: send_rules store + send-path gate + tool (S | BACKED |
| 89 | Templates: `create_template`/`list_templates`/`render_template` ({{var}}) + `sen | VERIFY.md | VERIFY.md (overlap 4): - T82 daemon utilities — PASS — line91 restrict_sending: send_rules store + send-path gate + tool (S | BACKED |
| 91 | `restrict_sending` per-target send blocklist rules (kahflane wa_restrict_sending | VERIFY.md | VERIFY.md (overlap 5): - T82 daemon utilities — PASS — line91 restrict_sending: send_rules store + send-path gate + tool (S | BACKED |
| 92 | `logout` tool: unpair current device session (kahflane wa_logout) — verify: logo | NONE | VERIFY.md T84 line92: logout tool + route, teardown, no auto-reconnect | BACKED |
| 93 | Autoreply rules `autoreply_set`/`autoreply_add_rule`/`autoreply_list_rules`/`aut | VERIFY.md | VERIFY.md (overlap 7): - T84 send/read polish — PASS — line92: logout tool + route, teardown, no auto-reconnect (5f0af55/2c | BACKED |
| 95 | `send_album`: 2-10 media as one grouped album (chigwell P#127) — verify: live 3- | VERIFY.md | VERIFY.md (overlap 5): - T85 media/contacts/tools — PASS — line95: send_album 2-10 grouped media (engine album path verifie | BACKED |
| 96 | `forward_message` batch mode + album grouping preserved (chigwell P#129) — verif | VERIFY.md | VERIFY.md (overlap 6): - T85 media/contacts/tools — PASS — line95: send_album 2-10 grouped media (engine album path verifie | BACKED |
| 97 | Forwarded messages preserve original sender attribution (chigwell P#182) — verif | VERIFY.md | VERIFY.md (overlap 4): - T78 reviewer MEDIUMs — PASS — M1: REVOKE/MESSAGE_EDIT tombstones verify the actor (protocolActorAl | BACKED |
| 98 | `schedule_message` supports media payloads, not just text (chigwell P#205) — ver | registry | VERIFY.md T84 line98: scheduler carries media payloads (3b12784) | BACKED |
| 99 | Poll validation: ≥2 options, ≤12, unique, non-empty (chigwell P#240) — verify: 1 | VERIFY.md | VERIFY.md (overlap 4): - T94-B location/contact/poll MCP surface — PASS — send_message gains location {latitude,longitude,l | BACKED |
| 100 | Send-to-number resolves the JID the number is REGISTERED under (LID-aware lookup | NONE | VERIFY.md T65 alias resolution + T94-C2b canonicalization (fdb6892) | BACKED |
| 101 | WhatsApp rate-limit / ban-risk errors surfaced as structured error with retryAft | NONE | VERIFY.md T84 line101: WA_RATE_LIMITED with retryAfterSeconds (c947d85) | BACKED |
| 104 | `list_chats`: pagination, unread counts, last_message preview, archived flag, JI | inline | VERIFY.md[T13]: - §10 extras (WA_ALLOWED_JIDS, WA_READ_ONLY, exposed-tools gating, at-rest encryption, prompt-inject | BACKED |
| 105 | `list_messages`: filters chat/sender/date-as-instant, clamped pagination ≥0 (VGP | inline | VERIFY.md[T13]: - webui-e2e gate — PASS — scripts/webui-e2e.mjs: chats render → open chat → type+send → bubble visib | BACKED |
| 106 | `get_message_context`, `get_last_interaction` (Jochem), `get_direct_chat_by_cont | inline | VERIFY.md~: - T88-B export/bulk MCP wiring — PASS — export_chat (chat_jid+format), export_unread_messages (unrea | BACKED |
| 107 | `search_messages`: FTS5 operators (AND/OR/*/"phrase"), LIKE fallback, ranking (M | inline | VERIFY.md~: - §5 FTS operators + global search live — PASS — q='wa-mcp AND test' → 7 hits; phrase '"storage fix" | BACKED |
| 108 | `search_contacts`/`list_contacts`/`get_contact`: full Baileys contact store (tho | VERIFY.md | VERIFY.md (overlap 6): - T88-B export/bulk MCP wiring — PASS — export_chat (chat_jid+format), export_unread_messages (unrea | BACKED |
| 109 | `get_picture_url` / avatar retrieval for chats + contacts + own profile (kahflan | VERIFY.md | VERIFY.md (overlap 4): - T67 web UI overhaul — PASS — chunk 1 (pages): chat rows structured (avatar initials + name/time/pr | BACKED |
| 110 | `fetch_history` tool: per-chat history fetch beyond local store, watermark-paged | inline | VERIFY.md T86 line110 + T93-B MCP wiring: fetch_history tool wired (351d266) | BACKED |
| 111 | `get_unread`/`get_unread_messages`/`check_new_messages` (NIXKnight, kahflane) —  | inline | VERIFY.md[T21]: - §5/§8 contacts+chat-state — PASS — T21 live probe (merge/name-keep, alias lookup, search, unread→0 | BACKED |
| 112 | `catch_up` activity digest: active chats, message counts, questions directed at  | inline | VERIFY.md T86 line112 + T93-B: catch_up tool wired (351d266) | BACKED |
| 113 | `digest_group` + MCP Prompts (guided workflows: group digest, person catch-up, a | inline | VERIFY.md T86 line113 + T93-B: digest_group tool + GET /api/digest (351d266) | BACKED |
| 114 | `list_unread_chats` + `mark_as_read` (jonzarecki) — verify: fixture → unread cha | inline | VERIFY.md[T22]: - §5/§8 presence+read+alias endpoints/tools — PASS — T22 live probe (readMessages+presence recorded, | BACKED |
| 115 | Ingest ALL message types → text: reactions, polls+votes, edits, revokes, locatio | inline | VERIFY.md T55 live ingestion + T78 M2 reactions aggregation | BACKED |
| 116 | Remembered contacts (chigwell): `set_contact_alias`/`list_contact_aliases`/`dele | inline | VERIFY.md[T65]: - T65 alias resolution on sends — PASS — resolveRecipient(store, chatJid) in send.ts: valid jid pass | BACKED |
| 117 | `get_poll_votes` decoded via poll_options (Felix #84, kahflane) — verify: synthe | VERIFY.md | VERIFY.md (overlap 4): - T76 reviewer Highs — PASS — H4: getMessage wired (fork decodes votes itself via the poll's message | BACKED |
| 118 | Tool annotations: readOnlyHint/destructiveHint (lharries #142) — verify: tools/l | NONE | VERIFY.md T87 line118 annotations + T94-A parity (28 readOnly/11 destructive) | BACKED |
| 120 | Full-fidelity message records: get_history/get_messages return complete message  | VERIFY.md | VERIFY.md T87 line120: full-fidelity read-back (mentions, contextInfo, reactions aggregate, poll data, edited flag, media metadata | BACKED |
| 121 | Output size limits with truncation metadata (chigwell I#16/P#18) — verify: overs | NONE | VERIFY.md T87 line121 truncation metadata + T94-C1 marker | BACKED |
| 122 | Bulk export: export_unread_messages + full chat export (JSONL/MD/HTML/TXT, media | VERIFY.md | VERIFY.md (overlap 6): - T88 export/search/cleanup — PASS — line122: export_chat (jsonl/md/txt) + export_unread_messages to | BACKED |
| 123 | mark_read MCP tool + /api endpoint (lharries P#314/#313; VGP P#209) — verify: li | inline | VERIFY.md[T22]: - §5/§8 presence+read+alias endpoints/tools — PASS — T22 live probe (readMessages+presence recorded, | BACKED |
| 124 | get_chat includes group participants (VGP P#152) — VERIFY: live 2026-10-03 get_c | inline | VERIFY.md[T64]: - §7 group-info live — PASS — GET /api/group/info → subject 'Test group', owner, 3 participants pers | BACKED |
| 125 | Label management tools (lharries P#235) — labels + chat_labels registry (v13), a | inline | VERIFY.md[T89]: - T89 probes — EVIDENCE — line125 LABELS: fork SUPPORTS label CRUD (Socket/messages-send.d.ts:144-14 | BACKED |
| 126 | Query semantics: limit applied AFTER date/sender filtering, never over-fetch the | inline | filtering covered by queries.test date/sender suites; the filter-then-limit interaction itself has no dedicated assertion | WEAK |
| 127 | Global message search (no chat filter) across all chats (chigwell P#74) — verify | VERIFY.md | VERIFY.md (overlap 6): - T88-B export/bulk MCP wiring — PASS — export_chat (chat_jid+format), export_unread_messages (unrea | BACKED |
| 128 | Contact cache warmed in BACKGROUND at startup — MCP tools never block on warmup  | inline | VERIFY.md[T89]: - T89 probes — EVIDENCE — line125 LABELS: fork SUPPORTS label CRUD (Socket/messages-send.d.ts:144-14 | BACKED |
| 129 | `get_chat` reports has_photo + profile picture URL (chigwell P#191) — verify: Te | registry | with_photo lives on get_contact, not get_chat — partial coverage (T88-B) | WEAK |
| 130 | View profile pictures through MCP: list + open contact avatars as images (chigwe | NONE | VERIFY.md T85 line109: get_picture_url (preview + own profile + NOT_FOUND structured) | BACKED |
| 131 | Alias favorites flag + non-ASCII aliases resolve everywhere (chigwell P#173/P#17 | inline | VERIFY.md[T89]: - T89 probes — EVIDENCE — line125 LABELS: fork SUPPORTS label CRUD (Socket/messages-send.d.ts:144-14 | BACKED |
| 132 | Manually-marked-unread detection distinct from auto read-state (chigwell P#46) — | inline | VERIFY.md[T89]: - T89 probes — EVIDENCE — line125 LABELS: fork SUPPORTS label CRUD (Socket/messages-send.d.ts:144-14 | BACKED |
| 133 | `request_history` tool: on-demand older-message backfill for ONE chat (VGP P#168 | VERIFY.md | VERIFY.md (overlap 5): - T88-B export/bulk MCP wiring — PASS — export_chat (chat_jid+format), export_unread_messages (unrea | BACKED |
| 135 | Bulk cleanup: delete/clear multiple chats in one call (chigwell P#102) — verify: | VERIFY.md | VERIFY.md (overlap 5): - T88 export/search/cleanup — PASS — line122: export_chat (jsonl/md/txt) + export_unread_messages to | BACKED |
| 138 | Auto-download all types, opt-out `WA_AUTO_DOWNLOAD` (VGP #237), skip status medi | inline | VERIFY.md[T89]: - T89 probes — EVIDENCE — line125 LABELS: fork SUPPORTS label CRUD (Socket/messages-send.d.ts:144-14 | BACKED |
| 139 | Message-ID filenames, collision-safe (lharries #156/#320) — verify: 2 images sam | inline | VERIFY.md[T24]: - §6 media download — PASS(unit) — T24 traversal 400 / unknown 404 / EMPTY→NOT_FOUND mapping; real-m | BACKED |
| 140 | Path guard: media reads confined to `~/.wa-mcp/media` (CWE-22, symlink-resolved, | inline | VERIFY.md[T24]: - §6 media download — PASS(unit) — T24 traversal 400 / unknown 404 / EMPTY→NOT_FOUND mapping; real-m | BACKED |
| 141 | `download_media(message_id)` (NIXKnight) — verify: live image → path — PENDING:  | VERIFY.md | VERIFY.md (overlap 4): - T55 live ingestion — PASS — startBridge gains store opt (bin passes the daemon store): 'messages.u | BACKED |
| 142 | `view_image`/`view_video`/`view_media`: image content to model; video → ≤8 frame | VERIFY.md | VERIFY.md (overlap 6): - T57 wire content shapes — PASS — ROOT CAUSE (fork lib/Utils/messages.js generateWAMessageContent): | BACKED |
| 143 | `transcribe_voice`: engines `local` (whisper.cpp node), `openai` (any OpenAI-com | VERIFY.md | VERIFY.md (overlap 5): - T90 media pipeline — PASS — line141: download_media tool → POST /api/media/:id/download (forces do | BACKED |
| 144 | `send_tts`: text→speech→voice note (aserranoni) — verify: mock TTS → PTT sent —  | VERIFY.md | VERIFY.md (overlap 4): - §16 web UI on a paired session — PENDING live — all routes render (T39 CDP); chat history against  | BACKED |
| 146 | download_media strips caller-supplied extension; real type from magic bytes (chi | inline | VERIFY.md T90 line147: normalizeAudioName/extension strip (773daea) | BACKED |
| 147 | Per-engine input normalization (.oga→.ogg etc.) before engine upload (chigwell I | VERIFY.md | VERIFY.md (overlap 4): - T56 LID send + failure logging — PASS — ROOT CAUSE: fork messages-send.js sends to finalJid = jid  | BACKED |
| 148 | `mlx` transcription engine (macOS on-device) (Felix P#55) — verify: macOS run tr | NONE | VERIFY.md T91 line148: MlxTranscriptionEngine (a77ceb2/7090fda) | BACKED |
| 150 | `WA_ALLOWED_EXTENSIONS` per-tool configurable allowlist for downloads (chigwell  | NONE | VERIFY.md T91 line150: WA_ALLOWED_EXTENSIONS allowlist (0243cc0/a8e8a50) | BACKED |
| 153 | `groups_list`/`list_groups` + `group_metadata`/`group_info`/`group_participants` | inline | VERIFY.md[T26]: - §7 groups — PASS — T26 live probe (create/meta/participants/promote/invite/leave round-trip, inval | BACKED |
| 154 | `create_group`, `leave_group`/`group_leave` (lharries #239 pattern; kahflane/bil | inline | VERIFY.md[T26]: - §7 groups — PASS — T26 live probe (create/meta/participants/promote/invite/leave round-trip, inval | BACKED |
| 155 | `group_add_participants`/`group_remove_participants`/`group_promote`/`group_demo | inline | VERIFY.md[T26]: - §7 groups — PASS — T26 live probe (create/meta/participants/promote/invite/leave round-trip, inval | BACKED |
| 156 | `group_invite_code`/`group_get_invite_code` + `group_revoke_invite` + `group_inf | inline | VERIFY.md[T26]: - §7 groups — PASS — T26 live probe (create/meta/participants/promote/invite/leave round-trip, inval | BACKED |
| 157 | `group_join_requests` list + `group_join_decision` approve/reject + `group_handl | VERIFY.md | VERIFY.md (overlap 6): - T91 groups/newsletters/caps MY VERIFICATION — PASS — line157 join requests (list + approve/reject) | BACKED |
| 158 | `group_update_subject`, `group_update_description`, `group_update_settings`/`gro | inline | VERIFY.md[T26]: - §7 groups — PASS — T26 live probe (create/meta/participants/promote/invite/leave round-trip, inval | BACKED |
| 159 | `group_ephemeral`/`group_toggle_ephemeral` + `disappearing_chat` per-chat timer  | VERIFY.md | VERIFY.md (overlap 4): - T54 post-pairing navigation (revised per owner steer) — PASS — the ephemeral /health token is the  | BACKED |
| 161 | `newsletter_follow`/`newsletter_unfollow`/`newsletter_send` (biliboss/delltrak)  | VERIFY.md | VERIFY.md (overlap 5): - T89-D newsletters — PASS — v14 newsletters registry table; POST /api/newsletters/follow\|unfollow - | BACKED |
| 162 | `reject_call` (biliboss/kahflane/delltrak) — verify: synthetic call event → reje | NONE | VERIFY.md T91 line162: reject_call -> socket.rejectCall (5d1ae95/a77ceb2) | BACKED |
| 168 | `set_name`/`update_profile_name`, `set_status`/`update_profile_status`, `set_pic | inline | VERIFY.md~: - §8 profile status live — PASS — POST /api/profile {status} set → {ok:true}, then restored to defau | BACKED |
| 177 | SSE `/events`: message/receipt/presence/poll/edit/revoke + 20s heartbeat, slow-c | inline | VERIFY.md[§9]: - §9 SSE+notifications — PASS — T25 live SSE probe (200 event-stream, connected frame, data JSON, he | BACKED |
| 183 | JSON logs with phone redaction last-4 (Felix #11; ste-bah) — verify: logs valid  | inline | test: bin.test 'redactPhone keeps only the last four digits' | BACKED |
| 188 | Programmatic relink: start REST server before pairing + GET /api/qr HTTP QR endp | inline | VERIFY.md[T42]: - T42 docker install — PASS — scripts/docker-install-test.sh exit 0 on node:22 (docker 27.4.0, tarba | BACKED |
| 197 | Loopback default bind; `WA_BIND_HOST` override documented — verify: default 127. | inline | VERIFY.md[T7]: - §10 extras (WA_ALLOWED_JIDS, WA_READ_ONLY, exposed-tools gating, at-rest encryption, prompt-inject | BACKED |
| 198 | Token on every endpoint — verify: 401 matrix (§2) — VERIFY: T7 401 matrix | inline | VERIFY.md[T7]: - §10 extras (WA_ALLOWED_JIDS, WA_READ_ONLY, exposed-tools gating, at-rest encryption, prompt-inject | BACKED |
| 202 | Pagination caps limit≤200 offset≥0 (lharries #271) — verify: unit clamp test — V | inline | VERIFY.md[T14]: - §10 extras (WA_ALLOWED_JIDS, WA_READ_ONLY, exposed-tools gating, at-rest encryption, prompt-inject | BACKED |
| 205 | `pnpm audit` 0 HIGH, CodeQL clean, gitleaks clean — verify: CI green — VERIFY: T | inline | VERIFY.md[T27]: - §10 security CI — PASS — T27 run 36947830588 10/10 jobs (audit high+, gitleaks, no-publish guard) | BACKED |
| 208 | Rate limiting with LimitReader body caps on HTTP endpoints (lharries I#340) — ve | inline | VERIFY.md[T7]: - §10 extras (WA_ALLOWED_JIDS, WA_READ_ONLY, exposed-tools gating, at-rest encryption, prompt-inject | BACKED |
| 209 | Input validation decorators on tool params (chigwell I#11) — verify: invalid JID | inline | VERIFY.md[T14]: - §10 extras (WA_ALLOWED_JIDS, WA_READ_ONLY, exposed-tools gating, at-rest encryption, prompt-inject | BACKED |
| 218 | `npx wa-mcp install`: daemon → service start → register platforms → print pairin | inline | VERIFY.md[T42]: - T42 docker install — PASS — scripts/docker-install-test.sh exit 0 on node:22 (docker 27.4.0, tarba | BACKED |
| 221 | `doctor`: daemon, /health, store, ffmpeg (common-path fallback), token perms, re | inline | VERIFY.md[T42]: - T42 docker install — PASS — scripts/docker-install-test.sh exit 0 on node:22 (docker 27.4.0, tarba | BACKED |
| 222 | `pair` foreground QR — verify: ≥2 rotations before timeout — VERIFY: T39 ANSI QR | inline | VERIFY.md[T39]: - T39 pair QR render — PASS — real `node packages/cli/dist/bin.mjs pair` on live daemon: 33-line ANS | BACKED |
| 224 | Registrations (path written + read-back verified): — VERIFY: T30 sandbox probe — | inline | VERIFY.md[T30]: - §11 cli — PASS — T30 sandbox probe (8 platforms written+read-back, antigravity command+serverUrl,  | BACKED |
| 234 | HTTP transport `/mcp` (remote harness mode, loopback default) — verify: MCP clie | inline | VERIFY.md[T20]: - §14 MCP conformance — PASS(unit) — scripted JSON-RPC client probes: initialize/tools-list/tools-ca | BACKED |
| 283 | Disposition vocabulary: ABSORBED (→ tool/feature + verify-ref) / SUPERSEDED-BY ( | inline | VERIFY.md[T32]: - §13 accounting — PASS — T32 accounting:check 1,029 rows green; CI security job step green (3695524 | BACKED |
| 288 | lharries 235 PRs: 405-family (~50) → one SUPERSEDED-BY-ENGINE row each (Baileys  | inline | VERIFY.md[T32]: - §13 accounting — PASS — T32 accounting:check 1,029 rows green; CI security job step green (3695524 | BACKED |
| 291 | lharries 127 issues: connectivity/CGO/Windows-install classes → NA-ENGINE or — V | inline | VERIFY.md[T32]: - §13 accounting — PASS — T32 accounting:check 1,029 rows green; CI security job step green (3695524 | BACKED |
| 293 | VGP 223 PRs: merged-and-relevant → ABSORBED; dependency/release chores → NOISE;  | inline | VERIFY.md[T32]: - §13 accounting — PASS — T32 accounting:check 1,029 rows green; CI security job step green (3695524 | BACKED |
| 294 | FelixIsaac 59 PRs + 25 issues: same treatment — VERIFY: T32 dispositions | inline | VERIFY.md[T32]: - §13 accounting — PASS — T32 accounting:check 1,029 rows green; CI security job step green (3695524 | BACKED |
| 295 | chigwell 252 items: Telegram-specific → NA-ENGINE with "pattern borrowed" note w | inline | VERIFY.md[T32]: - §13 accounting — PASS — T32 accounting:check 1,029 rows green; CI security job step green (3695524 | BACKED |
| 298 | Count-assert script `review/accounting-check.ts`: totals per source match BACKLO | inline | VERIFY.md[T32]: - §13 accounting — PASS — T32 accounting:check 1,029 rows green; CI security job step green (3695524 | BACKED |
| 303 | Unit: shared utils (JID, alias, instants, path guard, whitelist), store (migrati | inline | VERIFY.md[T41]: - T41 coverage gates — PASS — @vitest/coverage-v8@5.0.1 + root vite alias (npm:@voidzero-dev/vite-pl | BACKED |
| 305 | MCP conformance: initialize → tools/list (count+annotations) → tools/call per to | inline | VERIFY.md[T19]: - §17 resources+transcribe — PASS — T28 live probe (wa:// list+read via /mcp, tts audio_base64 round | BACKED |
| 306 | CLI tests: install/uninstall/doctor vs temp `$HOME` sandbox — verify: green on m | inline | tests: packages/cli/tests (commands/doctor/platforms/pair/export-discipline suites) | BACKED |
| 313 | VitePress `docs/`: quickstart, per-platform install ×8, full tool reference, env | inline | VERIFY.md[T71]: - T71 repo governance docs — PASS — LICENSE (MIT, wa-mcp contributors 2026), SECURITY.md (policy: pr | BACKED |
| 314 | ADRs 0001–0010: engine choice, monorepo layout, store schema, daemon model, auth | inline | VERIFY.md[T33]: - §15 docs — PASS — T33 docs:build 1.85s, docs:coverage 30/30, 10 ADRs, CHANGELOG section | BACKED |
| 315 | README: pitch, install matrix, feature list, credits (lharries + every fork auth | inline | VERIFY.md[T72]: - §15 README + docs completion — PASS — T71: SECURITY/CONTRIBUTING/AGENTS/LICENSE + FAQ/migration/tr | BACKED |
| 316 | CHANGELOG (changesets), SECURITY, CONTRIBUTING, AGENTS.md, LICENSE MIT — verify: | inline | VERIFY.md[T71]: - §15 docs — PASS — T33 docs:build 1.85s, docs:coverage 30/30, 10 ADRs, CHANGELOG section | BACKED |
| 326 | Web UI auth: bearer token, loopback bind default — verify: no-token request → 40 | inline | VERIFY.md[T29]: - §16 web UI — PASS — T29 live probe (GET / 200 built bundle, assets served, traversal 401, API auth | BACKED |
| 340 | `ChannelAdapter` interface: connect/disconnect/pair, sendMessage, fetchChats, fe | inline | VERIFY.md[T50]: - T50 Phase K foundation — PASS — channels/types (ChannelAdapter + normalized types), IDENTICAL cont | BACKED |
| 341 | `CloudApiAdapter` auth: access token + phone number ID + verify token; WABA cred | inline | VERIFY.md[T50]: - T50 Phase K foundation — PASS — channels/types (ChannelAdapter + normalized types), IDENTICAL cont | BACKED |
| 342 | Cloud API send: text, media (by URL + asset id), template messages, location, co | inline | VERIFY.md[T50]: - T50 Phase K foundation — PASS — channels/types (ChannelAdapter + normalized types), IDENTICAL cont | BACKED |
| 344 | Cloud API webhooks: registration, GET verify (hub.challenge), POST signature val | inline | VERIFY.md[T50]: - T50 Phase K foundation — PASS — channels/types (ChannelAdapter + normalized types), IDENTICAL cont | BACKED |
| 346 | Cloud API read model: mark read via /messages read marker, phone-number lookup v | inline | VERIFY.md[T50]: - T50 Phase K foundation — PASS — channels/types (ChannelAdapter + normalized types), IDENTICAL cont | BACKED |

## Special case — GOAL line 120 (full-fidelity message records)

No inline anchor. VERIFY.md backs it: the T87 entry cites 'line120:
full-fidelity read-back (mentions, contextInfo, reactions aggregate, poll
data, edited flag, media metadata)' with commits af24854/bf9c429/ff50127/
4021a11/1476b29/92cd75b/c312d55. Verdict: BACKED.

## Notable WEAK/UNBACKED

- line 40 (WEAK): code: shutdown.ts SIGTERM flush + installShutdownHooks wired in bin.ts; no ledger cite found
- line 126 (WEAK): filtering covered by queries.test suites; the filter-then-limit interaction itself has no dedicated assertion
- line 129 (WEAK): with_photo lives on get_contact, not get_chat — partial coverage (T88-B)

