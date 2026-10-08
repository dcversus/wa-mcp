# TASK: R2-7 — Chats page removal + seamless contacts (TDD, no commit)

## Canon (owner, verbatim, 2026-10-08)
> chats page have no sense, list of chats needed only for subscriptions

> Changes sync to your WhatsApp account, like WhatsApp Web. -> this LOOKS
> VERY STRANGE. can we sync in background 1:1 like whatsApp doing it? it
> should be seamless, without separate action

## Part A — delete the Chats page
The chat LIST as a standalone page goes away. A chat list exists ONLY
inside the subscriptions picker (chat checkboxes). Chat DETAIL
(#/chat/<jid>) stays — reachable from Contacts rows and Logs rows
(verify both link there; add a link from Logs rows if missing).
1. router.ts: `#/chats` → redirect to `#/contacts` (or `#/help`; pick
   contacts — closest replacement for "find a conversation"); remove
   chats-list route kind; keep chat-view.
2. Delete chats.ts list rendering, its loader, bindings, unread-tab
   filters, CSS orphans (grep classes before deleting).
3. Nav: MESSAGES group — remove Chats entry; group now holds Logs
   only. Consider renaming group or folding Logs into top level —
   keep MESSAGES/Logs as-is if simpler, note the choice.
4. e2e script (scripts/webui-e2e.mjs) walks chats → it must be
   updated: enter via Contacts → open chat → send → bubble. Keep it
   green.
5. Docs: page lists mentioning Chats (README, docs/getting-started,
   desktop guide, help.ts) updated.
- RED: router test (#/chats redirects, chat-view resolves); nav test;
  removed-code grep assertions (no "chats-page"/chatsListHtml in src);
  e2e updated + green.

## Part B — seamless contacts (no visible sync machinery)
Sync IS already background: contacts.upsert listener enriches + stores,
boot-time backfill, addOrEditContact on write. The problem is the UI
*describing* it as an action:
1. contacts.ts:84 hint "Changes sync to your WhatsApp account, like
   WhatsApp Web" → DELETE the whole hint line. The form submits →
   shows plain "Saved" (and errors on failure). No mention of sync.
2. REMOVE the "Sync" button (#contacts-sync) + contactsSyncSummary UI
   + main.ts binding + api.ts syncContacts method (keep the BACKEND
   /api/contacts/sync endpoint — boot + CLI use it; only the UI
   surface goes).
3. contacts.ts empty state "They appear once..." → keep but ensure it
   reads as automatic ("Contacts appear automatically as you chat" —
   no action implied).
4. help.ts:20 Contacts section — rewrite: names/edits behave exactly
   like WhatsApp Web; no sync paragraph.
- RED: render tests updated (no sync button, no sync-copy, "Saved"
  confirmation present); removed-code assertions; existing contacts
  tests adjusted.

## Part C — logs → chat links
Ensure each Logs row links to #/chat/<jid> (chat detail) so the
message history is reachable without the Chats page. If links already
exist, add the test pin.

Report: per-part summary, RED→GREEN list, what replaced the chats
entry points, gates.
