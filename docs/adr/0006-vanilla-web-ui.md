# 0006 — Vanilla web UI

## Status

Accepted

## Context

GOAL §16 asks for a web UI: pairing, chats, chat detail with send, unread inbox, settings, health. The zero-dep philosophy applies here too; a framework would add a runtime dependency for rendering six pages.

## Decision

Vanilla TypeScript SPA: hash router, settings in localStorage, pure HTML-string page builders (node-testable without jsdom), thin DOM mount. Built with `vp build` (vite through the vite-plus toolchain — no new packages; the catalog alias approach was blocked by the security classifier and is unnecessary). Served unauthenticated from the bridge as shell + assets; all API calls bearer-authed.

## Consequences

- Page logic is covered by node tests (string builders); the mount layer is innerHTML assignments (no jsdom at this scope).
- Hash routing keeps the server surface to `/` + `/assets/*` with containment guards.
- No reactive bindings: pages re-fetch on navigation.
