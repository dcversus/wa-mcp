# 0002 — Zero-dependency bridge: node:http + node:sqlite

## Status

Accepted

## Context

The bridge needs an HTTP API and a message store. The obvious picks are a framework (express/hono) and better-sqlite3. Every runtime dependency widens the supply-chain surface and the CI matrix (native builds, prebuilds per platform).

## Decision

The bridge has zero runtime dependencies beyond the engine: `node:http` for the server, `node:sqlite` (`DatabaseSync`) for the store, `node:crypto` for constant-time token comparison. MCP SDK rejected too (see 0005). pino is the one runtime dep (structured logs); qrcode serves pairing.

## Consequences

- `pnpm audit --prod` covers a tiny tree (the first audit run's only HIGHs were in pnpm itself — fixed by pin bump).
- No native builds: CI runs on windows/macos/linux without compilers.
- Routing/validation is hand-rolled; kept small and covered by the http contract tests.
- node:sqlite requires node >=22.5 — the runtime floor is documented (GOAL says >=20; sqlite-touching code needs 22.5+, enforced by the dev toolchain).
