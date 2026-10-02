# 0007 — Store schema, migrations, FTS5

## Status

Accepted

## Context

Messages, chats, contacts, transcripts and state need durable storage with full-text search. Migration history matters because the census requires importing foreign store layouts later.

## Decision

`node:sqlite` with WAL and `busy_timeout=5000`. A `migrations` table is the source of truth; migrations apply in order, tracked by version (v1 tables, v2 FTS5 + triggers, v3 contacts phone/username, v4 messages.raw, v5 notification_rules, v6 transcripts). FTS5 uses `unicode61 remove_diacritics 2` with INSERT/UPDATE/DELETE triggers; searches sanitize user input into quoted FTS terms with a LIKE fallback. `messages.raw` (v4) keeps the original proto JSON so media can be re-downloaded from the store.

## Consequences

- Raw-content storage is what makes `POST /api/media/{id}` and transcripts possible for old messages.
- Windows CI cannot assert POSIX file modes (0700/0600 checks are platform-gated; live-gated on macOS/Linux).
- node:sqlite is experimental in node 22 — acceptable for a private 0.9; revisit if the API shifts.
