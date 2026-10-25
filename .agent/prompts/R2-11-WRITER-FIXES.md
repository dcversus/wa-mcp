# TASK: R2-11 — installer writer bugs: codex orphan accumulation (TDD, no commit)

## Live-found during the 27777 migration (reproduced on real configs)
1. CODEX: the TOML writer produced THREE args arrays under
   [mcp_servers.wa-mcp] over repeated installs (two 27777 + one stale
   8080) — orphaned `["/Users/.../bin.mjs", ...]` lines after the
   entry. Root-cause the writer (upsert appends a new args line
   without removing the previous, or emits a bare array when a key
   already exists). FIX: idempotent replace — one args line, old one
   removed; TOML stays valid; foreign entries untouched.
- RED: seed a config with an OLD entry → run install with a
  NEW port → assert exactly one entry with the new URL, foreign keys
  intact, file valid (parse it). Second install → identical output
  (idempotence).
- Also add a regression test pinning: repeated install N times → file
  content equals single-install content.
