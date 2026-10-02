#!/usr/bin/env bash
# Fresh-container install test (GOAL §11).
# Image is node:22 (was node:20 in the original contract): the bridge store
# uses node:sqlite (DatabaseSync), which exists only from node 22.5 — a
# node:20 container cannot start the daemon at all. See review/BLOCKED.md.
# Mounts ONLY the packed tarball into a node:22 container — no repo checkout —
# and proves: npm install file:tarball → wa-mcp install → doctor (bridge-down rows)
# → daemon start → /health 200 with version 0.9.0 → doctor all-green → stop.
#
# Usage: scripts/docker-install-test.sh [path/to/wa-mcp-0.9.0.tgz]
# Requires: docker daemon running.
set -euo pipefail

TARBALL="${1:-wa-mcp-0.9.0.tgz}"
if [[ ! -f "$TARBALL" ]]; then
  echo "tarball not found: $TARBALL" >&2
  exit 1
fi
TARBALL="$(cd "$(dirname "$TARBALL")" && pwd)/$(basename "$TARBALL")"

echo "== container =="
docker run --rm \
  -v "$TARBALL:/mnt/wa-mcp-0.9.0.tgz:ro" \
  -v "$(cd "$(dirname "$0")" && pwd)/docker-install-test-inner.sh:/mnt/test.sh:ro" \
  -e HOME=/tmp/h \
  node:22 \
  bash /mnt/test.sh
