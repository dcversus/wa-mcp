#!/usr/bin/env bash
# Runs INSIDE the node:26 container. Expects the tarball at /mnt/wa-mcp-0.1.0.tgz.
set -euo pipefail

echo "== node $(node --version) / npm $(npm --version) =="

cd /tmp
npm init -y >/dev/null
echo "== npm install tarball =="
npm install /mnt/wa-mcp-0.1.0.tgz
echo "== npx wa-mcp --version probe =="
BIN="$(ls /tmp/node_modules/.bin/wa-mcp)"
"$BIN" --data-dir /tmp/data >/dev/null 2>&1 || true # usage line, exercises the binary

mkdir -p /tmp/h /tmp/data
node -e "require('fs').writeFileSync('/tmp/data/token','containertok\n',{mode:0o600})"

echo "== install =="
npx wa-mcp install --home /tmp/h --target grok --token containertok
test -s /tmp/h/.grok/mcp.json
grep -q wa-mcp /tmp/h/.grok/mcp.json
echo "install: config written + contains wa-mcp"

echo "== doctor (bridge down — FAIL rows expected) =="
set +e
npx wa-mcp doctor --home /tmp/h --data-dir /tmp/data --bridge-url http://127.0.0.1:8080
DOCTOR_EXIT=$?
set -e
echo "doctor exit was $DOCTOR_EXIT (non-zero expected while bridge down)"

echo "== start daemon =="
# npm installs bundled workspace deps NESTED under the cli package
# (/tmp/node_modules/@wa-mcp/cli/node_modules/@wa-mcp/bridge/...), not
# hoisted — resolve from the installed cli first, then fall back to a find.
BRIDGE_BIN="$(node -e "console.log(require.resolve('@wa-mcp/bridge/package.json', { paths: ['/tmp/node_modules/@wa-mcp/cli'] }))" 2>/dev/null | sed 's|/package.json$||')/dist/bin.mjs"
if [[ ! -f "$BRIDGE_BIN" ]]; then
  BRIDGE_BIN="$(find /tmp/node_modules -path '*@wa-mcp/bridge/dist/bin.mjs' 2>/dev/null | head -1)"
fi
if [[ -z "$BRIDGE_BIN" ]] || [[ ! -f "$BRIDGE_BIN" ]]; then
  echo "FATAL: @wa-mcp/bridge/dist/bin.mjs not found under /tmp/node_modules" >&2
  echo "installed @wa-mcp layout:" >&2
  find /tmp/node_modules -maxdepth 5 -type d -name "bridge" -path "*@wa-mcp*" 2>/dev/null | head >&2
  ls /tmp/node_modules/@wa-mcp 2>/dev/null >&2 || true
  exit 1
fi
echo "bridge bin: $BRIDGE_BIN"
node "$BRIDGE_BIN" --data-dir /tmp/data --port 8080 > /tmp/bridge.log 2>&1 &
BRIDGE_PID=$!
for i in $(seq 1 20); do
  sleep 0.5
  if curl -sf http://127.0.0.1:8080/health >/dev/null 2>&1; then break; fi
done

echo "== /health =="
HEALTH=$(curl -sf http://127.0.0.1:8080/health)
echo "$HEALTH"
echo "$HEALTH" | grep -q '"version":"0.1.0"'

echo "== doctor (bridge up — all green expected) =="
npx wa-mcp doctor --home /tmp/h --data-dir /tmp/data --bridge-url http://127.0.0.1:8080

echo "== stop =="
kill "$BRIDGE_PID"
wait "$BRIDGE_PID" 2>/dev/null || true

echo "FRESH-CONTAINER INSTALL TEST: PASS"
