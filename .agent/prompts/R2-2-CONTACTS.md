# R2-2 — Contacts: real-names parity + add contact (second wave of WebUI R2)

## Canon
`docs/raw/2026-10-07-webui-r2-restructure.md` — owner spec, verbatim.
Contacts: "SHOULD BE exactly REAL names/contacts from my whatsapp, with
ability to add contact or search by username, name, number. SHOULD BE 100%
functionality parity with whatsappweb". Executor: Anthropic claude (opus).
TDD, no comments, vp check 0, suite green, no commit.

## Context — what exists (verified)
- Baileys contacts: `contactsUpsert` events + `contact.set` store table
  (jid → name/pushname?). Check `packages/bridge/src/store/schema.ts` and
  the lifecycle wiring for what's actually captured today.
- `/api/contacts` (list) and `/api/contacts/upsert` exist? grep http.ts.
  MCP `set_alias` exists. WhatsApp itself has no write-API for the phone's
  address book — "add contact" here means the LOCAL alias/override layer
  (name we store + use everywhere), NOT writing to the phone's contacts.
  This must be explained in the UI copy honestly (one line).
- Wave-4 `displayName` resolution: contacts/aliases → formatted phone.

## Part A — contact store parity
1. Audit what's captured per contact today (name, pushname, jid, lid?).
   Ensure `contactsUpsert` persists EVERYTHING Baileys gives (name,
   pushname, verified name if present, phone) with defensive migration.
   RED: fixture proto → store row.
2. `/api/contacts` response: include jid, displayName, phone (formatted),
   pushname, alias, source (whatsapp|alias), isGroup excluded. Add `q`
   param (server-side LIKE across name/pushname/phone/jid) + limit.
   RED: filter cases (name match, partial number, pushname).

## Part B — Contacts page (TRUE WhatsApp-Web parity via companion-device protocol)
VERIFIED PROTOCOL SURFACE (fork source, 2026-10-07 — owner corrected the
"no API" assumption; this is canon):
- WRITE: `client.addOrEditContact(jid, { fullName, firstName?, username? })`
  → app-state sync patch, same mechanism WhatsApp Web uses. Edits propagate
  to the account's synced address book (phone included).
- DELETE: `client.removeContact(jid)`.
- READ-SYNC: other devices' edits arrive as sync actions → fork emits
  `contacts.upsert` with `{id, name, username, lid, phoneNumber}` — our
  existing lifecycle handler should persist these; verify + fix if it
  drops fields (username!).
1. Bridge: `POST /api/contacts` {jid?, phone?, name, username?} → resolves
   jid from phone when needed → `addOrEditContact`; `PATCH /api/contacts/:jid`
   {name} → same; `DELETE /api/contacts/:jid` → `removeContact`.
   RED: mocked-client tests for all three (call args + error mapping
   4xx/5xx, phone→jid resolution).
2. Lifecycle: `contacts.upsert` handler persists id/name/username/lid/
   phoneNumber into the contact store (defensive upsert). RED: fake
   upsert event → store row shows all fields.
3. Web UI route `#/contacts`, WhatsApp-Web feel:
   - Search (debounced, `q` param) + count.
   - Rows: avatar initials, displayName, phone formatted, secondary
     "on WhatsApp as <pushname/username>" when different.
   - Click → `#/chat/<jid>`.
   - "New contact" form: name + phone (+prefix validation) + optional
     username → POST. Copy: syncs to your WhatsApp account like Web does.
   - Row menu: rename (inline edit → PATCH), remove (confirm → DELETE).
4. CLI: `wa-mcp contacts [--q]` list; `wa-mcp contacts add <phone>
   --name <n> [--username <u>]`; `wa-mcp contacts rename <phone|jid>
   --name <n>`; `wa-mcp contacts remove <phone|jid>`.
   RED: CLI tests (query strings + table).
5. LIVE-SMOKE (careful mode): unit tests only this wave — do NOT execute
   addOrEditContact against the real account from tests. A supervised
   live smoke (add one throwaway contact, then remove it) happens at
   verification, owner-present. Note this in the report.

## Part C — deletion of dead pages begins (staged)
Per owner: "OTHER PAGES SHOULD BE DELETED". Target list (delete NOW):
- `#/automations` (owner: "I DONT EXPECT THIS FUNCTIONALITY AT ALL") —
  delete page+route+nav; KEEP the bridge endpoints (MCP tools still use
  them; scheduled-send rules remain agent-configurable) but remove all
  web-ui code for them.
- `#/unread`, `#/health`, `#/events` leftover redirects — logs/status
  cover them.
Keep (for now): chats, contacts, subscriptions (rebuild comes R2-4),
profile, connection/status, connect stub (absorbed into Connections R2-3).
RED: router tests updated (deleted routes 404→home), nav render test,
removed-code grep assertions (no 'automations' string in web-ui src).

## Report
Per-part summary, RED→GREEN list, contacts field inventory (before/after),
gates.
