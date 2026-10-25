# Development

Toolchain: [Vite+](https://viteplus.dev) (`vp`) over a pnpm workspace. Node ≥ 26; the pinned pnpm is auto-managed via `packageManager`.

```sh
pnpm install
pnpm run ready        # vp check && vp test && vp run -r build
vp run docs:gen       # regenerate docs/reference/tools.md from the registry
vp run docs:coverage  # assert every registry tool is documented
vp run accounting:check  # assert ACCOUNTING.md covers the 1,029-item census
```

## Layout

| package               | role                                                                      |
| --------------------- | ------------------------------------------------------------------------- |
| `packages/bridge`     | Baileys daemon: session, event bus, HTTP API, store, media, MCP-over-HTTP |
| `packages/mcp-server` | zero-dep JSON-RPC MCP server (stdio + registry), resources                |
| `packages/cli`        | `wa-mcp` bin: install/doctor/status/start/stop, skills install            |
| `packages/web-ui`     | vanilla SPA (hash router) served by the bridge                            |
| `packages/shared`     | shared types + jid utilities                                              |

## Conventions

- TDD: failing test first, RED evidence in the test commit message.
- Conventional commits; one logical change per commit; `vp check && vp test` green on every commit.
- Engine truth from installed type definitions and runtime probes — never assumptions (see `docs/adr/0001`).
- Scope changes go through `review/BACKLOG-FULL.md` → ACCOUNTING dispositions, not ad-hoc features.
