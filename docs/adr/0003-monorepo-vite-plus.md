# 0003 — Monorepo layout: vite-plus toolchain

## Status

Accepted

## Context

Five packages (bridge, mcp-server, cli, web-ui, shared) share types and a build/test/check pipeline. The owner's toolchain is Vite+ (`vp`), which wraps vite, roldown/tsdown packing, oxlint and vitest behind one CLI.

## Decision

pnpm workspace with `packages/*`; every script is a vp command (`vp check`, `vp test`, `vp run -r build`). `vp build` at the workspace root is not a valid invocation (vp prints the valid forms); the root build script is `vp run -r build`. Package manager pinned to pnpm 11.28.3 via `packageManager` (auto-managed, `onFail: download`).

## Consequences

- One format/lint/type gate (`vp check`) across 5 packages; CI mirrors it.
- Workspace deps resolve to dist, so CI jobs build `@wa-mcp/shared` and `@wa-mcp/mcp-server` before check/test.
- The security classifier blocked a scaffold-style vite catalog alias; web-ui builds with `vp build` (the same vite) — zero extra packages.
