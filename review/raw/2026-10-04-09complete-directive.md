# 2026-10-04 — owner directive: 0.1.0 not finished (verbatim)

"AND we should still working on 0.1.0 version! This version still not finished, not published, not yet ready! Dont inference this, i need you to verify everything and prepare me a goal prompt for execution what will include full documentation and qa/aqa review https://github.com/openclaw/openclaw/blob/main/.agents/skills/test-audit/SKILL.md https://github.com/openclaw/openclaw/blob/main/.agents/skills/auto-qa/SKILL.md https://github.com/openclaw/openclaw/blob/main/.agents/skills/deslop/SKILL.md https://github.com/openclaw/openclaw/blob/main/.agents/skills/openclaw-refactor-docs/SKILL.md Install this skills and then, include their using in prompt. Produce new goal prompt with everything i mentioned and asked above"

## Follow-up directive (same day, verbatim)

"For 0.1.0 notifications should be something simple, like everything mcp provides itself + maybe strimming to some file for agent to watch (selected channel in web-ui or via some mcp tool to subscribe for file?) and the same web-ui or mcp tool or cli - should provide option to subsxribe to chats/groups with hooks or please research latest claude and codex releases, they should have more options to get some events to react for. This and please, also add to prompt guidance rely for planning and verification for ~/.claude cli claude antropic witg opus, we have limits and tokens to use; draft me new goal prompt pls (and delete mentions of 0.10.0 which shoukd not be mentioned)"

## Research outcome (orchestrator 2026-10-04)
- Claude Code hooks (official docs, current): FileChanged, CwdChanged, ConfigChange, DirectoryAdded, WorktreeCreate/Remove, PreModelSwitch + asyncRewake (background hook, exit 2 → wakes Claude with stderr as system reminder). v2.1.289 era.
- Codex: ~/.codex/hooks.json + config.toml [hooks], command + mcp_tool hook types.
- Goal Phase 2 (Simple notifications N1-N6): MCP-native push + JSONL inbox files + subscribe from web/MCP/CLI + idempotent hook installer (claude FileChanged + asyncRewake variant, codex hooks.json) + rule delivery mcp|file|ui + cookbook page. No webhooks this release.
