# BLOCKED.md — orchestrator-gated items

Append-only. Each entry: date, blocker, proposed default, status. Resolved entries get a
resolution line but are not deleted.

---

## 2026-10-01 — Session start: two contract inputs missing

**Blocker 1 — contract file absent.** `.agent/prompts/EXECUTE-0.9.0.md` did not exist
(repo contained only GOAL.md). Cannot read the original contract.

**Proposed default:** reconstructed the contract from the orchestrator message + GOAL.md §19
into `.agent/prompts/EXECUTE-0.9.0.md` (marked RECONSTRUCTED at top). Executing under it.
Original, if supplied later, supersedes.

**Status:** RESOLVED 2026-10-01 by orchestrator — original contract written to .agent/prompts/EXECUTE-0.9.0.md (orchestrator-gated mode added). The reconstructed copy was replaced.

---

**Blocker 2 — census artifact absent.** GOAL §13 declares `review/BACKLOG-FULL.md`
(1,029 items: 248 issues + 781 PRs, all states, 14 repos, fetched 2026-10-01) a committed
census artifact, and the orchestrator asked for `review/raw/` review. Neither exists.

**Proposed default:** regenerate the census from the GitHub API (`gh` CLI, all states:
open/closed issues + merged/closed PRs) for the 14 repos named in GOAL §13, writing
`review/raw/*.json` + the generated `review/BACKLOG-FULL.md`. Census generation is
scheduled before Phase I (accounting) since dispositions consume it; not a Phase A blocker.

**Status:** RESOLVED 2026-10-01 by orchestrator — review/BACKLOG-FULL.md + review/raw/ regenerated (1,029 items, 18 repos).

---

## 2026-10-01 — Branch protection on main requires GitHub Pro (GOAL §1, task 3)

**Blocker:** `PUT /repos/dcversus/wa-mcp/branches/main/protection` → HTTP 403
"Upgrade to GitHub Pro or make this repository public to enable this feature."
The `dcversus` account is on GitHub Free; branch protection rulesets are unavailable
for private repos on Free.

**Proposed default:** owner upgrades the account to GitHub Pro (or grants a plan that
includes protected branches); the exact PUT payload is ready and will be applied
immediately after. Until then: no branch protection on main. Compensating controls —
repo is private with a single owner; all main pushes are orchestrator-validated task
commits; the `ci` workflow (check / test×6 / build) runs on every push and is the
mechanical gate.

**Status:** OPEN — needs owner action (plan upgrade). No other task blocked.

---

## 2026-10-01 — Node 20 cannot run vp/vitest 5 toolchain (GOAL §14 CI matrix)

**Blocker (evidence, not assumption):** vite-plus 1.0.0 `engines.node` =
`^22.18.0 || ^24.11.0 || >=26.0.0`; its bundled vitest 5.0.1 `engines.node` =
`^22.12.0 || ^24.0.0 || >=26.0.0`; pnpm 11 requires Node >=22.13. First CI run
(36906487255) confirmed: all three `test (node 20)` legs failed at
`actions/setup-node` with `ERR_UNKNOWN_BUILTIN_MODULE: node:sqlite` from pnpm 11.
Node 20 legs therefore cannot execute `vp test` (or vitest 5, or pnpm 11).

**Proposed default (implemented):** keep the 6-leg matrix (ubuntu/macos/windows ×
20/22). Node 22 legs run the full `pnpm exec vp test`. Node 20 legs verify what a
node-20 leg can honestly verify — that the built `dist` output runs on Node 20:
`build` job uploads `packages/*/dist` as an artifact, node-20 legs download it and
run `node scripts/ci-smoke.mjs` (imports each package's built entry, asserts
exports). Devtool compatibility testing on Node 20 is impossible with the mandated
toolchain; alternatives (standalone vitest@3 shadow dep) rejected as flaky/dishonest.

**Status:** OPEN for orchestrator review — matrix passes mechanically, but if the
orchestrator wants genuine vp-run tests on node 20, the toolchain choice (vp
version) must change. No other task blocked.

## 2026-10-02 — npm name squat-watch (owner request: secure wa-mcp everywhere ASAP)

- Owner asked to take the `wa-mcp` name everywhere ASAP ("check for example npm cli").
- Probed (2026-10-02, orchestrator, curl):
  - `https://registry.npmjs.org/wa-mcp` → 404 (name FREE, unscoped)
  - npm org `wa-mcp` → no org exists (FREE)
  - GitHub org `wa-mcp` → 404 (FREE)
  - Docker Hub `wa-mcp` → count 0 (FREE)
  - **PyPI `wa-mcp` → 200 — TAKEN by a third party** (squat risk is REAL, confirmed)
  - npm nearby names: @open-wa/mcp, @wppconnect/wa-version exist — ecosystem squatting observed
- Blocker: local `npm` has an old npmjs.org token (E401, expired), no valid npm credentials on this machine; `npm login` requires interactive browser + 2FA; gh API cannot create orgs (404 — org creation is web-only per GitHub).
- Proposed default: owner logs into npm in their browser/terminal once (or drops a fresh granular publish token into ~/.npmrc via `npm token create`), then orchestrator immediately (a) `npm org create wa-mcp` or first-publish of the 0.9.0 tarball as `wa-mcp@0.9.0` placeholder = name claimed, (b) GitHub org `wa-mcp` created manually by owner (web-only), (c) Docker Hub namespace later (post-0.9.0).
- NOTE: contract "NOT PUBLISHED" hard rule — first publish of the real 0.9.0 stays deferred; the name-claim publish (if owner approves) would be a minimal placeholder package (name + description + repo link) to establish priority. Awaiting owner decision: claim-now-placeholder vs full-0.9.0-first-publish.

## 2026-10-02 — npm name-claim attempt (2FA gate)

- npm authenticated as `dcversus` (fresh token present in ~/.npmrc).
- `wa-mcp` verified FREE at claim time; placeholder `wa-mcp@0.0.1` (name+description+repo link, 2 files, no code) built and dry-run clean.
- `npm publish` → blocked by account 2FA (one-time password required). Orchestrator cannot read OTP codes — owner asked via Telegram for: OTP relay, self-publish, or 2FA-disable-then-retry.
- Real 0.9.0 publish remains deferred (contract rule 2). Placeholder only claims the name.

## 2026-10-02 — Remaining live gates (post Phase E–H)

- Pairing gate (Phase B): owner QR scan → connected → restart persistence. All unit surfaces green; announced, waiting.
- 14-kind send matrix (Phase D): needs the paired session; Test group + own number only.
- Real-media download + transcription (Phase F/H): engine downloadMediaMessage against live media; unit paths mocked.
- npm name-claim 2FA (above): placeholder publish blocked on OTP relay / self-publish / 2FA decision.

## 2026-10-02 — Docker fresh-container install test (TASK 35) blocked on daemon

**Blocker:** Docker Desktop 27.4.0 is installed but the daemon is down. Start attempt
(`open -a Docker`) is stuck on the **privileged-helper authorization prompt**
(osascript `docker-desktop-privileged` waiting for owner approval) — an owner UI action.
No alternative runtime on this machine (no podman/colima/lima).

**Ready to run:** `scripts/docker-install-test.sh` + `scripts/docker-install-test-inner.sh`
(syntax-checked). The inner script executes the exact GOAL §11 contract: node:20 container
(tarball mounted, no repo checkout) → npm install file:tarball → npx wa-mcp install →
doctor (bridge-down FAIL rows expected) → daemon start → /health must contain
`"version":"0.9.0"` → doctor all-green → stop.

**Owner action:** approve the Docker Desktop helper prompt (or start Docker Desktop),
then run `scripts/docker-install-test.sh wa-mcp-0.9.0.tgz` — or tell me and I'll run it.

**Status:** BLOCKED on owner UI action. Everything else in TASK 35 delivered.

## 2026-10-02 10:45 — GitHub Actions billing failure (owner action required)

- CI runs 36979526866 + 36979823287: all jobs fail within 2-6s with "The job was not started because recent account payments have failed or your spending limit needs to be increased."
- Zero code involved — jobs never started. Local gates stay green in the meantime (vp check/test/build).
- Owner action: GitHub → Settings → Billing & plans → fix payment method or raise spending limit.
- CI green-state verification deferred until billing is restored (Definition-of-DONE CI-matrix item blocked on this).
