#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
pnpm run -r build >/dev/null
cd packages/cli
pnpm pack --pack-destination ../.. >/dev/null
cd ../..
mv wa-mcp-cli-0.9.0.tgz wa-mcp-0.9.0.tgz
shasum -a 256 wa-mcp-0.9.0.tgz
