# 0011 — Engine pairing fix: fork pin for companion_reg_refresh

> Update 2026-10-25: the fork is now consumed as a prebuilt vendored tarball (, built from this branch) so installs never re-run its yarn/tsc prepack; the pin rationale below is unchanged.

## Status

Accepted

## Context

Live pairing via QR scan was rejected by WhatsApp three times with fresh codes from a healthy daemon. Root cause is upstream baileys issue #2737: during pairing the companion rotates its registration identity mid-flow (`CB:notification,type:companion_reg_refresh`), and rc14's socket code ignores that notification, so the finished pairing is rejected server-side. Upstream PR #2765 (branch `fix/companion-reg-refresh`) handles the refresh. No released npm version contains it: `@whiskeysockets/baileys` dist-tags `latest` is 7.0.0-rc14 (the buggy one), and npm's `baileys` package shows nothing newer.

The owner reproduced the fix by hand-swapping `lib/Socket/socket.js` and `lib/Utils/companion-reg-client-utils.js` into the installed rc14 (backup `/tmp/baileys-lib-backup`, fixed copy `/tmp/baileys-fork/node_modules/baileys`).

## Decision

Pin the fork: `"baileys": "github:doryani-ai/Baileys#fix/companion-reg-refresh"`. The fork publishes as name `baileys` (verified via `npm view github:... name` → `baileys@7.0.0-rc14`), so all bridge imports moved from `@whiskeysockets/baileys` to `baileys` (27 files). Fresh `pnpm install` after the pin makes the earlier hand-swap of files inside `node_modules/.pnpm/@whiskeysockets+baileys@7.0.0-rc14*` irrelevant. `pnpm-workspace.yaml` allowBuilds permits the fork's install scripts by exact tarball URL.

## Consequences

- The installed engine (`node_modules/.pnpm/baileys@https+++codeload.github.com+doryani-ai+Baileys+tar.gz+4f26...`) contains the `companion_reg_refresh` handler (verified: 2 references in `lib/Socket/socket.js`, `companion-reg-client-utils.js` present).
- Imports use the bare `baileys` specifier — any future upstream release means changing the pin and the specifier back.
- GitHub tarball pins are immutable per commit sha-derived URL, so the supply-chain surface is pinned content, not a moving tag.
- When upstream releases rc15+ with #2765, revert to the registry package and restore the scoped imports.
