# TASK: R2-2B — contacts backfill + identity merge (TDD, no commit)

LIVE FINDING (owner-facing bug): /api/contacts returns 3 bare @lid rows,
all fields NULL. The real identity data sits in OTHER tables:
- chats: `351930017568@s.whatsapp.net|Vasilisa`, `120363428874442773@g.us|Test group`
- messages: senderJid/senderName history
- lid_mapping: LID↔PN pairs

The Contacts page CANNOT ship showing raw LIDs. Fix:

1. **Backfill on startup** (and `wa-mcp contacts sync` CLI command):
   - For every chat row with a name: upsert contacts(jid, name).
   - For every distinct senderJid+senderName in messages: upsert with
     pushname=senderName.
   - For every LID row in contacts: resolve via lid_mapping (or
     messages history) to the PN jid; merge rows (keep PN jid as
     primary, store lid column). Bare unresolved LIDs stay but
     displayName falls back to formatted phone from any message origin
     or getDisplayName.
   - Group jids (@g.us) are NOT contacts — exclude from contacts table,
     they live in chats.
2. **contacts.upsert handler enrich**: when event has only id+lid, look
   up the PN via lid_mapping before storing; never store a row that is
   entirely NULL (skip or resolve).
3. **/api/contacts response**: skip rows with no name AND no phone AND
   no pushname (nothing to show); total counts only shown rows.
4. **RE D tests**: backfill from seeded chats+messages fixtures →
   contacts has PN rows with names; lid merge collapses duplicates;
   upsert-with-lid-only resolves through mapping; /api/contacts hides
   empty rows.
5. Live-check after wiring: restart daemon, `curl /api/contacts` must
   show Vasilisa with phone +351 93 001 7568. (Write the exact commands
   you ran in the report; the orchestrator will re-run them.)

Report: RED→GREEN list, backfill row counts on the live db (dry-run
mode first), gates.
