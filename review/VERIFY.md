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
