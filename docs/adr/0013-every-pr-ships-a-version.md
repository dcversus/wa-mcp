# ADR 0013: Every PR ships its own version

Date: 2026-11-06
Status: Accepted
Issue: #268

## Context

Releases went through a release issue and a `release/x.y.z` PR that gathered other PRs. The owner found this heavy: changes waited in `## Unreleased`, the release branch repeated work already reviewed elsewhere, and nothing forced any of it to happen.

## Decision

Every PR ships its own version. It moves the version up and adds a dated `CHANGELOG.md` section for it. There are no release branches, release PRs or release issues.

- `scripts/bump-version.mjs` moves every version surface and starts the section.
- `scripts/check-pr-version.mjs` enforces the rule as a step in the `security` job, which branch protection already requires.
- A PR is exempt only if it touches nothing but the infra paths listed in that script. The exemption follows the changed files rather than a label, so a PR can't opt out. Docs and tests are not exempt.

## Consequences

- `main` always has one version, and the changelog says what each merge changed.
- PRs that touch the same version surfaces conflict. `main` requires an up-to-date branch, so the second PR merges `main` and bumps again.
- Small changes such as a docs fix use up a patch number.
- Merging doesn't publish. `scripts/publish.sh` stays a separate step from clean `main`, because npm needs the owner's security key. The next publish ships everything merged so far, so not every version reaches npm.
