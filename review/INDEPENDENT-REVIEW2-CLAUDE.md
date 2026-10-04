# Plan: write review/INDEPENDENT-REVIEW2-CLAUDE.md

## Context
I ran an independent read-only review of wa-mcp 0.9.0 at commit `eafd8e8`. This was review 1 of a 3-reviewer series, covering functional parity against the reference WhatsApp MCP servers and how strict the MCP surface is. Plan mode blocked writing the deliverable. The only action left is to write the report below to `review/INDEPENDENT-REVIEW2-CLAUDE.md`, word for word: one new file, no code changes, no commit.

Verification after writing: `git status` shows only that file as untracked.

---

# INDEPENDENT REVIEW 2 — Claude (Review 1 of 3: MCP-surface parity & strictness)

- **Scope:** `packages/mcp-server/src/{server,tools,bin}.ts`, plus the bridge routes they call (`packages/bridge/src/http.ts`, `send/`, `store/`).
- **Baseline:** `main` @ `eafd8e8`. The review was read-only and nothing was executed.
- **Parity sources:** `review/BACKLOG-FULL.md` (issue/PR census). kahflane, biliboss and eddmann have empty trackers ("README/feature-level accounting"), and jonzarecki has dependabot PRs only. For those four repos I took the inventory from the reference attributions in `GOAL.md` §4–§9.
- **Surface:** 61 tools confirmed (`tools.ts:149-1791`).

## Critical

### C1. `export_chat` and `export_unread_messages` fail on real bridge output
- **Where:** `tools.ts:1386-1390` and `tools.ts:1402-1406` call `bridgeFetch()`, which always runs `response.json()` (`tools.ts:127`).
- **Mismatch:** `/api/export` returns raw NDJSON or plain text, not JSON (`http.ts:3146-3151`; `store/export.ts:48` joins rows with `"\n"`).
- **Effect:** `format=md|txt` always throws. `jsonl` throws for any chat with two or more messages. The caller gets a JSON-RPC -32603 "Unexpected non-whitespace character…" error.
- **Why the tests pass:** they only assert the URL, and the mock returns JSON (`tests/server.test.ts:452-471`).
- **Secondary issue:** output is silently cut at 4000 chars (`tools.ts:1390`) with no truncation marker. This contradicts GOAL §5 line 121 ("truncation metadata").

### C2. The send-safety controls (`restrict_sending` rules, rate limit, daily cap) can be bypassed through the MCP surface
**(a) Rules are checked against the raw caller string, before recipient resolution.**
- `serveSend` evaluates rules on the unresolved `chat_jid` (`http.ts:558-570`).
- Alias and phone resolution happens later (`http.ts:1020-1032`).
- `ruleMatches` compares exact strings or prefixes (`store/send-rules.ts:43-47`).
- **Result:** a block rule on `351…@s.whatsapp.net` is bypassed by `send_message{chat_jid:"mom"}` (an alias), by `"+351…"`, or by the LID form.

**(b) Several send paths skip `SendGuard` (pacing and daily cap) and/or the rules entirely:**
- **Batch forward:** the undocumented `ids[]` parameter, passed through by `forward_message` (`tools.ts:710-711`). The bridge loop returns before resolution, `SendGuard` and persistence (`http.ts:813-861`; `sendViaSocket` is called with no opts at `http.ts:841-847`).
- **Scheduler:** `bin.ts:137-157` has no guard, no rules, no alias resolution and no store, so scheduled sends are never persisted (contrary to lharries #229 / VGP #221 parity).
- **`send_voice_note` / TTS:** `http.ts:1839`, `http.ts:1902` have no guard and no rules.
- **`newsletter_send`:** `http.ts:2686` has no guard.
- **Autoreply:** `lifecycle.ts:576` checks rules but has no `SendGuard`, so there is no daily cap on an inbound-triggered loop.

GOAL §4 line 87 ("6 rapid sends → 5 pass 1 limited") and line 91 ("rule blocks send → structured refusal") hold only for the plain `/api/send` single-message path.

## High

### H1. `send_message` has no reply/quote and no @-mention parameters, although the bridge supports both
- **Bridge support:** `reply_to_message_id` and `mentions[]` are validated and wired at `http.ts:640-673`.
- **MCP schema:** `tools.ts:209-293` exposes neither. The plain-text body at `tools.ts:382` is only `{chat_jid, text}`.
- **Parity refs:**
  - lharries PR#201 / PR#277 / I#121 (quoted reply)
  - lharries PR#321 and VGP PR#190 / I#159 (@-mentions, merged upstream)
  - VGP I#107 / PR#109
  - Felix I#57
- **Ledger impact:** GOAL §4 line 70 ticks "mentions[], reply_to" from bridge unit tests. An MCP agent cannot reach either feature.

### H2. Poll, location and contact sends exist in the bridge but no MCP tool reaches them
- **Bridge kinds:** `location` (`http.ts:879-900`), `contact` (`http.ts:901-923`), `poll` (`http.ts:987-1015`).
- **MCP side:** `send_message` and `send_media` cannot set these kinds. `send_media` forwards `kind`, but the bridge rejects `media` combined with a non-media kind (`http.ts:617-623`), and `send_media` requires `media`.
- **Parity refs:**
  - `send_location` / `send_contact`: kahflane, biliboss (GOAL lines 73 and 78, ticked "live")
  - `send_poll`: VGP PR#83, chigwell PR#30, Felix #84 (GOAL line 79, ticked)

### H3. `get_chat` is unreliable and has no group membership; no group-info tool exists
- **How it works:** the tool lists `/api/chats?limit=200` and filters in-process (`tools.ts:608-613`).
- **Archived chats:** `listChats` returns only `archived=0` unless asked (`store/queries.ts:262,273`), so an archived chat returns "chat not found".
- **Chat #201 and later:** also "chat not found" (`MAX_LIMIT=200`, `queries.ts:5`).
- **Other gaps:** no alias or phone resolution, and "not found" comes back as a successful result.
- **No participants:** neither `get_chat` nor any other tool returns participants. `GET /api/group/info` (`http.ts:2300`) has no MCP tool.
- **Parity refs:** lharries I#66 (Group Members); VGP I#89, PR#258, PR#152; kahflane, biliboss and delltrak `group_info` / `get_group_members`.
- **Ledger impact:** GOAL line 124 ("get_chat includes group participants") and line 153 are ticked from bridge/live probes, not from the MCP surface.

### H4. Pagination cannot be used through MCP
- **Bridge support:** `offset` on `/api/chats`, `/api/messages` and `/api/search` (`http.ts:436-437, 455, 531`). `/api/messages` also returns `meta.nextOffset` (`http.ts:481-489`).
- **MCP schemas:** `list_chats` (`tools.ts:397-403`), `list_messages` (`tools.ts:417-425`) and `search_messages` (`tools.ts:442-452`) have no `offset`. The model is told `nextOffset` but cannot send it back.
- **Also missing on `list_messages`:** the `sender` filter the bridge supports (`http.ts:466`). Refs: lharries I#33 (sender_phone_number), chigwell PR#193.
- **Global listing:** `chat_jid` is mandatory, so listing across all chats is impossible.
- **Parity refs:** chigwell I#27 / PR#245, VGP PR#226, lharries PR#271.

### H5. MCP error handling: no timeouts, protocol errors instead of tool errors, and one hung call blocks the stdio session
- **No timeout or AbortSignal:**
  - `bridgeFetch` (`tools.ts:122-126`) and `bridgeFetchResource` (`server.ts:83-87`) have none.
  - `handleStream` awaits each request serially (`bin.ts:37-46`). One hung bridge call (T93-E fixed three of these) blocks every later request on stdio, including `ping`.
- **Body parsed before status check:** `response.json()` runs before `response.ok` (`tools.ts:127-128`). Any non-JSON 5xx (proxy HTML, empty 502, etc.) surfaces as a JSON SyntaxError, and the HTTP status is lost.
- **Bridge down:** surfaces as a bare "fetch failed" with no hint such as "is the daemon running? `wa-mcp status`".
- **`isError` never used:**
  - `ToolResult` has no `isError` field (`tools.ts:9-13`).
  - `toolResultToPayload` passes only `content` through (`server.ts:139-141`).
  - Every bridge failure is thrown and becomes a JSON-RPC -32603 / -32602 protocol error (`server.ts:299-313`). The MCP spec routes tool-execution failures through `result.isError=true` so the model can read the message and recover.
- **Inverse problem:** several tools report failures as successful text, so the client cannot tell they failed:
  - "delete failed" (`tools.ts:689`)
  - `NOT_FOUND:` (`tools.ts:1518, 1725, 1746, 1771`)
  - `VALIDATION_ERROR:` (`tools.ts:1316`)
  - view/transcribe errors swallowed as text (`tools.ts:1559-1562, 1612-1615`)
- **`resources/read`:** never checks `response.ok` (`server.ts:81-88`), so a 401 or 500 body is served as resource content.

### H6. Annotations are inaccurate
- **`openWorldHint: false` on all 61 tools** (`tools.ts:33, 1829`), including every tool that sends to the WhatsApp network: `send_*`, `forward_message`, group operations, `newsletter_*`, `block_unblock`, `update_profile`, `set_privacy`. These do reach external parties. Clients that auto-approve closed-world tools are misinformed.
- **Read-only tools without `readOnlyHint`:** `get_chat`, `label_list`, `newsletter_list`, `get_group_invite`, `export_chat`, `export_unread_messages`, `view_media`, `transcribe_voice`, `transcribe_message`. The spec default (`readOnlyHint=false`, `destructiveHint=true`) therefore marks them as destructive.
- **Wrong hints:**
  - `get_media` is marked `readOnlyHint:true` (`tools.ts:1815`) but POSTs a download that writes to disk (`tools.ts:923-925`).
  - `autoreply_set` and `restrict_sending` are marked `idempotentHint:true` (`tools.ts:1822-1823`), but `action=add` creates a new rule on every call.
  - `restrict_sending` is marked `destructiveHint` even for `action=list`, because multi-action tools cannot be annotated accurately.
- **Dead or overridden entries:**
  - `logout` is annotated (`tools.ts:1817`) but no such tool exists.
  - `annotate()` output on `get_login_qr` (`tools.ts:150-204`) is discarded because `toolsWithAnnotations` overwrites `tool.annotations` (`tools.ts:1826-1831`).

### H7. Bridge capabilities with no MCP tool (parity gaps where the backend already exists)

| Bridge route | Reference (BACKLOG/GOAL) | MCP gap |
|---|---|---|
| `POST /api/presence` (`http.ts:1265`) | fabienbutz I#5 (typing indicator); kahflane `send_presence` (GOAL 84 ticked) | no tool |
| `GET /api/group/info` (`http.ts:2300`) | lharries I#66; VGP I#89 / PR#258 | no tool (see H3) |
| `POST /api/group/settings` (`http.ts:1486`) | kahflane / biliboss / delltrak (GOAL 158 ticked) | `update_group_meta` covers only subject/description |
| `/api/groups/:jid/requests` (`http.ts:2537-2586`) | kahflane / biliboss (GOAL 157) | no tool |
| `/api/groups/:jid/ephemeral` (`http.ts:2588`) | kahflane; VGP PR#82 (GOAL 159) | no tool |
| `POST /api/calls/reject` (`http.ts:2692`) | biliboss / kahflane / delltrak (GOAL 162) | no tool |
| `POST /api/mark-unread` (`http.ts:2714`) | chigwell PR#46 (GOAL 132 ticked) | no tool |
| `POST /api/logout` (`http.ts:2736`) | kahflane `wa_logout` (GOAL 92) | no tool, despite the annotation entry |
| `POST /api/profile/picture` (`http.ts:1580`) | kahflane / biliboss / delltrak (GOAL 168 ticked) | `update_profile` handles name/status only |
| `/api/tts` with `audio_path` / `audio_url` (`http.ts:1816-1845`) | lharries PR#31 `send_audio_message` | `send_voice_note` handles TTS text only; an existing audio file cannot be sent as a PTT voice note |
| `DELETE /api/templates/:name` (`http.ts:2963`) | kahflane templates | no delete-template tool |
| `POST /api/pair/resume` (`http.ts:2741`) | own pairing budget | `get_login_qr` tells the agent to call it (`tools.ts:180`), but no tool can |
| group invite revoke / join-by-code | kahflane / biliboss / delltrak (GOAL 156) | only `get_group_invite` |
| alias list/delete | chigwell PR#173 / #178 (GOAL 116: set/list/delete) | only `set_alias` |

## Medium

### M1. The `send_message` schema does not describe how the tool behaves
- `required:["text"]` (`tools.ts:211`), yet `text` is ignored for the `interactive` and `list` variants (`tools.ts:327-380`), which read `interactive.title` and `list.title` instead.
- `chat_jid` is required unless `status_broadcast` is set, but this is only stated in prose. There is no `oneOf` or `if/then`.
- A non-string `url` is silently ignored (`tools.ts:318-319`).
- `interactive.title` is required by the handler (`tools.ts:330`) but not by the schema.

### M2. Loose validation that can cause the wrong action
- **`block_unblock`:** `block: args.block === true` (`tools.ts:895`). The string `"true"` or a missing value results in an **unblock**.
- **`restrict_sending`:** any action other than `add`/`list` falls through to remove (`tools.ts:1203`); for example `"delete"` with an `id` deletes a rule.
- **`autoreply_set`:**
  - `action=toggle` without `enabled` disables the rule (`tools.ts:1236`).
  - Unknown actions are forwarded to the bridge.
- **Missing enums:**
  - `send_media.kind` (`tools.ts:564`)
  - `set_privacy.key` / `value` (`tools.ts:865-870`)
  - `update_group_participants.action` (`tools.ts:1032`)
- **No element checks:**
  - `create_group.participants` (`tools.ts:1011`) allows `[]` and non-strings.
  - `update_group_participants.jids` (`tools.ts:1038`) has the same gap.
- **`set_chat_state.muted_until`:** documented as "or null to unmute", but the schema type is `string` (`tools.ts:759`), so strict clients reject `null`. Calling with only `chat_jid` is accepted as a no-op.
- **`update_profile`:** accepts `{}`, and types are unchecked (`tools.ts:843-849`).
- **`send_template.vars`:** not checked for object type (`tools.ts:1292`).
- **`label_add.color`:** not checked as hex (`tools.ts:1441`).

### M3. Parameters silently dropped
- `list_messages` `after`/`before`: non-string values are discarded (`tools.ts:430-431`).
- `search_messages` `chat_jid`: same (`tools.ts:459`).
- `bulk_clear`: a non-array `chat_jids` becomes `[]` and returns "cleared 0 chats" (`tools.ts:1420-1425`).
- `forward_message`: `ids` is accepted but missing from the schema (`tools.ts:710`).

### M4. Reaction semantics
- `send_reaction` requires a non-empty `emote` (`tools.ts:635`), so a reaction cannot be removed. WhatsApp removes a reaction when the text is empty.
- The bridge hard-codes `key.fromMe:false` with no `participant` (`http.ts:689`):
  - reacting to your own message builds the wrong key;
  - in groups, the reaction key has no sender.
- Refs: Felix PR#32 ("reactions to other users' messages silently failing"), VGP PR#108.

### M5. Streamable-HTTP `/mcp` transport
- A notification gets HTTP 200 with body `{}` (`http.ts:1176-1178`). The spec says 202 Accepted with no body.
- There is no `Mcp-Session-Id` handling and no GET/SSE leg.

### M6. Registry drift and prompt drift
- **Registry:** `tools/list` lists the global `TOOLS` (`server.ts:269`), but `tools/call` dispatches against `ctx.tools` (`server.ts:279`). Any embedder passing a subset (read-only mode, as in chigwell PR#136 / VGP PR#255) would advertise tools it then refuses.
- **Prompts:**
  - The `action-items` prompt tells the model to call `search_messages … (since=…)` (`server.ts:255-256`), but `search_messages` has no `since` parameter.
  - Required prompt arguments are not validated, so a missing `group`/`since` yields "Summarize  since " (`server.ts:209-212`).
  - An unknown prompt returns -32601 (`server.ts:263`); the spec uses -32602 for an invalid prompt name.

### M7. Duplicate tools and inconsistent naming
- **Duplicates:**
  - `transcribe_message` (`tools.ts:1112`) and `transcribe_voice` (`tools.ts:1586`) hit the same `/api/transcribe` endpoint.
  - `get_media` (`tools.ts:912`) and `download_media` (`tools.ts:1499`) both download.
- **Naming styles are mixed:**
  - verb_noun: `add_notification_rule`
  - noun_verb: `label_add`, `newsletter_follow`
  - multi-action: `autoreply_set`, `restrict_sending`
  - combined verb: `block_unblock`
  - single-op setters: `set_alias`, `set_chat_state`
- Pick one convention before 1.0. Tool names are a public contract.

### M8. `schedule_message` input checks
- `send_at` is not validated as ISO, either in the tool (`tools.ts:1345`) or in the bridge (`http.ts:2997-3011`). A garbage date is accepted and stored.
- `chat_jid` is not alias-resolved at schedule time.
- Scheduled sends skip guards and persistence (see C2).

### M9. `mark_chat_read` caps at 200 messages
- It reads only the newest 200 messages (`tools.ts:732-738`); unread messages beyond that are never marked.
- The bridge already has `/api/read-bulk`, which clears a chat in one statement but sends no receipts.

## Low

### L1. Token visible in the process list
`--token` on the command line exposes the bridge token in `ps` (`bin.ts:21-23`). Prefer `WA_TOKEN` only, or a token file.

### L2. Silent "unknown id" fallbacks
`send_message`, `send_template` and `newsletter_send` report `"unknown id"` when the bridge omits `message_id` (`tools.ts:390, 1326, 1689`), and `label_add` reports `id ?` the same way (`tools.ts:1446`).

### L3. `get_login_qr` result typing
It returns QR text plus a pointer to the web UI, but no `image` content block. An image-capable client could render the QR inline (VGP PR#242 PNG pattern).

### L4. Remaining reference capabilities not offered
These are explicitly out of scope in ACCOUNTING; listed for completeness:
- `check_number_exists` (delltrak, GOAL 76) — this one is useful for agents before a send
- `send_view_once` (GOAL 75)
- image/video status (GOAL 77 is text-only)
- `delete_message_for_me` (kahflane)
- broadcast lists (GOAL 85)
- `send_event` (GOAL 90)
- `get_privacy` read (GOAL 170; no GET route exists)
- `get_last_interaction`, `get_contact_chats`, `get_direct_chat_by_contact` (lharries README tools; VGP I#74)
- `wait_for_new_message` (chigwell PR#130)

### L5. Parity already met
These match or beat the references:
- `catch_up`, `digest_group` and MCP prompts (jonzarecki/eddmann)
- FTS search with operators (eddmann; lharries PR#281)
- `get_unread_counts` and `mark_chat_read` (jonzarecki; lharries PR#313)
- labels (lharries PR#235)
- newsletters (biliboss/delltrak)
- view/transcribe media (VGP PR#246 / PR#247)
- templates, scheduler, autoreply (kahflane)
- buttons/list (lharries #15 / #197)

## Verdict: **DO-NOT-SHIP**
This verdict applies to `eafd8e8` as it stands. Two Critical findings stand in the way:
- **C1:** two advertised tools always fail on real output.
- **C2:** the advertised send-safety guarantees (`restrict_sending`, pacing, daily cap) can be bypassed through ordinary MCP calls: an alias, a `+phone` form, batch forward, scheduling, or TTS.

Both fixes are small and local:
- **C1:** read `/api/export` with `response.text()`.
- **C2:** evaluate rules after `resolveRecipient`, and route every send path through one function that applies guard, rules and persistence.

**Moves to SHIP-WITH-FIXES once these are fixed:** C1, C2, H5 (timeouts plus `isError`) and H1/H2 (reply, mentions, poll, location and contact wired into MCP). H3/H4/H6/H7 and the Medium items can follow in 0.9.x.
