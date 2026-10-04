#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")/.."
release_version="0.9.0"
expected_version=$(node -p "require('./packages/cli/package.json').version")
if [ "$expected_version" != "$release_version" ]; then
  echo "version drift: contract is ${release_version} but packages/cli/package.json is ${expected_version}" >&2
  exit 1
fi
pnpm run -r build >/dev/null
cd packages/cli
pnpm pack --pack-destination ../.. >/dev/null
cd ../..
packed="wa-mcp-cli-${expected_version}.tgz"
if [ ! -f "$packed" ]; then
  echo "version drift: packages/cli/package.json is ${expected_version} but pack produced no ${packed}" >&2
  exit 1
fi
actual_version=$(tar -xOzf "$packed" package/package.json | node -e "let d='';process.stdin.on('data',(c)=>d+=c).on('end',()=>console.log(JSON.parse(d).version))")
if [ "$actual_version" != "$expected_version" ]; then
  echo "version drift: package.json is ${expected_version} but the packed tarball carries ${actual_version}" >&2
  exit 1
fi
mv "$packed" "wa-mcp-${expected_version}.tgz"
shasum -a 256 "wa-mcp-${expected_version}.tgz"
