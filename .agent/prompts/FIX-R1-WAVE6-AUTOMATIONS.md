# TASK: FIX WAVE R1-6 — Automations page (TDD, no commit)

Read first: review/AUDIT-R1-D2.md findings #7 (Automations) and #9
(notification rules). This page is the owner's SAFETY WINDOW onto the
agent — "what will be sent in my name?" Read-only + delete/pause only;
creation stays MCP/agent-side this wave.

TDD everything; vp check 0; suite green; zero comments; no commit.

## B1. Bridge: GET /api/autoreply + DELETE /api/autoreply/:id
- Autoreply rules today live in the store only (autoreply_set tool).
  Expose: GET lists all active rules (chat target, pattern, text,
  enabled, created); DELETE removes one by id (reuse the store's
  existing rule ids; if autoreply rules lack ids, add a stable
  rowid-based id without migrating the schema — read the store first).
- RED: GET returns seeded rules as JSON; DELETE removes exactly that
  rule; auth required; unknown id → 404.

## B2. Web UI: "Automations" page under the Agent nav group
Route #/automations, nav entry after "Agent alerts". Sections (each
with human copy, displayName for chats, empty states per D3 style):
1. **Autoreplies** — "Replies sent automatically by your agent": chat,
   pattern, reply text, toggle pause/resume (if the store supports
   enabled), delete.
2. **Scheduled messages** — GET /api/scheduled (exists): recipient
   displayName, text snippet, when (relative + absolute), status
   (pending/failed), delete (DELETE exists? check; add if missing).
3. **Send rules** — GET /api/send-rules (exists): chat, pattern/limit,
   delete.
4. **Notification rules** — MOVED from Status (finding 9): create form
   (chat picker + pattern + channels) using POST /api/notifications,
   list + delete (exists). Status page keeps a link stub → #/automations.
- api.ts gains: listAutoreplies, deleteAutoreply, listScheduled,
  deleteScheduled (if endpoint needed), listSendRules, deleteSendRule,
  listNotificationRules, createNotificationRule, deleteNotificationRule.
- RED: render assertions per section (fixture data → key strings,
  displayName shown, empty states); router test for #/automations +
  Status no longer rendering rulesSection.

## B3. Consistency
Same list styling, .danger on deletes, confirm on destructive, h1
"Automations", document.title, aria-labels, focus states — match wave-4
standards.

Report: per-B summary, RED→GREEN list, gates, endpoint inventory
(what existed vs added), deviations.
