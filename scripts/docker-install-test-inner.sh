#!/usr/bin/env bash
# Runs INSIDE the node:20 container. Expects the tarball at /mnt/wa-mcp-0.9.0.tgz.
set -euo pipefail

echo "== node $(node --version) / npm $(npm --version) =="

cd /tmp
npm init -y >/dev/null
echo "== npm install tarball =="
npm install /mnt/wa-mcp-0.9.0.tgz
echo "== npx wa-mcp --version probe =="
BIN="$(ls /tmp/node_modules/.bin/wa-mcp)"
"$BIN" --data-dir /tmp/data >/dev/null 2>&1 || true # usage line, exercises the binary

mkdir -p /tmp/h /tmp/data
node -e "require('fs').writeFileSync('/tmp/data/token','containertok\n',{mode:0o600})"

echo "== install =="
npx wa-mcp install --home /tmp/h --target cursor --token containertok
test -s /tmp/h/.cursor/mcp.json
grep -q wa-mcp /tmp/h/.cursor/mcp.json
echo "install: config written + contains wa-mcp"

echo "== doctor (bridge down — FAIL rows expected) =="
set +e
npx wa-mcp doctor --home /tmp/h --data-dir /tmp/data --bridge-url http://127.0.0.1:8080
DOCTOR_EXIT=$?
set -e
echo "doctor exit was $DOCTOR_EXIT (non-zero expected while bridge down)"

echo "== start daemon =="
BRIDGE_BIN="/tmp/node_modules/@wa-mcp/bridge/dist/bin.mjs"
test -f "$BRIDGE_BIN"
node "$BRIDGE_BIN" --data-dir /tmp/data --port 8080 > /tmp/bridge.log 2>&1 &
BRIDGE_PID=$!
for i in $(seq 1 20); do
  sleep 0.5
  if curl -sf http://127.0.0.1:8080/health >/dev/null 2>&1; then break; fi
done

echo "== /health =="
HEALTH=$(curl -sf http://127.0.0.1:8080/health)
echo "$HEALTH"
echo "$HEALTH" | grep -q '"version":"0.9.0"'

echo "== doctor (bridge up — all green expected) =="
npx wa-mcp doctor --home /tmp/h --data-dir /tmp/data --bridge-url http://127.0.0.1:8080

echo "== stop =="
kill "$BRIDGE_PID"
wait "$BRIDGE_PID" 2>/dev/null || true

echo "FRESH-CONTAINER INSTALL TEST: PASS"
