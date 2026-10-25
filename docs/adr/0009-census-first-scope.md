# 0009 — Census-first scope: 1,029 items → ACCOUNTING

> Historical record. The census artifacts (`review/BACKLOG-FULL.md`,
> `review/ACCOUNTING.md`) and their generator scripts were retired with the
> first public release; immutable copies are linked from the `archive` issues.

## Status

Accepted

## Context

WhatsApp MCP proxies overlap heavily. Building from vibes would duplicate the ecosystem; ignoring it would miss hard-won lessons. GOAL §13 requires an ACCOUNTING.md row for every item in the 1,029-item census (18 repos).

## Decision

The census (`review/BACKLOG-FULL.md`) is machine-generated and never hand-edited. `scripts/gen-accounting.ts` dispositions every item through an ID_OVERRIDES table plus ordered keyword rules into the fixed vocabulary (ABSORBED, SUPERSEDED-BY, NA-ENGINE, ALREADY-CORE, OUT-OF-SCOPE-0.9, NOISE). `review/accounting-check.ts` asserts 1,029 rows and vocabulary validity; wired into CI.

## Consequences

- The mapping is honest about method: rules + sample review, not a per-item human audit (regenerable when the mapping tightens).
- ALREADY-CORE is deliberately 0 — base-scope items are ABSORBED with a location note.
- Engine-truth probes (buttons/lists Business-only, MCPL, python runtime) back the NA-ENGINE rows.
