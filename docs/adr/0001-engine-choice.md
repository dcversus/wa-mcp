# 0001 — Engine choice: Baileys over Whatsmeow

## Status

Accepted

## Context

wa-mcp needs a WhatsApp engine. The two reference implementations are Baileys (`@whiskeysockets/baileys`, TypeScript, multidevice) and Whatsmeow (Go). The source ecosystem is python/Go (`whatsapp-mcp`, forks); our target is a 100% TypeScript Vite+ monorepo.

## Decision

Use `@whiskeysockets/baileys` (pinned 7.0.0-rc14). Engine truth comes from its installed type definitions and runtime probes, never from assumptions (recorded per task in VERIFY.md).

## Consequences

- One language end to end; no CGO, no sidecar process.
- Engine quirks are ours to absorb: protocol enums, event names (`group-participants.update`), `fromObject` null semantics, `pollCreationMessageV3` are probed and documented rather than assumed.
- Pin upgrades require re-running the probe suite (events, media, groups).
