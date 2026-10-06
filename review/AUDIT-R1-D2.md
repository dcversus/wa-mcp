# AUDIT R1 — D2 Product flow & information architecture (independent, read-only)

Auditor: opus (fresh eyes) · Date: 2026-10-06 · Repo HEAD `b73508b` (no
uncommitted source changes when audited; the D1 fix wave had not landed).

## Method and evidence base (read first)

- **This dimension is a source-level audit.** The session's permission
  sandbox denied every live channel: `curl http://127.0.0.1:8080`, writing
  probe scripts to `/tmp`, reading `~/.wa-mcp/*`, reading D1's
  `/tmp/audit-d1/*` dumps, the `wa-mcp` MCP tools (`list_chats`,
  `list_notification_rules`, …) and web search all came back "requires
  approval" in this non-interactive run. As a result:
  - **No browser probes, screenshots, or live sends were made.** Nothing was
    written to the account and nothing was sent to the Test group.
  - Every finding rests on `file:line` evidence, and every finding is marked
    either *(code-path)* (reasoned from source, high confidence where noted) or
    *(D1-live)* (already measured live in `review/AUDIT-R1-D1.md`).
  - Findings 1–3 (hero path) are high-confidence code-path findings that
    **must be confirmed live** before fixing. I list the exact repro for each.
- Read: `packages/web-ui/src/{app,router,main,pages,pages-pairing,state,api}.ts`,
  `packages/bridge/src/{http,inbox,subscriptions,notifications,mcp-notify,events,lifecycle}.ts`
  (relevant ranges), `packages/cli/src/{bin,hooks,subscribe}.ts`,
  `packages/mcp-server/src/tools.ts` (tool names), `docs/cookbook/react-to-messages.md`,
  `docs/diagnostics.md`, and the subscription tests (`t107`, `t116`).
- D1 overlap is noted as "(D1 #n)" and not re-argued.

---

## VERDICT

The web UI is a set of thin CRUD panels over a powerful API. It is not yet
a product shaped around the job the product exists for. The hero flow ("let
my agent react to a chat") is broken at **every** stage once you leave the
UI, not only at the hook snippet D1 found:

- The UI shows a low-level drain command instead of the real wiring command
  (`wa-mcp install --hooks claude --sub <id>`).
- That installer keeps only **one** subscription's hook, while the UI
  encourages one subscription per ticked chat.
- Most seriously, the bridge's dispatcher **drops every live incoming
  message** (`type === "notify"`) and only writes backlog and the owner's own
  sent messages (`append`) to inboxes. That means an agent wired up perfectly
  would be woken by its own replies and never by the other person *(code-path,
  high confidence; the tests pin the wrong type)*.
- Nothing in the UI lets a user verify delivery.

Around that, the IA has three diagnostics pages (two orphaned), notification
rules hidden on Status under the heading "pairing rules", Unread and Groups
duplicating Chats, and no cross-links (contact → chat, chat → subscription).
Groups and media controls are partly cosmetic: participant add/remove/promote
are no-ops, there is no transcribe button, and "download" always says ✓.

The everyday "read and send" persona is served only by Chats. After the D1
routing fix it will work for existing chats, but you still can't start a new
chat, search messages, reply properly, or send media.

About 45 of the 74 MCP capabilities have no UI presence. That is a defensible
boundary *except* for automations that act on the owner's behalf (autoreply,
scheduled sends, send-rules). Those are invisible to the owner today, and
that is a trust problem.

---

## FINDINGS (sorted by severity)

Format: **[severity · label · effort]** title, then evidence, analysis and fix.

### P0 — the product's reason to exist does not work

#### 1. [P0 · DEFECT · S] Subscriptions drop every live incoming message; only backlog and own sends reach the inbox *(code-path, high confidence; confirm live)*
- **Evidence:** `packages/bridge/src/http.ts:497`:
  `if (event.type !== "messages.upsert" || event.payload.type === "notify") { return; }`.
  In Baileys, `notify` is the real-time inbound type. The bridge itself
  treats it that way elsewhere: autoreply fires only on
  `upsert.type === "notify"` (`lifecycle.ts:634`), and the comment at
  `lifecycle.ts:565` says "notify (real-time) and append (post-reconnect
  backlog)". So the dispatcher keeps only `append`, which is the
  post-reconnect backlog **and the messages this socket sends itself**.
  Notification rules are evaluated behind the same early return
  (`http.ts:500`), so rules with `deliver: file/ui` are also silent for live
  traffic. The tests pin the inverted behavior: `t107-subscriptions-http.test.ts:199`
  and `t116-deliver.test.ts:15` only ever emit `type: "append"`.
- **Compounding:** there is no `fromMe` filter in the dispatch loop
  (`http.ts:525-556`). When an agent replies with `send_message`, its own
  message (an `append` upsert) lands in the inbox and wakes the agent again,
  which creates a self-trigger loop. The live messages from the other person
  never arrive.
- **Live repro to confirm:** subscribe the Test group, have a *second* phone
  send "ping" into it, and `wc -l ~/.wa-mcp/subs/<id>/inbox.jsonl`. I expect
  no new line. Then send from the UI and I expect a new line with the owner's
  own text. D1 saw a 175-byte inbox (exactly one event), which is consistent
  with this.
- **Fix:** invert the guard so it accepts `notify` (and `append` only when
  `!fromMe` and the message is newer than the subscription's `createdAt`).
  Skip `key.fromMe === true` by default, with an opt-in `include_own`. Add a
  RED test that emits `type: "notify"` from a non-own JID and asserts that one
  inbox line is written, plus one that asserts a `fromMe` append writes
  nothing.

#### 2. [P0 · PRODUCT+DEFECT · S] The UI's per-chat subscription model and the hook installer contradict each other: only the last chat is ever watched
- **Evidence:** the picker creates **one subscription (and one inbox file)
  per ticked chat** (`main.ts:1087-1092`; `subscriptions.ts:36-58` creates
  `subs/<id>/inbox.jsonl` per subscription). The real wiring command,
  `wa-mcp install --hooks claude --sub <id>` (`bin.ts:121-150`), calls
  `mergeHooks`. That function first **removes every existing wa-mcp entry**
  (`hooks.ts:51-66`, `kept = … filter(!isOurs)`, where `isOurs` matches any
  `wa-mcp inbox drain` command) and then adds the new one. If a user ticks 3
  chats and runs the installer 3 times, only the third chat is wired. Nothing
  warns them.
- **Analysis:** the UI teaches "tick the chats your agent should watch",
  which is the right mental model (D1 credited it). The plumbing supports
  "one inbox per hook file". A user who does everything right gets an agent
  that silently ignores 2 of 3 chats.
- **Fix:** choose one model. Recommended: **one inbox per agent target**. A
  subscription becomes a *set* of chats (the server already supports
  `all_chats` + filter; add `chat_jids[]`). The picker edits that set, so a
  single `install --hooks` stays valid as chats are added or removed. If you
  keep per-chat subscriptions, `mergeHooks` must key entries by sub id
  (`--sub` appends, `--remove --sub` removes one), and the UI must show which
  subscriptions are wired.

#### 3. [P0 · PRODUCT · M] The hero path is not teachable: the UI stops at a raw drain command and never shows the step that wires an agent
- **Evidence:** the Subscriptions row shows only
  `wa-mcp inbox drain --inbox <path>` plus a copy button (`pages.ts:485-501`),
  and the path is wrong (D1 #5). The command that actually connects Claude
  Code or Codex, `wa-mcp install --hooks claude|codex --sub <id>`, exists
  (`bin.ts:121`) and is documented (`docs/cookbook/react-to-messages.md:14-40`),
  but it appears nowhere in the UI. A grep of `pages.ts` for `install`,
  `hooks`, `agent`, `claude` and `mcp` finds no copy (D1 #4 for the general
  agent-connect step).
- **Walk of the full path, with where a user gets lost:**

  | Step | What the user needs | What exists | Lost? |
  |---|---|---|---|
  | 1. Find the feature | "Let your agent watch chats" | Nav: "automations → Subscriptions" | Probably. "Subscriptions" reads like newsletters |
  | 2. Pick chats | Names, checkbox | Picker works; **`@lid` chats are silently excluded** (`main.ts:472`) | Yes, for 1:1 chats keyed by LID |
  | 3. Get wiring command | "Run this once: `wa-mcp install --hooks claude --sub X`" | Only the drain command, with a wrong path | **Yes** |
  | 4. Understand where events land | "Events are appended to `~/.wa-mcp/subs/X/inbox.jsonl`; your agent is woken" | A path label with no explanation | Yes |
  | 5. Wire into the agent | Hook installed for each chat | Installer keeps one sub (finding 2); the hook shape is unverified (finding 5) | Yes |
  | 6. Verify delivery | "Send a test event", "last event 2 min ago", "N pending" | Nothing. `/health` has only `subscriptions {count, dropped}` | **Yes** |
  | 7. Agent acts on event | Message id and sender name, to reply or react | The inbox line has `{ts,kind,chat,from,text,media}` with no message id and no name (`inbox.ts:4-11`) | Partly (finding 6) |

- **Fix:** turn Subscriptions into an **"Agent inbox"** page with a 3-step
  wizard: ① pick chats → ② pick an agent (Claude Code / Codex / generic
  `tail -F`) and show the exact one-line install command with copy, plus a
  "wired ✓" status (the CLI can write a marker the bridge reads, or the
  bridge can inspect `~/.claude/settings.json` for its own marker) → ③
  **"Send test event"** (the bridge appends a synthetic `kind:"test"` line)
  with a "last delivered / pending / dropped" readout per inbox.

### P1 — broken or misleading secondary flows

#### 4. [P1 · DEFECT · S] Even once the routing fix lands, reply posts the raw message id into the chat
- **Evidence:** `main.ts:583`:
  `client.sendMessage(chatJid, replyToId !== null ? `> ${replyToId}\n${text}` : text)`.
  The bridge already supports real quoted replies (`reply_to_message_id`,
  `http.ts:787, 844-860`), but the client never sends it
  (`api.ts:153` posts only `{chat_jid, text}`). The click-to-reply binding is
  dead today (D1 #6). The D1 routing fix revives it, after which the next
  reply sends `> 3EB0C4…\nhello` to the real contact.
- **Fix (before or together with the D1 routing fix):** pass
  `reply_to_message_id`, show a quoted preview above the composer with a ✕,
  and never put the id in the text.

#### 5. [P1 · DEFECT · S] The Claude Code hook shape and drain output are unverified against the host; the drain output gives the agent almost nothing to act on *(code-path; host schema not checked, since web access was denied)*
- **Evidence:** `renderClaudeHooks` writes `asyncRewake` as a **hook event
  key** next to `FileChanged` (`hooks.ts:18-33`). The docs describe it as "an
  `asyncRewake` command hook" (`react-to-messages.md:20`). My understanding is
  that in Claude Code, async/rewake are per-hook *options*, not event names. If
  so, that entry is ignored, or invalidates the settings file. `drainInbox`
  prints its summary with `console.log` (stdout, `bin.ts:304`) and exits 2.
  Claude Code feeds *stderr* to the model on exit 2. The summary contains only
  the **first** event's 60-character snippet plus a count
  (`subscribe.ts:96-130`), and the cursor advances past all of them.
- **Fix:** verify against the current Claude Code hooks reference and pin the
  shape in a test fixture taken from a real `settings.json`. Write the
  summary to stderr when exiting 2. Emit one line per event (capped), with
  chat name, sender, message id, and a hint ("use list_messages chat_jid=…
  to read more").

#### 6. [P1 · PRODUCT · S] Inbox events can't be acted on directly: no message id, no names, raw LID JIDs, and a mismatch between LID and canonical JIDs *(code-path)*
- **Evidence:** `InboxEvent = {ts, kind, chat, from, text, media}`
  (`inbox.ts:4-11`). The dispatcher uses raw `upsert.key.remoteJid` and
  `participant` (`http.ts:526-527`), but the store canonicalizes `@lid` to the
  phone JID (`lifecycle.ts:569-573`), and the picker only offers non-`@lid`
  JIDs (`main.ts:472`). For a 1:1 chat whose live traffic arrives as `@lid`,
  `matchSubscription` compares `…@lid` with `…@s.whatsapp.net` and never
  matches (`subscriptions.ts:88`).
- **Analysis:** to react (`send_reaction`) or quote-reply, the agent needs
  the message id, so today it has to re-query. A "who said it" summary needs a
  name. The JID mismatch is a second silent-drop path, on top of finding 1.
- **Fix:** canonicalize before matching (reuse `canonicalChatJid`), and add
  `id`, `chatName` and `senderName` to the event line.

#### 7. [P1 · PRODUCT · M] Automations that act on the owner's behalf are invisible in the UI
- **Evidence:** autoreply (`autoreply_set`), scheduled messages
  (`schedule_message`, `/api/scheduled` `http.ts:3719-3796`), send-rules /
  `restrict_sending` (`/api/send-rules` `http.ts:3605-3667`), and templates
  have **no UI presence**. `api.ts` has no client method for any of them.
  Autoreply has no HTTP endpoint at all (grep `autoreply` in `http.ts`: 0
  hits), so the owner cannot even list active autoreplies without an agent.
- **Analysis:** an agent can set "reply to everyone in chat X with Y" or queue
  20 scheduled sends, and the owner's control panel never shows it. For a
  bridge that speaks as the owner on WhatsApp, "what will be sent in my
  name?" is the most important read-only view after the chat list. It also
  matters for safety: the UI is where a human would notice a runaway agent.
- **Fix:** add one **"Automations"** page that lists (read-only, plus
  delete/pause) autoreplies, scheduled messages (pending/failed), send rules,
  notification rules (moved from Status, finding 9), and agent inboxes. Add
  `GET/DELETE /api/autoreply`. Creation can stay MCP-only at first.

#### 8. [P1 · DEFECT · S] Group management controls are cosmetic
- **Evidence:** the participant "remove" and "promote" buttons are bound to
  `() => undefined` (`main.ts:699-704`). "add" calls
  `client.groupParticipants(groupJid)`, which posts `{group_jid}` with **no
  participant and no action** (`main.ts:695`, `api.ts:181`), so it either
  fails validation or does nothing. The rejection is swallowed by
  `.catch(() => undefined)` and the input is cleared, so it looks like
  success. Create, leave, meta and alias also swallow errors
  (`main.ts:629, 643, 651, 913`). Opening the participant panel needs a click
  on the row padding, outside the link and button (`main.ts:658`), so it is
  undiscoverable.
- **Fix:** wire add/remove/promote to `/api/group/participants` with
  `{participants:[…], action}`, show inline errors (reuse `chatErrorHtml`),
  and confirm destructive actions. Better (IA, finding 10): move group admin
  into the group's chat header as an "info" panel, the way WhatsApp does.

#### 9. [P1 · PRODUCT · S] Notification rules live on the Status page under the heading "pairing rules", and can only be deleted
- **Evidence:** `pages.ts:111-123` renders rules under `<h3>pairing rules</h3>`
  on the Status page (the heading is D1 #12). The only control is delete
  (`main.ts:786-794`). There is no create form, although
  `POST /api/notifications` exists (`http.ts:3595`). Rules show `chat_jid`
  raw, or `*`.
- **Fix:** move rules to Automations (finding 7) with a create form
  (chat picker + pattern + deliver channels) and human chat names.

#### 10. [P1 · PRODUCT · M] Core "read and send" jobs have gaps beyond D1's routing bug
- **No message search anywhere.** `api.ts:24` has `search()`, but
  `main.ts` never calls it. The Chats search box is labelled "search messages"
  (`pages.ts:168, 183`), yet even after the D1 fix the `chats` loader ignores
  the query (`main.ts:401-404`; D1 #7). `search_messages` (FTS) is one of the
  strongest MCP tools.
- **Can't start a new chat.** There is no "new message" or "message this
  contact" action. Contacts rows have only "set alias" (`pages.ts:130`), so
  you can only send to chats that already exist in the store.
- **Text only.** There is no attach, voice note, or reaction UI, though the
  bridge has `send_media`, `send_voice_note` and `send_reaction`.
- **After every send, media in the open chat breaks.** The re-render calls
  `messageListHtml(chatJid, payload.messages)` **without `mediaToken`**
  (`main.ts:592`), so every image, video or audio `src` loses `?token=` and
  401s. It also skips `bindChatExtras`, so context/download die after the
  first send.
- **Fix:** a global search page (or a top bar) backed by `/api/search` with
  results linking to `#/chat/<jid>` and the message highlighted. Add a "New
  chat" button (phone number → `#/chat/<jid>`), make contact rows link to
  their chat, pass `mediaToken` and re-bind after send, and add attach
  (`send_media`) as the first media action.

#### 11. [P1 · DEFECT · S] Voice-note transcription and "download" are dead or misleading in the chat view
- **Evidence:** `bindChatExtras` binds `.transcribe-btn` (`main.ts:892-904`),
  but no page ever renders that class. `pages.ts:237` renders an empty
  `<span class="transcript">` and no button. "download" posts to
  `/api/media/<id>` (a server-side download into the store) and then sets the
  label to "downloaded ✓" **whether or not it succeeded**
  (`main.ts:888-889`, `.catch(() => undefined)`). Nothing is saved to the
  user's computer. Text messages also show a download button (D1 #19).
- **Fix:** render a "transcribe" button on audio rows that writes into the
  span, rename "download" to "fetch media" (or make it a real browser
  download via `<a download>`), and only show ✓ on success.

### P2 — IA and structure

#### 12. [P2 · PRODUCT · S] Three diagnostics pages, two of them orphaned; Status is first in the route table but last in the nav
- **Evidence:** the routes (`app.ts:35-48`) are `status, chats, chat/:jid,
  unread, contacts, groups, profile, settings, health, events, subscriptions,
  pairing`. Nav (`pages.ts:33-38`) shows 9. **`#/health`** (the same
  `statusDashboardHtml` minus rules, `main.ts:476-477`) and **`#/events`** (a
  live SSE feed, `main.ts:356`) have **no nav entry**: they are orphan pages
  reachable only by URL. Status itself always passes `events: []`
  (`main.ts:367`) and relies on SSE to fill in. An unknown route sets the nav
  highlight to "status" (`app.ts:65-67`), but the 404 links to Chats.
- **Fix:** merge into one **"Status"** page: a human status card (D1 #12) +
  agent inboxes health + a collapsible "Live events" feed + "Raw /health" under
  Diagnostics. Redirect `#/health` and `#/events` to it.

#### 13. [P2 · PRODUCT · S] Nav grouping doesn't match user mental models
- **Evidence (`pages.ts:33-38`):**
  - "chats: Chats, Unread". Unread is a filtered duplicate of Chats (badges
    are already in the list), and its rows aren't links (D1 #11).
  - "people: Contacts, Groups, Profile". Groups is another filtered
    duplicate of Chats, and Profile is *me*, not people.
  - "automations: Subscriptions". This is the only automation shown, while
    rules sit under Status (finding 9) and autoreply/scheduled are invisible
    (finding 7).
  - "system: Status, Pairing, Settings". Pairing stays prominent after
    pairing, and there's no **unlink / log out** although `/api/logout`
    exists (`http.ts:3329`).
- **Proposed IA:**
  1. **Chats**, with All / Unread / Groups / Archived filter tabs and search
  2. **Contacts**, where each row links to the chat
  3. **Agent**, the reason the product exists: Connect agent (D1 #4), Agent
     inbox (finding 3), Automations (finding 7)
  4. **Me**: Profile, Privacy, Blocked
  5. **System**: Status (merged), Settings (connection + transcription), and
     Link/Unlink device (pairing when unlinked; "Unlink this computer" when
     linked)
- **Effort:** S for the nav and redirects; the pages are covered by other
  findings.

#### 14. [P2 · PRODUCT · S] No cross-links between the same entity's views
- Chat → its subscription/agent status: none. The chat view has no header at
  all (D1 #19).
- Contact → chat: none (`pages.ts:130`).
- Unread → chat: none (D1 #11).
- Group → participants: hidden behind a click on the row padding
  (`main.ts:656-683`), not reachable from the chat view.
- Subscription row → chat: shows the JID only (`pages.ts:499`).
- Blocked entry → contact: raw JID (`pages.ts:366`), and you can't block
  from a chat or contact, only by typing a JID (`pages.ts:398`).
- **Fix:** add a chat header with name, "Agent: watching ✓ / off" toggle,
  "Group info", and "Block". Every JID rendered anywhere should become a
  `displayName` link to `#/chat/<jid>`.

#### 15. [P2 · DEFECT · S] Silent failures across mutating actions
- **Evidence:** `.catch(() => undefined)` with no UI on alias
  (`main.ts:629`), group create/leave (`643, 651`), participant add (`695`),
  block/unblock (`745, 752`), group meta (`913`), rule delete (`790`) and media
  download (`888`). The Advanced subscription form has no try/catch at all
  (`main.ts:1130`), so a 400 (for example an invalid `kinds` value) becomes an
  unhandled rejection with no feedback. Exceptions to this are Profile
  (`showProfileError`), send (`chatErrorHtml`) and the subscription picker,
  which show how it should look.
- **Fix:** one `withFeedback(action, el)` helper that shows a success flash or
  an escaped error (the same pattern as `profile-save-status`), applied to
  every mutating handler.

#### 16. [P2 · PRODUCT · S] The Subscriptions "Advanced" form exposes internals that can only take one value
- **Evidence:** "kinds" is free text (`pages.ts:545`), but the server accepts
  exactly `["message"]` (`DISPATCHED_SUBSCRIPTION_KINDS`,
  `shared/src/subscription-kinds.ts:5`; error at `http.ts:3545-3548`). "chat
  jid" is free text, and the `from_jid` filter (which the server supports) is
  missing.
- **Fix:** drop "kinds" from the UI and replace "chat jid" with the picker. If
  you keep Advanced, offer "only messages from…" (a `from_jid` picker) and
  "all chats", which are the two real power options.

### P3 — polish

#### 17. [P3 · DEFECT · S] The events page re-renders the full list from an unbounded array, unescaped
- **Evidence:** `eventsLines.push(line)` with no cap (`main.ts:214`), the
  full `innerHTML` is rebuilt per event, and `l.type` is interpolated without
  `escapeHtml` (`main.ts:220`). Status uses the bounded `appendEvent`/`feedHtml`
  (`main.ts:255-258`). Low risk, because the types come from the SSE
  whitelist.
- **Fix:** reuse `appendEvent` + `feedHtml` (folded into finding 12).

#### 18. [P3 · PRODUCT · S] "Mark all read" makes 1 + N sequential calls, fetching 200 messages per chat
- **Evidence:** `main.ts:809-824`. With 30 unread chats that is 31 calls
  against a 240/min UI bucket, with no progress indicator.
- **Fix:** use the bridge's `/api/read-bulk` (`http.ts:3910`) in one call.

---

## PAGE-BY-PAGE TABLE

| Route | In nav? | Purpose | Persona | Verdict | Top gap |
|---|---|---|---|---|---|
| `#/chats` (default) | yes | List chats | both | Renders well; **rows dead** (D1 #1) | No search (#10), no "new chat" (#10) |
| `#/chat/:jid` | via Groups only | Read and send | both | Send works with inline error; reply fakes a quote (#4) | No header or cross-links (#14); media breaks after send (#10) |
| `#/unread` | yes | Triage unread | partner | Duplicate of Chats; raw JIDs, not links | Fold into a Chats filter (#13) |
| `#/contacts` | yes | Find people | partner | Shows `@lid` JIDs as names (D1 #11) | Not linked to chat; can't message (#14) |
| `#/groups` | yes | Manage groups | owner | List and link work; admin is cosmetic (#8) | Participant actions are no-ops |
| `#/profile` | yes | Name, about, privacy, block | owner | **Best page**: name/about save with feedback | Raw enums (D1 #11); block by typed JID only |
| `#/subscriptions` | yes | **Let the agent watch chats** | dev | Picker is the right model; everything after it is broken (#1–3, #5–6) | No wiring step, no delivery verification |
| `#/status` | yes | Is it working? | both | Raw `/health` dump (D1 #12); hosts the misnamed rules | Merge with health/events; human card (#12) |
| `#/health` | **no (orphan)** | Same as status | — | Duplicate | Redirect to status |
| `#/events` | **no (orphan)** | Live event feed | dev | Works; unbounded (#17) | Fold into Status |
| `#/pairing` | yes | Link device | owner | Broken poll (D1 #2) | Hide when linked; add Unlink (#13) |
| `#/settings` | yes | Connection, transcription | dev | Bridge URL/token only; transcription dead (D1 #13) | Connection fields belong under Advanced |
| *(missing)* | — | Connect agent | dev | — | D1 #4 |
| *(missing)* | — | Automations (autoreply, scheduled, rules) | owner | — | #7 |
| *(missing)* | — | Search | both | — | #10 |

---

## PERSONA SCORECARD

**P1 — Dana, a developer who wants WhatsApp events in Claude Code.**
Comfortable with a terminal; wants "when my landlord or the family group
writes, Claude reads it and drafts a reply".

| Task | Result | Why |
|---|---|---|
| Connect wa-mcp as an MCP server in Claude Code | ⚠️ CLI only | `wa-mcp install --target claude-code` works (per the installer round), but the UI never mentions it (D1 #4) |
| Make Claude react to 2 chats | ❌ | Wrong snippet (D1 #5); the real installer isn't surfaced (#3) and keeps 1 sub (#2); live messages are dropped (#1); the hook shape is unverified (#5) |
| Check it's working | ❌ | No delivery counter or test event; `/health` shows only a count (#3) |

**P2 — Sam, a non-technical partner who wants to read and send from the
desktop.**

| Task | Result | Why |
|---|---|---|
| Read a 1:1 chat | ❌ today, ⚠️ after D1 fix | Rows dead (D1 #1); then no header, oldest-first (D1 #6) |
| Reply to a specific message | ❌ | After the D1 fix, it sends the raw id (#4) |
| Message someone new or find an old message | ❌ | No new chat, no search (#10) |

**P3 — Owner/admin (often the same person as P1) who keeps the account
safe.**

| Task | Result | Why |
|---|---|---|
| Change name, about, privacy | ✅ / ⚠️ | Saves with feedback; raw enum labels (D1 #11) |
| See what the agent will send on my behalf | ❌ | Autoreply, scheduled and send-rules are invisible (#7) |
| Manage a group or unlink this computer | ❌ | Participant controls are no-ops (#8); no unlink (#13) |

---

## THE MCP SURFACE AS PRODUCT (boundary recommendation)

74 tools (`tools.ts`), grouped by whether the UI should surface them:

- **Must be in the UI: the human needs to see or approve it.**
  `subscribe_events`/`unsubscribe_events` (exists, broken). Automations that
  speak for the owner, as read and delete at minimum: `autoreply_set`,
  `schedule_message`/`list_scheduled`/`cancel_scheduled`, `restrict_sending`,
  `list/add/delete_notification_rule`. Also `get_pairing_code`/`get_login_qr`
  (exists) and logout.
- **Should be in the UI: core messaging parity with WhatsApp Desktop.**
  `search_messages`, `send_reaction`, reply via `send_message`'s
  `reply_to_message_id`, `send_media`, `archive/mute/mark_unread`,
  `transcribe_voice` (a button), `get_group_info` +
  `update_group_participants`, `block_unblock` from a chat.
- **Leave as agent-only, and link to docs from an "Agent" page with a
  one-line description per category:** `digest_group`, `catch_up`,
  `export_chat`/`export_unread_messages`, `bulk_clear`, `label_*`,
  `newsletter_*`, `create_template`/`send_template`, `read_document`,
  `view_media`, `forward_message`, `edit_message`/`delete_message`,
  `get_poll_votes`, `get_picture_url`, `set_presence`/`set_chat_state`.
  These are where an agent adds value, and the UI doesn't need to duplicate
  them. An "Agent" page listing "what your agent can do" (generated from the
  tool registry) is cheap, honest marketing.

Rule of thumb: **anything that sends in the owner's name without them
typing it needs a UI view; anything that only reads or summarizes can stay
agent-only.**

---

## TOP-5 FIXES (if only five)

1. **Make subscriptions deliver live inbound messages (#1, #6).** Accept
   `notify`, skip `fromMe`, canonicalize JIDs before matching, and add a
   message id and names to the event line. Use the RED tests described in #1.
   Effort S. Without this, nothing else in the hero path matters.
2. **Align the subscription and hook model (#2).** One inbox per agent with a
   chat set, or per-sub hook entries. Effort S–M.
3. **The "Agent inbox" wizard (#3, #5, plus D1 #4/#5).** Pick chats → copy
   the real `install --hooks` command → "Send test event" with
   last-delivered/pending, and verify the Claude Code hook shape against the
   host docs. Effort M.
4. **An Automations page (#7, #9).** Read and delete views for autoreply,
   scheduled sends, send-rules and notification rules (moved off Status).
   Effort M. It is the owner's safety window onto the agent.
5. **Chat-core parity (#4, #10, #11, #14).** Real quoted reply (must ship with
   the D1 routing fix), search, new chat, contact → chat links, a chat
   header, `mediaToken` kept after send, and a transcribe button. Effort M.

---

## WHAT WORKS (fair credit)

- **The subscription picker's mental model** (checkbox per chat, groups
  first, filter, "N chats — M subscribed", optimistic toggle with
  rollback-on-error banner, `main.ts:1064-1114`) is exactly right. The fixes
  above keep it and fix what sits behind it.
- **Profile** is the most complete page. Name and about save with an
  `aria-live` success or error flash (`main.ts:707-772`), privacy reads live
  values and maps read keys to write keys (`state.ts` `buildPrivacyPatch`),
  and unknown live values are kept as options rather than being overwritten.
- **Send failure handling** keeps the composer text and shows the engine's
  message inline ("message NOT sent, text preserved", `main.ts:599-605`). It
  is a good pattern to copy everywhere (#15).
- **Every loader is guarded** (`guardLoader`, `pages.ts:463-474`), so a failed
  page shows a banner instead of a blank app.
- **The bridge API is far ahead of the UI.** Scheduled sends, templates,
  labels, send-rules, read-bulk, digest and export all exist server-side, so
  most fixes here are UI-only.
- **The CLI has the right primitives.** `install --hooks` makes a backup
  before merging and refuses invalid JSON (`hooks.ts:96-126`), and
  `subscribe`/`unsubscribe` and `inbox drain` with a rotation-safe cursor
  exist. They just need to be surfaced and joined up.
- **The cookbook** (`docs/cookbook/react-to-messages.md`) explains three
  wiring options (Claude hooks, Codex, `tail -F` / MCP resource push). It is
  better onboarding than the UI and should be linked from it.

DIMENSION 2 COMPLETE
