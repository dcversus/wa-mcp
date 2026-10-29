#!/usr/bin/env bash
# Publishes wa-mcp@<version> to npm from the built CLI package.
# The workspace root stays private; this stages the real artifact:
# pack (bundled workspace deps) -> patch manifest to name "wa-mcp" ->
# attach README/LICENSE -> publish.
set -euo pipefail
cd "$(dirname "$0")/.."
source ~/.nvm/nvm.sh >/dev/null 2>&1 || true
nvm use 26 >/dev/null 2>&1 || true

version=$(node -p "require('./packages/cli/package.json').version")
stage=$(mktemp -d /tmp/wa-mcp-publish.XXXXXX)
trap 'rm -rf "$stage"' EXIT

pnpm run -r build >/dev/null
(cd packages/cli && pnpm pack --pack-destination "$stage" >/dev/null)
tar -xzf "$stage/wa-mcp-cli-${version}.tgz" -C "$stage"
node - "$stage/package/package.json" "$version" <<'NODE'
const fs = require("fs");
const [path, version] = process.argv.slice(2);
const d = JSON.parse(fs.readFileSync(path, "utf8"));
d.name = "wa-mcp";
delete d.private;
d.description = "WhatsApp as a local MCP server — one daemon, 77 tools, six agent adapters (Claude Code, Claude Desktop, Codex, Pi, Grok, Antigravity), web UI, voice notes as /voice dictation";
d.keywords = ["whatsapp","mcp","mcp-server","claude","ai","baileys","chat","agent","claude-code","model-context-protocol"];
d.repository = { type: "git", url: "git+https://github.com/dcversus/wa-mcp.git" };
d.homepage = "https://github.com/dcversus/wa-mcp#readme";
d.bugs = { url: "https://github.com/dcversus/wa-mcp/issues" };
d.license = "MIT";
d.engines = { node: ">=26.0.0" };
fs.writeFileSync(path, JSON.stringify(d, null, 2) + "\n");
NODE
cp README.md LICENSE "$stage/package/"
(cd "$stage" && tar -czf "wa-mcp-${version}.tgz" package)
echo "staged: $stage/wa-mcp-${version}.tgz ($(tar -tzf "$stage/wa-mcp-${version}.tgz" | wc -l | tr -d ' ') files)"
if [ "${WAMCP_NO_PUBLISH:-0}" = "1" ]; then
  echo "staging only (WAMCP_NO_PUBLISH=1); artifact kept at: $stage/wa-mcp-${version}.tgz"
  trap - EXIT
  exit 0
fi
npm publish "$stage/wa-mcp-${version}.tgz" --access public "$@"
git tag "v${version}" 2>/dev/null || true
git push origin "v${version}" 2>/dev/null || true
gh release create "v${version}" --repo dcversus/wa-mcp --title "wa-mcp ${version}" --generate-from-changelog 2>/dev/null || true
