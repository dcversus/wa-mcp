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
