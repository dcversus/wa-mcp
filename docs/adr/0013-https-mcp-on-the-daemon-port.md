# ADR 0013: HTTPS MCP on the daemon's port

Date: 2026-11-06
Status: Accepted
Issue: #259

## Context

Every host ran `node …/mcp-server/dist/bin.mjs`, a process whose only job is to
relay JSON-RPC to the daemon that is already running and already serves `/mcp`.
Each host session cost a Node process and a config entry holding an absolute
path that broke when the install moved.

## Decisions

### One port for TLS and plain HTTP

The first byte of a connection selects the protocol: `0x16` starts a TLS
handshake, anything else is HTTP. A second port would mean a second address to
configure, forward and document. Keeping plain HTTP means the web UI, the CLI,
container health checks and every existing stdio entry keep working on upgrade.

### A self-signed leaf, not a local CA

The certificate is `CA:FALSE`, covers `localhost`, `127.0.0.1` and `::1`, and is
its own trust anchor. There is no CA key on disk, so trusting the file can only
ever authenticate this one certificate. A CA key would let anything that read
it mint certificates for any name.

Name-constrained CAs were tried first and rejected: Claude Code 2.1.318 refuses
an IP name constraint (`UNSUPPORTED_CONSTRAINT_TYPE`). A plain CA and a
self-signed leaf both connected.

### The certificate is assembled by hand

Node can read X.509 but not write it. Shelling out to `openssl` fails on a stock
Windows machine, and a library would be the bridge core's first dependency for
this (ADR 0002). `shared/src/tls-cert.ts` is about 60 lines of DER, checked
against `X509Certificate`, a real TLS handshake, `openssl verify` and Claude Code.

### What TLS does and doesn't add here

The daemon binds to loopback, so TLS protects nothing on the network. Anything
running as this user can read the token and the key (see the trust boundary in
[Security](../security.md)). It is here because hosts increasingly expect
`https://` for remote servers and the address should be the same everywhere. The
controls that matter are still the bearer token and the Host/Origin guard.

### Where a process stays

- **Claude Desktop.** `claude_desktop_config.json` only accepts `command` entries.
- **Claude Code channels.** The channels reference requires a stdio subprocess.
  The plugin keeps `wa-mcp mcp`. `subscribe_events(channel: true)` over HTTP is
  refused, because those events would otherwise be dropped with no error.
- **Grok.** Its documented config is `~/.grok/config.toml`, not the
  `~/.grok/mcp.json` we write. Moving it is separate work; until then it stays on
  stdio.

### https by default only where install can set up trust

Claude Code honours `NODE_EXTRA_CA_CERTS` from `~/.claude/settings.json`, so
install can make https work on its own. Codex and Node-based hosts read their CA
from the environment of the shell that starts them, which no config write can
reach. Defaulting those to https would leave them unable to connect, so they get
`http://` on loopback unless the user passes `--https` after exporting the
variable. install never overwrites an existing `NODE_EXTRA_CA_CERTS`: that value
holds one path, and replacing it would break whatever it was for.

### Protocol traffic isn't rate limited for a valid token

A tool call over `/mcp` relays to the API and is charged there. Charging the
`POST /mcp` as well would double the cost of every call compared with stdio.

## Consequences

- The bearer token stays in the host's config file, as it did in stdio `args`.
- A daemon running across a certificate renewal keeps serving the old one until
  restarted. The certificate lasts 825 days and renews at boot within 30 days of
  expiry.
- `WA_TLS=0` removes TLS; hosts on `https://` then fail until `wa-mcp install` is
  re-run with the variable set.
