# Live Baileys event fixtures

Recorded raw engine events (JSONL, one payload per line) captured with the
bridge's event recorder. Used by `tests/fixtures-replay.test.ts` to re-drive
the ingest pipeline against real engine output instead of hand-written mocks.

## Recording

1. Set the record dir and restart the daemon:

   ```
   WA_RECORD_EVENTS=scripts/fixtures/engine-events/recorded wa-mcp start
   ```

2. Interact (receive messages, reactions, receipts, group updates...) —
   every subscribed event appends a raw payload line to
   `recorded/<event-name>.jsonl`.

3. Move the interesting files up one level (`recorded/` -> this dir) and
   prune anything with private chat content you do not want committed.
   Committing live data requires owner consent.

## Privacy

`*.jsonl` files in this directory are GITIGNORED by default. The recorder
strips credential-shaped keys, but message bodies stay as emitted. Only
commit fixtures you have reviewed.

## Replay

`vp test` picks up `tests/fixtures-replay.test.ts`, which reads every
`*.jsonl` here and re-drives the ingest pipeline. With no fixtures present
the test prints a SKIP line.
