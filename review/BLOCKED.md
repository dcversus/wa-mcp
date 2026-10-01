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
