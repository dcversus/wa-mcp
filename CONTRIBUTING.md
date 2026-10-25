# Contributing

## Dev setup

- Node ≥ 26 (the store uses `node:sqlite`), pnpm 11 (see `packageManager`).
- `pnpm install` then `pnpm run build` (bridges web-ui into bridge/dist/web).
- Gates: `vp check` (format+lint+types), `vp test`, `vp run -r build`.
- Docs: `pnpm run docs:build` + `pnpm run docs:coverage` (every tool must be
  documented).

## TDD policy

Strict RED→GREEN. Every behavior lands as a failing test commit first (the
commit message quotes the exact assertion failures), then the GREEN commit
quotes the same evidence going green. Mocks must emulate the ENGINE's real
shapes — hand-built fixtures that never caught the bug are worse than none
(see T57: mock sockets accepted proto shapes the real engine rejects).

## Test conventions

- Per-suite timeouts are generous (15-20s) — the suite must stay green on a
  loaded machine (T46 lesson: 5s defaults flaked under load).
- Fake sockets emulate the engine's output protos ({text} →
  extendedTextMessage, media inputs → <kind>Message).
- Engine-truth first: read the fork source
  (`node_modules/.pnpm/baileys@https*/node_modules/baileys/lib/...`) before
  assuming behavior.

## Commits

Conventional commits (`fix:`, `feat:`, `test:`, `docs:`, `chore:`). RED
evidence is quoted in the test commit message. No publishing — the repo
carries a CI no-publish grep guard by contract.

## Code comments

Comments only where engine truth or a non-obvious decision demands
documentation (fork quirks, WhatsApp semantics). No narration.

## Coverage gates

`vp test --coverage` enforces: bridge ≥80%, mcp-server ≥80%, shared ≥90%
lines. The web-e2e (`vp run webui-e2e`) is the browser use-case gate.
