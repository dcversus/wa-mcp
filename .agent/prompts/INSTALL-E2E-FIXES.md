# TASK: fix 3 installer bugs found in live install E2E (TDD)

Verified against REAL installs: claude code, pi (pi-mcp-extension 1.5.1),
codex, grok, antigravity, claude desktop.

## Bug 1: pi writer writes the WRONG PATH + WRONG SHAPE
- Writer writes `~/.pi/mcp/wa-mcp.json` (bare spec, single file).
- The actual pi MCP extension reads `~/.pi/agent/mcp.json` with an
  `mcpServers` wrapper: `{"mcpServers": {"wa-mcp": {command, args, env,
  transport: "stdio"}}}`.
- Live proof: manual agent/mcp.json config connected instantly; the
  installer's file was never read by pi.
- Fix: writer targets `~/.pi/agent/mcp.json`, MERGES (does not clobber)
  other servers, adds `transport: "stdio"`. Uninstall removes only the
  wa-mcp key. Keep `~/.pi/mcp/wa-mcp.json` removal as migration (delete the
  legacy file if present).
- Update docs/getting-started/platforms.md Pi section to match.

## Bug 2: UI hook snippet is a broken command
- `packages/web-ui/src/pages.ts:487` renders `wa-mcp inbox drain --sub <id>`
  but the CLI takes `--inbox <path>` and there is NO `--sub` flag.
- Fix: snippet becomes `wa-mcp inbox drain --inbox <inboxPath>` (the row
  already has the absolute path). Update t114 test expectations.

## Bug 3: multi-target install only applies the LAST --target
- `install --target a --target b --target c` registered ONLY c.
- Repro: uninstall all three, install with three flags, doctor shows one.
- Fix: iterate ALL --target values. RED test first (arg parsing level).
- Also: top-level usage string omits `inbox` and `hook` subcommands — add
  them.

## Gates
- vp test full suite green; vp check 0. Do NOT commit. Report back.
