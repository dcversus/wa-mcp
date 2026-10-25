# TASK: R2-10 — Default port 8080 → 27777 (TDD, no commit)

## Canon (owner decision, 2026-10-08)
Default port changes to 27777 (valid, IANA-unassigned, conflict-free;
owner pick after research). 8080 must REMAIN supported via --port/PORT
for existing installs. Decision + research recorded in
docs/raw/2026-10-07-webui-r2-restructure.md (bottom).

## Part A — bridge default
1. Find the default-port constant (bin.ts:49 area, DEFAULT_PORT or
   similar) → 27777. Grep for OTHER hardcoded 8080s across
   packages/*/src (web-ui assumes same-origin — verify; mcp-server
   bridge URL default; cli status/doctor defaults; installer
   command/args written into 8 MCP host configs).
2. The installer writes URLs/args into host configs at install time —
   existing installs keep working (they carry their own explicit
   port? VERIFY: if the written config omits the port and relies on
   the default, those break on upgrade → the installer must ALWAYS
   write the explicit port going forward; note what it writes today).
- RED: default-port test (start with no --port → listens on 27777);
  explicit --port 8080 still works.

## Part B — cli + docs
1. cli bin/doctor/status/help text defaults.
2. docs/**: every http://127.0.0.1:8080 and :8080 URL → 27777, EXCEPT
   historical/ADR/migration contexts. Add a migration note in
   docs/configuration.md + README ("Upgrading: existing installs with
   explicit port unaffected; default changed 8080→27777 in 0.1.0").
3. CHANGELOG entry.
- RED: docs drift tests if any pin 8080; cli usage tests.

## Part C — tests + e2e
1. Suite-wide grep for 8080 in tests: most use ephemeral ports
   already — fix only DEFAULT-dependent pins.
2. scripts/webui-e2e.mjs + webui-dogfood.mjs: use the new default or
   (better) PORT env passthrough; keep them green.
- RED: run full suite; fix failures.

## Part D — live migration (orchestrator does this; agent just notes)
Do NOT touch the running daemon or the launchd plist. In the report,
list the exact commands the orchestrator must run:
- rebuild, update ~/Library/LaunchAgents/com.wa-mcp.bridge.plist
  (--port or default), kickstart, verify /health on 27777, verify
  8080 no longer bound, verify one MCP client still connects.

Report: files touched, where 8080 remained (justified), plist
migration commands, gates.
