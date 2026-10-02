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
