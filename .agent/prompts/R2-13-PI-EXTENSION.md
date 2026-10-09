# TASK: R2-13 — wa-mcp-pi extension: pi sessions react to WhatsApp (TDD, no commit)

## Owner need (verbatim)
> how to install hooks for pi? do we have one? i need option to
> subscribe my pi session to chat and react to incoming messages

Approved plan (canon): pi extension that tails the session spool and
injects events into the live pi session via sendUserMessage.

## Verified facts (use these, do not re-derive)
- pi = @earendil-works/pi-coding-agent; extension API at
  ~/.nvm/versions/node/v22.16.0/lib/node_modules/@earendil-works/pi-coding-agent/dist/core/extensions/types.d.ts
- pi.on("session_start", handler); SessionStartEvent { type, reason,
  previousSessionFile? }
- ExtensionAPI has sendUserMessage(content: string | (TextContent |
  ImageContent)[], options?: { deliverAs?: "steer" | "followUp" }) —
  injects user input into the live session; async, callable any time
- Extension factory shape (working example on this machine):
  ~/.nvm/versions/node/v22.16.0/lib/node_modules/pi-mcp-extension/src/index.ts
  — `export default async function (pi: ExtensionAPI, paths?) {}`
- pi loads packages listed in ~/.pi/agent/settings.json `packages`
  array (currently has pi-mcp-extension, relative path form)
- Our subscription session-mode spools events to
  ~/.wa-mcp/subs/<subId>/session.jsonl (one JSON line per event,
  fields: see packages/bridge/src/inbox.ts InboxEvent) — bridge
  appends on matching inbound message; fromMe already skipped
- pi sessions live under ~/.pi/agent/sessions/<cwd-slug>/<file> (we
  must NOT enumerate for v1; single-session injection is enough)

## Build
1. New workspace package `packages/pi-extension` (name:
   @wa-mcp/pi-extension, "type": "module"):
   - src/index.ts: default factory(pi): on session_start, locate the
     wa-mcp subscriptions dir (~/.wa-mcp/subs, override via
     WA_MCP_HOME env), fs.watch each sub dir + poll fallback (500ms),
     tail session.jsonl, for each new line call
     pi.sendUserMessage(render(event), { deliverAs: "followUp" })
   - render(event): compact prompt like:
     "[wa-mcp] message from {chatName ?? chatJid}: {text} — your
     subscription asked you to react" (no secrets, no token)
   - Deduplicate by line offset per spool; ignore files without
     session.jsonl; never crash the session on errors (log to stderr
     once, continue)
   - package.json keywords: pi-package, pi-extension (match
     pi-mcp-extension convention)
   - Build to dist/ with the repo toolchain (vite-plus, tsc)
2. CLI installer: `wa-mcp install --target pi` additionally ensures
   the extension is importable by pi:
   - copy/symlink packages/pi-extension/dist into
     ~/.wa-mcp/pi-extension-dist (self-contained, no node_modules
     deps — use only node builtins)
   - append the absolute path to ~/.pi/agent/settings.json packages
     (preserve existing entries; idempotent; backup file first, same
     .bak-timestamp convention as hooks.ts)
   - uninstall removes the entry + dist copy
   - `wa-mcp install --target pi --dry-run` output mentions it
3. Tests (RED first):
   - extension unit test with a fake pi (record sendUserMessage
     calls): append 2 lines to a fake spool → 2 injections with
     rendered text; malformed line → skipped, no throw
   - installer test: settings.json gains entry, idempotent re-run,
     uninstall cleans; backup created
4. Gates: vp test full green; vp check 0. Do not commit.

## Constraints
- Zero runtime deps in the extension (node builtins only)
- No comments in source
- Never read/emit ~/.wa-mcp/token in the extension
- Careful mode: no live WhatsApp sends in tests

## Report
Files, RED→GREEN list, how injection renders, gates output.
