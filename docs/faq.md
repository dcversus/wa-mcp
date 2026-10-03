# FAQ

Top recurring questions from the 1,029-item upstream census
(review/ACCOUNTING.md has the full dispositions).

**Is this affiliated with WhatsApp?** No. It is an unofficial client over the
Baileys protocol. Automation may violate WhatsApp's ToS — use a test number.

**Can I run multiple accounts?** Out of scope for 0.9 (one daemon per
account); see ACCOUNTING Phase-10 rows.

**Why does sending fail with "can't link new devices"?** That is pairing, not
sending — WhatsApp's anti-abuse cooldown. See [Troubleshooting](./troubleshooting).

**Where do media files go?** `<dataDir>/media/` (created 0700). Downloads:
`GET /api/media/<message_id>`.

**Which message types are ingested?** Text, media (all five kinds), polls
(+votes), edits, revokes, reactions, location, contacts — see the tool
reference. Buttons/lists are Business-account-only.

**Does it work on Windows?** The daemon needs Node ≥22.5 and has not been
exercised on Windows (CI matrix covers it for unit tests).

**Can I use the official Cloud API instead of Baileys?** The channel-adapter
foundation exists (`src/channels/`); the Cloud API adapter is Phase K
(sandbox credentials pending).

**Is my data encrypted at rest?** No — SQLite (WAL) under `~/.wa-mcp/`,
directory 0700. At-rest encryption is an ACCOUNTING row, not shipped.

**Why is a tool missing that another fork has?** Every upstream item is
dispositioned in ACCOUNTING.md — ABSORBED, NA-ENGINE, or OUT-OF-SCOPE-0.9
with reasons.

**How do I report a bug?** GitHub issues on this repo. Security issues:
private advisory (see SECURITY.md).
