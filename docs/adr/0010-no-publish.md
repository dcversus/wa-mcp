# 0010 — No-publish release discipline

## Status

Accepted

## Context

The deliverable for 0.9.0 is a private repo with a packed, publish-ready tarball — nothing published. Accidental publishing (npm, registry listings, release tags) is irreversible.

## Decision

Mechanical guards, not intentions:

- CI has no release workflow; no push/tag triggers publish anything.
- The security job's no-publish step greps packages/scripts/workflows for `npm publish`, `pnpm publish`, `npmjs.org` using a character-class pattern that cannot match itself; any hit fails the build.
- The packed tarball is verified (`vp pack`), never uploaded.
- Registry/directory listings (MCP Registry, Glama, Smithery) are documented exclusions pending owner approval.

## Consequences

- The first publish will be a deliberate owner action with these guards consciously relaxed.
- CI artifacts (dist upload) stay internal to the run.
