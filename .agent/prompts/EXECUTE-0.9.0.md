# EXECUTE: wa-mcp 0.9.0 — implemented, tested, committed. NOT published.

You are the implementing agent for the wa-mcp project. This prompt is your contract.
Read it fully, then read GOAL.md fully, before touching anything.

## Mission

Build `wa-mcp` — a 100% TypeScript Vite+ monorepo WhatsApp MCP server — to the complete
0.9.0 state defined in `GOAL.md`: every checkbox executed, committed, and backed by real
test output. **Nothing is published**: no npm publish, no public release, no registry or
directory listings. The deliverable is the private repo `dcversus/wa-mcp` at version
0.9.0 with green CI and a packed, publish-ready tarball that was never shipped.

## Operating mode (orchestrator-gated) — THIS SECTION OVERRIDES EVERYTHING ELSE

You execute ONE TASK AT A TIME. The orchestrator (Hermes) sends you a small, concrete
task; you implement it with TDD, commit, and STOP. The orchestrator validates your work
mechanically (git state, test runs, file diffs) before the next task arrives.

- Never run ahead of the current task. Never start the next phase or the next section on
  your own initiative.
- No multi-hour autonomous runs. A task should be one coherent, reviewable unit
  (typically 1–5 commits).
- When a task is done: finish with a SHORT report — task name, `§` checkboxes covered,
  commit hashes + subjects, test evidence (command + pass counts), files added, anything
  deferred/blocked. Then STOP and wait.
- When blocked mid-task: write `review/BLOCKED.md` entry, stop the affected work, and
  wait. Do not silently substitute a different approach.

## Source of truth (read in this order, before any code)

1. `GOAL.md` — 230 verifiable checkboxes across 19 sections. This is the entire scope.
   Sections: 1 bootstrap · 2 bridge daemon · 3 store · 4 send path · 5 read path ·
   6 media · 7 groups · 8 profile/privacy/status · 9 events · 10 security gate ·
   11 distribution · 12 skills+plugins · 13 accounting · 14 tests+CI · 15 docs ·
   16 web UI · 17 MCP surfaces · 18 Meta Cloud API dual-channel · 19 phases.
2. `review/BACKLOG-FULL.md` — raw census: 1,029 items (248 issues + 781 PRs) from 18
   reference repos. Never delete or shrink it. (If absent, the orchestrator will
   regenerate it — flag it in BLOCKED.md, do not regenerate it yourself.)
3. `review/ACCOUNTING.md` — created in Phase I (GOAL §13): one disposition row per census
   item with the fixed vocabulary (ABSORBED / SUPERSEDED-BY / NA-ENGINE / ALREADY-CORE /
   OUT-OF-SCOPE-0.9 / NOISE) + `review/accounting-check.ts` count-assert.
4. Architecture reference: claude-mem 13.28.0 — npx-cli commands/{install,doctor}.ts
   pattern, skills/, per-harness plugin dirs. Study it before designing the CLI.
5. Engine: `@whiskeysockets/baileys` (TypeScript-native, multidevice). Engine truth comes
   from its type definitions and runtime probes — never from assumptions.

## Definition of DONE — every line must be true

- [ ] Every GOAL.md checkbox §1–§18 is checked, each backed by evidence recorded in
      `review/VERIFY.md` (test name + command output, or live-verify note with timestamp)
- [ ] `vp check` green (oxlint + oxfmt + tsc strict, `noUncheckedIndexedAccess` on)
- [ ] `vp test` green; coverage: packages/bridge + packages/mcp-server ≥80%,
      packages/shared ≥90% — enforced in CI, not just locally
- [ ] CI matrix green: ubuntu + macOS + Windows × node 20/22 (check / test / build /
      security jobs)
- [ ] `review/ACCOUNTING.md` complete: all 1,029 census rows dispositioned;
      `vp run accounting:check` green and wired into CI
- [ ] All 8 owner platforms register in a sandbox `$HOME`: Claude Code, Claude Desktop,
      Pi, Hermes, Codex, Grok, Antigravity, Cursor — each config path written AND
      read-back-verified; HTTP `/mcp` transport works with bearer token
- [ ] Fresh-container install test: `node:20` Docker → install from local tarball
      (`file:`) → `npx wa-mcp install` → `doctor` all-green → daemon healthy
- [ ] Live smoke on the owner's real account GREEN (rules below), results in VERIFY.md
- [ ] `package.json` version = `0.9.0` exactly; `vp pack` produces `wa-mcp-0.9.0.tgz`;
      publish deferred by design
- [ ] Git tree clean; all phase work merged to main; CHANGELOG.md has an
      `## 0.9.0 (unreleased)` section enumerating the phase features
- [ ] 10 ADRs exist in `docs/adr/` (0001–0010, topics listed in GOAL §15);
      `docs:build` (VitePress) green; doc-coverage script reports every MCP tool
      documented

## Hard rules

1. **TDD, strictly**: red → green → refactor for every feature checkbox. No
   implementation without a failing test first. Tests are the story; zero comments in
   source code; docs explain, code executes.
2. **No publishing — mechanical guards, not intentions**:
   - CI release job exists but triggers ONLY on `workflow_dispatch`; no `push`/`tag`
     triggers anywhere in `.github/workflows/`
   - No `.npmrc` with tokens in repo or CI secrets; a CI guard step greps the repo for
     `npm publish`/`pnpm publish`/`npmjs.org` publish calls and fails if any exist
     outside documentation of the future publish process
   - No `git tag v*` creation, no GitHub Releases, no official MCP Registry `server.json`
     submission, no Glama/mcp.directory/Smithery submissions — those §11 checkboxes stay
     UNCHECKED with disposition "deferred to post-approval publish"
3. **Security floor lands before features** (first commits after bootstrap):
   loopback-only bind default, bearer token on every endpoint (401 matrix test),
   media path-traversal guard with symlink resolution, fail-closed whitelist, rate
   limits + body caps, `WA_SENDS_DISABLED` kill-switch. §10 is a release gate: a
   dedicated `security` CI job (audit + CodeQL + gitleaks) must be green before Phase D.
4. **Commits**: conventional commits (`feat:`, `fix:`, `test:`, `docs:`, `chore:`,
   `refactor:`); one logical change per commit; every commit leaves
   `vp check && vp test` green; no merge commits without a green gate record.
5. **Engine truth over optimism**: where a GOAL.md feature depends on an unverified
   Baileys capability (labels, member labels, newsletters), write the capability probe
   FIRST. If unsupported: ACCOUNTING `NA-ENGINE` row + probe evidence, checkbox gets
   the probe note. Never fake, never silently skip.
6. **No fabrication**: VERIFY.md entries must paste real command output or test names.
   A check you couldn't run = an unchecked checkbox. Nothing else counts.
7. **Scope discipline**: GOAL.md is the whole scope. Bright ideas beyond it go to
   `review/IDEAS.md`, not into code.

## Live testing rules (owner's real WhatsApp account)

- Chats allowed for live tests, exhaustively: Test group `120363428874442773@g.us` and
  the owner's own number `+358497773518`. No other chat, ever. No bulk sends. Group
  operations (create/leave/participant changes) use throwaway groups created for the
  test and left/deleted immediately after.
- New engine = a NEW linked device on the owner's account. When pairing is needed:
  render the QR (stderr + PNG file + web pairing page), announce it, and WAIT — do not
  proceed past pairing until the owner confirms the scan. Never pair without warning.
- Every live test must round-trip: send → store row → read back → assert.
- All live results land in `review/VERIFY.md` with ISO timestamps.
- Transcription/TTS/Cloud-API live tests: use mock engines by default; live engine runs
  only with owner's go-ahead.

## Execution order (GOAL.md §19 — gates are hard; the orchestrator triggers each phase)

Phase A bootstrap → B session daemon → C store+ingest → D send path → E read path →
F media+events → G groups+security → H distribution+skills+plugins+web-ui+surfaces →
I docs+accounting → J pre-release hardening (14-day dogfood OFFERED to owner, all gates
re-run, `vp pack` artifact verified) → K Cloud API dual-channel (parallel start allowed
after G).

Per phase: finish every checkbox → run the phase gate → commit gate record to
`review/GATES.md` → only then start the next phase. Phases C–E may interleave per-file
but not per-gate.

Workstream order inside each phase: shared types → store → bridge endpoints → MCP
tools → CLI/skills → docs row in ACCOUNTING.

## Verification discipline (how each checkbox earns its check)

1. Mechanical first: unit + integration tests (recorded Baileys event fixtures replayed
   offline — record them during Phase B live pairing), schema snapshot tests, CI matrix.
2. MCP conformance: scripted client — initialize → tools/list (count + annotations) →
   tools/call per tool against a mock bridge → assertions on structured errors.
3. Live smoke: only what genuinely needs the real account (send matrix, SSE, pairing,
   read-state).
4. Every check gets a VERIFY.md line: `§<n> <short item> — PASS — <evidence>`.

## When blocked

- Baileys capability missing → NA-ENGINE accounting row with probe evidence; continue
  (report in your task summary).
- GOAL.md ambiguity → take the stricter/safer reading; record it in an ADR; continue.
- Need the owner (QR scan, live-account risk, Cloud API sandbox creds, judgment call) →
  write exactly what you need into `review/BLOCKED.md` with a proposed default; stop the
  affected task; continue with only the non-blocking parts if cleanly separable; report.
- Toolchain failure (vp, node native modules) → try the documented fallback path; if
  truly stuck, BLOCKED.md entry with full error output.

## Task report format (every task)

When a task completes, end with: task name, checkboxes covered (`§n`), commits made
(hashes + subjects), test evidence (command + pass counts), files added, anything
deferred or blocked. Then STOP and wait for the next task.
