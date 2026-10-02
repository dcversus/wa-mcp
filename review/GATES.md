# GATES.md — phase gate records

Append-only. One record per phase gate (GOAL §19). A failed gate blocks the next phase.

---

## Phase A — §1 bootstrap (+ §2 workstream start)

- **Date:** 2026-10-01
- **Gate (GOAL §19 A):** `vp check && vp test && vp run -r build`
- **Result:** PASS — exit 0

**Evidence (real excerpts, local run 2026-10-01):**

```
$ vp check
pass: All 34 files are correctly formatted (191ms, 8 threads)
pass: Found no warnings, lint errors, or type errors in 19 files (513ms, 8 threads)
$ vp test
 Test Files  6 passed (6)
      Tests  14 passed (14)
$ vp run -r build
vp run: 4/5 cache hit (80%), 2.49s saved.
gate exit: 0
```

**CI corroboration:** run 36909341285 — completed success, 8/8 jobs
(check, build, test × {ubuntu, macos, windows} × {20, 22}).

**Checkboxes covered:** GOAL §1 items 1–6 (repo init, monorepo scaffold, root
package.json, tsconfig.base.json strict, vite.config.ts, GitHub repo pushed) + §2
workstream start (shared jid types, strict TDD). §1 item 7 (branch protection)
deferred — see deviations.

**Deviations (all recorded in review/BLOCKED.md):**
1. Branch protection on main → HTTP 403, GitHub Pro required for private repos.
   Owner action pending; CI-on-push is the compensating mechanical gate.
2. Node 20 CI legs cannot run vp/vitest-5/pnpm-11 (engine evidence in BLOCKED.md);
   node-20 legs run a built-dist runtime smoke (`scripts/ci-smoke.mjs`) instead.
3. `packageManager` pinned to pnpm@11.10.0 (corepack shim for pnpm 12.8.1 broken
   on the dev machine); `vp build` at monorepo root is not a valid invocation —
   workspace build is `vp run -r build` (root `build` script wired accordingly).

## Phase B — §2 session daemon (unit gate GREEN, live gate DEFERRED)

- Validated by orchestrator (own runs, not agent claims):
  - bridge skeleton (BaileysEventMap-lifted types, event bus, lifecycle states) — T6, 31/31
  - security floor (auth matrix 401s, 1MB→413, token-bucket 429, loopback default) — T7, 44/44, live-probed
  - QR pairing surfaces (24-line ASCII stderr-safe + PNG base64) — T8, 57/57, live-probed
  - auth store (creds.json layout, atomic writes, 0700/0600, corrupt-safe) + store v1 (WAL, migrations) — T9, 71/71, live DB probe
  - robustness (backoff 1→60s cap, PID lock w/ stale recovery, SIGTERM ≤3s, WA_DEVICE_NAME) — T10, 89/89, live lock probes
  - bin entrypoint — T11, 97/97, LIVE BOOT PROBE: real WA handshake, QR rendered, /health {"status":"qr"}, token 600, dirs 700
- LIVE PAIRING GATE (QR scan → connected → restart no-QR): DEFERRED — owner has not scanned; announced on Telegram, awaiting go. Per contract, live pairing happens only with explicit owner confirmation.
- Verdict: unit-complete; live-gate tracked in BLOCKED.md.

## Phase C — §3 store + ingest + §5 read path (gate GREEN)

- Validated by orchestrator: ingest (18 message types, 23 extractor tests; 10 store behavior tests incl. VGP #229 timestamp lesson) — T12, 130/130
- Read queries + FTS5 migration v2 (injection-safe phrase quoting, accent-insensitive, lifecycle triggers) — T13, 143/143, LIVE FTS probe
- HTTP read endpoints (/api/chats /api/messages /api/context /api/search) — T14, 148/148, live e2e probe incl. limit clamp 99999→200
- Verdict: GREEN. All evidence mechanical + live-probed.

## Phase D — §4 send path (unit gate GREEN; live send matrix DEFERRED)

- Validated by orchestrator: builders on proto structs (text/mentions/reply/link-preview; 5 media kinds) + sendViaSocket (is_from_me=1 persist, kill-switch, INVALID_JID) — T15, 158/158
- SendGuard (pacing + persistent daily cap) + /api/send — T16; my live probe caught 2 integration bugs (pacing-before-validation; outbound content null + wrong sender attribution) → T16b RED reproductions + fix → my re-probe PASS — 175/175
- Send kinds: reaction/edit/forward/location/contact/poll via engine builders (poll messageSecret; buttons/lists = Business-account only, engine-truthed, NA-ENGINE note) — T17, 188/188
- Media upload path (base64/path/url, magic-byte MIME, traversal guard, <dataDir>/media persist) — T18, 201/201, live PNG probe; leftover DEBUG line removed in T19
- MCP server package: zero-dep JSON-RPC (SDK rejected: 11-dep web stack), 10→15 tools, stdio + /mcp HTTP transports — T19/T20, 216→225/225, live conformance probes (initialize/tools-list/tools-call/store-round-trip; stdio child-process)
- LIVE 14-kind send matrix: DEFERRED — requires pairing (owner gate, same as Phase B live gate).
- Verdict: unit-complete + MCP surface live; live-gate tracked in BLOCKED.md.

## Phase E — §5 read path continued (unit gate GREEN)

- contacts/chat-state store layer (merge semantics, aliases, unread, flags) — T21, 236/236, live probe (merge/name-keep, alias lookup, search, unread→0, archived flag)
- presence/read-receipt wrappers + /api/read|presence|chat-state|contacts|unread|alias endpoints + 5 MCP tools — T22, 246/246, live probe (readMessages+presence socket calls recorded, contacts search, unread cleared, mark_chat_read idempotent)
- Verdict: unit-complete; chat-flag live round-trip probed by orchestrator.

## Phase F — §9 events + notifications (unit gate GREEN)

- SSE /events (forwarding, heartbeat, disconnect cleanup, fan-out) + notification rules (CRUD + router, migration v5) + 3 MCP tools — T25, 284/284, live SSE probe (200 event-stream, connected frame, data JSON, heartbeats, 401)
- Verdict: unit-complete; OS notification delivery is the documented post-0.9 hook.

## Phase G — §7 groups (unit gate GREEN)

- group wrappers + /api/group/* endpoints + 5 MCP tools — T26, 292/292, live probe (create/meta/participants/promote/invite/leave round-trip, invalid action 400)
- Verdict: unit-complete; throwaway-group live cycle lands at Phase G live gate.

## Phase H — §11/§12/§16/§17 distribution + surfaces (unit gate GREEN)

- web UI (router/state/api/pages pure modules, static serving, SPA shell) — T29, 322/322, live probe (GET / 200 built bundle, assets, traversal 401, API auth intact)
- cli bin (install/doctor/status/start/stop) — T30, 337/337, sandbox probe (8 platforms written+read-back, antigravity command+serverUrl, idempotent re-install)
- skills + plugins (SKILL.md + references + installer) — T31, 344/344, sandbox probe (skills install + frontmatter)
- MCP transport/tools — T20 (225/225) + T28 (301/301) live probes; docs (ADRs + vitepress + coverage 30/30) — T33; accounting (1,029 dispositions, CI green) — T32; security CI job — T27 (run 36947830588, 10/10)
- Verdict: unit-complete; fresh-container `npx wa-mcp install` probe is the remaining §11 live gate.

## Phase I/J prep — version 0.9.0 + pack + records (this entry)

- All 6 packages at 0.9.0; SERVER_INFO 0.9.0; check/test/build green post-bump.
- Packed: wa-mcp-0.9.0.tgz (cli publish artifact), sha256 recorded in VERIFY.md, tarball gitignored.
