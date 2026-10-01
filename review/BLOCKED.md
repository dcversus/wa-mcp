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
