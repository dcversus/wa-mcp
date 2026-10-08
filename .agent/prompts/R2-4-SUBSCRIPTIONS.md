# TASK: R2-4 — Subscriptions page rebuild on the subs2 model (TDD, no commit)

## Canon (owner spec, verbatim requirements)
docs/raw/2026-10-07-webui-r2-restructure.md:
"Subscriptions - list of created subscriptions, each subscription
include: chats - with checkbox, some message filter (with %like%) +
some flag to react ONLY when bot itself mentioned in message) + prompt
with which incoming message should be triggered, option to put message
in ANY active session OR specific session from list OR create a new
agent with params (and config with CLI path and params) each time with
clean context OR events could be delivered into inbox.jsonl with some
help to use subscription command - list this options, provide more
configuration here"

## Context — verified
- /api/subs2 CRUD EXISTS (R2-1): SubscriptionConfig {id, name, chats[],
  filter:{like?, mentionOnly?}, prompt?, delivery:{mode: inbox|session|
  spawn, session?, agent?:{command, args?, env?}}, enabled, created}.
- The DISPATCHER still runs on the v1 model (kinds[] + inbox only).
  This wave wires dispatch to subs2 configs (filter matching + prompt
  stamping + delivery routing).
- Active sessions: claude-code sessions live in ~/.claude/projects/
  (session .jsonl files, newest = active); codex in ~/.codex/sessions.
  Enumerate for the "specific session" picker.
- inbox.jsonl delivery: append (existing); spawn: run command with env
  WAMCP_EVENT (JSON) — fire-and-forget, capture exit to log.

## Part A — bridge: GET /api/sessions (for the session picker)
Enumerate agent CLI sessions: for claude-code + codex, list recent
session files → [{id, agent, label (project dir + mtime), mtime,
size}]. No content, no secrets. RED: fixture dirs → session list,
newest first; empty dir → [].

## Part B — dispatcher on subs2 (the core)
On inbound message (post fromMe skip + @lid canonicalization):
1. Load subs2 configs (cached, refresh on CRUD).
2. Match: chat in config.chats (OR canonical lid/pn equivalent) AND
   (filter.like absent OR content LIKE pattern — translate %like%
   SQL-style to JS match, case-insensitive) AND (mentionOnly false OR
   mentionedJids includes our own jid).
3. Delivery: inbox → appendEvent {kind:"message", ts, chat, chatName,
   from, fromName, id, text, media, subId}; session → append to a
   per-sub spool + touch the session (document: full session-poke
   needs the agent's hook; spool file is the contract) ; spawn →
   child_process.spawn(agent.command, agent.args, {env: {...process.env,
   WAMCP_EVENT: JSON.stringify(event), WAMCP_SUB: id}}), detached,
   stdio ignore, log failures to bridge.log.
4. prompt: stamped into the event as `prompt` field.
- RED: filter like-match table (%, _, case, unicode); mentionOnly gate;
  session spool write; spawn called with right env (injectable spawnFn);
  no-match → nothing; disabled config → skipped.

## Part C — Subscriptions page rebuild (#/subscriptions)
List view: each subscription = card with name, chats (displayName
chips), filter badge ("~ %pattern%" / "mentions only"), delivery badge
(Inbox / Session: <label> / Spawn: <cmd>), enabled toggle, Edit,
Delete (confirm). "New subscription" wizard/form:
1. Name + chats (multi checkbox picker, groups first, search).
2. Filter: like input (with % hint + live regex preview?) +
   mention-only checkbox.
3. Prompt textarea ("System prompt your agent receives with the
   event").
4. Delivery radio: Inbox file (shows path + drain command with Copy) /
   Active session (select from /api/sessions) / New agent each time
   (command + args + env rows). All three listed with one-line help
   per the owner's "list this options" requirement.
5. Save → POST /api/subs2; edit → PATCH.
- RED: render tests for list + form (fixture configs); interaction
  covered by pure-form tests as established.

## Part D — CLI
wa-mcp subs list|create|edit|delete with flags (--chat multi,
--like, --mention-only, --prompt, --delivery inbox|session|spawn,
--session, --command, --arg multi, --env multi). RED: arg parsing +
API call shape tests.

## Part E — v1 migration
On boot, if legacy subscriptions exist and no subs2 rows: migrate each
v1 sub (chats, kinds=["message"]) into a subs2 config (name="Imported
<id-slice>", delivery inbox, enabled true). Keep v1 endpoints working
(read-only deprecation: GET works, POST returns 410 with pointer).
- RED: migration test (seeded v1 → subs2 rows appear once, idempotent);
  410 on v1 POST.

Report: per-part summary, RED→GREEN list, delivery-matrix table, gates.
