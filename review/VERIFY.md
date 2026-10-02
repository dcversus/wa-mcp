# VERIFY.md — evidence per checkbox

Append-only. Format: `§<n> <short item> — PASS|FAIL|DEFERRED — <evidence>`.
"A check you couldn't run = an unchecked checkbox" (contract rule 6).

---

- §1 repo-init — PASS — 1 commit 8a32c08, artifacts tracked
- §1 monorepo-scaffold — PASS — vp check 16 files / vp test 5/5 / build 5 pkgs
- §1 github-repo — PASS — dcversus/wa-mcp private, local==remote 6d71a6e
- §1 ci-matrix — PASS — run 36909341285 all 8 jobs success (check, build, test × 3 os × 2 node)
- §1 branch-protection — DEFERRED — GitHub Pro required, BLOCKED.md
- §2 jid-utils — PASS — commits f94b928(RED)+88f1ac9, 14/14 tests
- §5/§8 contacts+chat-state — PASS — T21 live probe (merge/name-keep, alias lookup, search, unread→0, archived) + 236/236
- §5/§8 presence+read+alias endpoints/tools — PASS — T22 live probe (readMessages+presence recorded, contacts search, unread cleared) + 246/246
- §9 SSE+notifications — PASS — T25 live SSE probe (200 event-stream, connected frame, data JSON, heartbeats, 401) + 284/284
- §7 groups — PASS — T26 live probe (create/meta/participants/promote/invite/leave round-trip, invalid action 400) + 292/292
- §16 web UI — PASS — T29 live probe (GET / 200 built bundle, assets served, traversal 401, API auth intact) + 322/322
- §11 cli — PASS — T30 sandbox probe (8 platforms written+read-back, antigravity command+serverUrl, idempotent) + 337/337
- §12 skills — PASS — T31 sandbox probe (skills install + frontmatter check) + 344/344
- §17 resources+transcribe — PASS — T28 live probe (wa:// list+read via /mcp, tts audio_base64 round-trip, transcribe NOT_FOUND mapping) + 301/301
- §13 accounting — PASS — T32 accounting:check 1,029 rows green; CI security job step green (36955241911)
- §10 security CI — PASS — T27 run 36947830588 10/10 jobs (audit high+, gitleaks, no-publish guard)
- §6 media download — PASS(unit) — T24 traversal 400 / unknown 404 / EMPTY→NOT_FOUND mapping; real-media joins live gate
- §15 docs — PASS — T33 docs:build 1.85s, docs:coverage 30/30, 10 ADRs, CHANGELOG section
- §19 pack — PASS — wa-mcp-0.9.0.tgz sha256 7b40734531ef592289e75e07b0ac57fd1155150b0b5d4590a979d6ba5ce913e0 (self-contained: bundled @wa-mcp/bridge+mcp-server+shared with transitive tree, gitignored)
- §11 sandbox tarball install — PASS — fresh dir: npm init + npm install file:wa-mcp-0.9.0.tgz → npx wa-mcp install (cursor verified) → start → /health 200 {"status":"qr"} on --port 8123 → doctor all-ok rows → status renders (2026-10-02, output in commit c98d7e2-era packaging fix)
- T39 pair QR render — PASS — real `node packages/cli/dist/bin.mjs pair` on live daemon: 33-line ANSI terminal QR (qrcode toString type:terminal small) + wa.me copy/paste line + timeout hint; exit 1 at --timeout 8000 (no scan performed); RED 53b270e (3 failed) → GREEN 4e01a52 (cli 32/32)
- T39 web pairing inline token — PASS — CDP smoke (headless Chrome, live daemon :8080, bundle index-QbcUp9S_.js): `#/pairing app innerHTML length: 280`, inline settings-form+token present, hash stays #/pairing (no redirect), #/settings form ok, nav ok → webui-smoke PASS; RED d0967cf (2 failed) → GREEN f90d3a4 (web-ui 27/27)
- T39 full gate — vp check exit 0 (28 warnings across 110 files, pre-existing), vp test 365/365 (48 files)
- T40 build-order — PASS — rm -rf packages/bridge/dist/web && pnpm run -r build → exit 0, dist/web/index.html exists; copy runs after web-ui build AND after bridge vp pack (wipe repair); bridge-only build keeps web; missing web-ui/dist fails loudly exit 1; RED (build-order.test.ts, expected false to be true) → GREEN

## 2026-10-02 — release tarball (post-T40 rebuild)
- wa-mcp-0.9.0.tgz = packages/cli pnpm pack (bundledDependencies: @wa-mcp/bridge, @wa-mcp/mcp-server, @wa-mcp/shared, qrcode + fork baileys WITH companion_reg_refresh fix — verified: 2 refs in bundled socket.js)
- Fresh sandbox: npm install tgz → 0 vulnerabilities → bin runs with pair in usage
- sha256: 325a60d738b796cd0a99b51f804ac1dc16058b85e8441338263ec9c6e9941e02
- Reproducible via scripts/pack-release.sh
- T41 coverage gates — PASS — @vitest/coverage-v8@5.0.1 + root vite alias (npm:@voidzero-dev/vite-plus-core@1.0.0, fixes vitest peer pairing with vitepress's vite 5 lacking ./module-runner); thresholds in vite.config.ts: bridge lines 80 (actual 82.89), mcp-server 80 (88.36), shared 90 (97.77); engine proven to bite: 'Coverage for lines (97.77%) does not meet global threshold (99%)' → exit 1; CI test job runs the three `pnpm --filter <pkg> exec vp test --coverage` gates (local-verified, CI confirmation pending billing fix); lifecycle.test.ts made hermetic (afterEach closes handles — leaked real reconnect timers fired mid-test under coverage slowdown, 1 failed | 260 passed → 3×261 green)
- T42 docker install — PASS — scripts/docker-install-test.sh exit 0 on node:22 (docker 27.4.0, tarball sha256 325a60d7…): nested bridge bin resolved via require.resolve from installed cli (`/tmp/node_modules/@wa-mcp/cli/node_modules/@wa-mcp/bridge/dist/bin.mjs`), /health {"version":"0.9.0"}, doctor all-green, FRESH-CONTAINER INSTALL TEST: PASS; node:20 image impossible (node:sqlite ≥22.5) — floor raised, ratification requested in BLOCKED.md

## 2026-10-02 — T43 evidence sweep vs GOAL §1–§18 checkboxes (append-only)

Missing-evidence sweep. Everything below is either a newly recorded PASS for
work that lacked a VERIFY line, or an honest PENDING / OUT-OF-SCOPE marker —
no checkbox is claimed without evidence.

- T-A engine fork pin — PASS — `baileys` pinned to github:doryani-ai/Baileys#fix/companion-reg-refresh (ADR 0011); installed engine verified: companion_reg_refresh handler present (2 refs in socket.js, companion-reg-client-utils.js shipped); 361/361 at pin time, 369/369 now.
- T38 pair subcommand — PASS — `wa-mcp pair` (--qr default, --code <phone>, --bridge-url/--token, 180s timeout, exit codes) RED bbbc201 → GREEN 20d0ee2; QR surface superseded by the T39 ANSI-render PASS above.
- T-C onboarding e2e — PASS — scripts/onboarding-test.sh: fresh mktemp dir → bridge dist bin → pairing-eligible → POST /api/pairing-code (REAL WhatsApp codes issued: 7824-V5NY, KB21-QT91, FSPH-27AF) → daemon restart → negative control (still pairing-eligible, not connected); commit 6f34491.
- Web UI first-run deadlock — PASS — root cause: main.ts was never rewired onto renderFrame (prior commit message overclaimed); rewritten + CDP smoke (headless Chrome) proves #/pairing and #/settings render non-empty with no stored token; commit 228873d.
- QR pool exhaustion recovery — PASS — lifecycle regression: 3 rounds qr → close(428) → advance 60s → fresh QR re-issued, daemon survives without manual restart; commit df297d2.
- §1 ci-matrix (current main) — PENDING ci — GitHub Actions billing: runs 36979526866/36979823287 never start (owner action, BLOCKED.md). Local equivalents green (check/test/build). Last full-matrix green was 36909341285 on an older main.
- §2 QR/pairing live scan — PENDING live — pairing still fails: handshake reaches WhatsApp but creds.update never persists (auth dir empty) and registration cycles repeat with identical devicePairingData. Engine analysis (this session): `requestPairingCode` sets `creds.me` in the shared auth state and nothing clears it; the fork's companion_reg_refresh rotation is gated on `!creds.me` → adv secret never rotates after the server retires it → QR advertises dead material; with `creds.me` set every reconnect takes the login branch (socket.js:322) instead of registration. Proposed fix (RED+GREEN): strip `creds.me`/`pairingCode` on reconnect when `creds.registered !== true` + serialize/error-log saveCreds — not yet implemented; instrumented rescan next.
- §4 extras (schedule_message, templates, autoreply, send_event, restrict_sending, broadcast, logout, view_once, check_number_exists, status posts, send_buttons/list live) — OUT-OF-SCOPE 0.9 — store tables exist (migrations v5/v6) but no tools/endpoints; ACCOUNTING OUT-OF-SCOPE rows. No PASS claimed.
- §5/§6 extras (fetch_history, catch_up digest, MCP prompts, bulk export, view_image/video frames, auto-download pipeline, mlx/openai/elevenlabs engines) — OUT-OF-SCOPE 0.9 — ACCOUNTING rows; mock transcribe/tts only (T28 PASS line above).
- §7/§8 extras (ephemeral timers, member labels, newsletters, reject_call, star/pin, mute) — OUT-OF-SCOPE 0.9 — ACCOUNTING rows (groups core set probed live, T26).
- §9 extras (webhooks, JSONL feed, wait_for_message, /metrics, StreamReplaced recovery, caller fingerprinting) — OUT-OF-SCOPE 0.9 — ACCOUNTING rows; SSE core probed live (T25).
- §10 extras (WA_ALLOWED_JIDS, WA_READ_ONLY, exposed-tools gating, at-rest encryption, prompt-injection marking, DNS-rebinding guard, Keychain, per-tool timeouts) — OUT-SCOPE 0.9 — security floor shipped: loopback, bearer 401-matrix, 1MB cap, rate limit, send guard + kill switch, structured errors, path confinement (T7/T14/T16/T18/T24 PASS lines above); audit high+ / gitleaks / no-publish green in CI pre-billing.
- §11 extras (launchd/systemd/TaskScheduler services, update/uninstall/restart/logs, DXT manifest, docker compose, registries/directories, WA_PROXY) — OUT-OF-SCOPE 0.9 — no-publish contract; install/doctor/status/start/stop/skills/pair PASS lines above.
- §13 accounting — PASS — 1,029 rows, vocabulary asserted, accounting:check green (CI run 36955241911 pre-billing; green locally now).
- §14 unit+coverage — PASS — 369/369; thresholds enforced per package (T41).
- §14 MCP conformance — PASS(unit) — scripted JSON-RPC client probes: initialize/tools-list/tools-call round-trips, stdio child-process, /mcp HTTP (T19/T20/T28).
- §14 live smoke (nightly) — PENDING live — requires paired session; same gate as §2.
- §14 CI release job + commitlint/changesets — OUT-OF-SCOPE 0.9 — no-publish guard forbids release wiring; conventional commits enforced by review discipline.
- §15 docs — PASS — 11 ADRs now (0001–0010 + 0011 engine fork); VitePress build green; docs:coverage 30/30; CHANGELOG updated with onboarding round.
- §16 web UI on a paired session — PENDING live — all routes render (T39 CDP); chat history against a live store needs pairing.
- §18 Cloud API dual channel — NOT BUILT 0.9 — Phase-K decision pending orchestrator; ACCOUNTING rows.
