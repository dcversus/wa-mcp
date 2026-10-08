# TASK: R2-11 — installer writer bugs: hermes no-op upsert + codex orphan accumulation (TDD, no commit)

## Live-found during the 27777 migration (both reproduced on real configs)
1. HERMES: `upsertYamlMapping` (writers.ts:92-106) only APPENDS when
   "wa-mcp:" is ABSENT; when present it returns the text UNCHANGED —
   reinstalls can NEVER update the entry (port/token changes silently
   ignored, "verified" reports true). Repro: install --target hermes
   --port 27777 on a config holding an 8080 entry → file unchanged.
   FIX: replace the existing wa-mcp block (find the `  wa-mcp:` key
   under mcp_servers, replace through the end of its mapping — until
   the next same-or-lower-indent key or EOF), preserve all other keys
   byte-for-byte.
2. CODEX: the TOML writer produced THREE args arrays under
   [mcp_servers.wa-mcp] over repeated installs (two 27777 + one stale
   8080) — orphaned `["/Users/.../bin.mjs", ...]` lines after the
   entry. Root-cause the writer (upsert appends a new args line
   without removing the previous, or emits a bare array when a key
   already exists). FIX: idempotent replace — one args line, old one
   removed; TOML stays valid; foreign entries untouched.
- RED for both: seed a config with an OLD entry → run install with a
  NEW port → assert exactly one entry with the new URL, foreign keys
  intact, file valid (parse it). Second install → identical output
  (idempotence).
- Also add a regression test pinning: repeated install N times → file
  content equals single-install content.
