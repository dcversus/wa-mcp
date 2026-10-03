# Security Policy

## Supported version

`wa-mcp@0.9.0` (the current main branch). Only the latest release receives
security fixes.

## Reporting a vulnerability

Use GitHub's **private security advisory** for this repository — do NOT open a
public issue. Include: affected component (bridge/http, MCP server, CLI, web
UI), reproduction steps, and impact. You will get a response within 7 days.

## Scope

In scope: the bridge HTTP surface (`/api/*`, `/health`, `/events`, `/mcp`,
`/webhooks/*`), the MCP stdio/HTTP transports, the CLI (`wa-mcp`), the web UI,
and the store/media files under `~/.wa-mcp/`.
Out of scope: WhatsApp server-side behavior, the Baileys protocol itself, and
anything requiring a non-loopback daemon the operator deliberately exposed.

## Security model (summary)

The full model is documented in [docs/security.md](docs/security.md) and ADRs
0004 (security model) + 0010 (no-publish). The shipped mechanics:

- **Loopback by default** — the bridge binds `127.0.0.1`; `WA_BIND_HOST`
  widening is an explicit operator choice.
- **Bearer token on every endpoint** — generated on first start, stored 0600,
  constant-time comparison. `GET /health` is the only public endpoint.
- **Ephemeral pairing/UI token** — per-boot, published by `/health`, scoped to
  the pairing surface + reads; never authorizes destructive/config mutations.
- **Rate limits + body cap** — token-bucket per IP, 1 MB request cap → 413.
- **Media path confinement** — lexical + realpath containment; ids sanitized
  to `[A-Za-z0-9_-]`.
- **Kill switch** — `WA_SENDS_DISABLED=1` 403s every send before the socket
  is touched; pacing + persistent daily cap on top.
- **Structured errors** — fixed `{error:{code,message}}` vocabulary, no stack
  traces over the wire.
- **CI** — `pnpm audit --prod --audit-level high`, gitleaks over history, and
  a no-publish grep guard.
