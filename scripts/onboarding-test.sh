#!/usr/bin/env bash
# Onboarding E2E (T-C): fresh data dir → bridge dist bin → /health {status:qr}
# → /api/pairing-code with a fake phone (validation behaves) → restart the daemon →
# with NO creds saved assert it asks for QR again (negative control) → kill.
# NO WhatsApp account is paired.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
BRIDGE_BIN="$ROOT/packages/bridge/dist/bin.mjs"
PORT="${PORT:-8223}"
DATA_DIR="$(mktemp -d /tmp/wa-mcp-onboarding-XXXX)"
BRIDGE_PID=""
FAILURES=0

cleanup() {
  if [[ -n "$BRIDGE_PID" ]] && kill -0 "$BRIDGE_PID" 2>/dev/null; then
    kill "$BRIDGE_PID" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$BRIDGE_PID" 2>/dev/null || break
      sleep 0.25
    done
    kill -9 "$BRIDGE_PID" 2>/dev/null || true
  fi
  echo "cleanup: data dir kept for inspection: $DATA_DIR"
}
trap cleanup EXIT

wait_for() {
  # wait_for <description> <seconds> <command...>
  local description="$1" seconds="$2"
  shift 2
  for _ in $(seq 1 $((seconds * 2))); do
    if "$@" 2>/dev/null; then
      return 0
    fi
    sleep 0.5
  done
  echo "TIMEOUT waiting for: $description (${seconds}s)"
  return 1
}

start_bridge() {
  node "$BRIDGE_BIN" --data-dir "$DATA_DIR" --port "$PORT" >> "$DATA_DIR/bridge.log" 2>&1 &
  BRIDGE_PID=$!
}

stop_bridge() {
  if [[ -n "$BRIDGE_PID" ]] && kill -0 "$BRIDGE_PID" 2>/dev/null; then
    kill "$BRIDGE_PID" 2>/dev/null || true
    for _ in $(seq 1 20); do
      kill -0 "$BRIDGE_PID" 2>/dev/null || break
      sleep 0.25
    done
    kill -9 "$BRIDGE_PID" 2>/dev/null || true
  fi
  BRIDGE_PID=""
}

health_has() {
  curl -sf --max-time 2 "http://127.0.0.1:$PORT/health" | grep -q "$1"
}

echo "== 1. fresh data dir: $DATA_DIR =="
test -d "$DATA_DIR" || exit 1

echo "== 2. start bridge (dist bin) on :$PORT, wait for pairing-eligible state =="
start_bridge
if ! wait_for "health reachable" 30 bash -c "curl -sf --max-time 2 http://127.0.0.1:$PORT/health >/dev/null"; then
  echo "FAIL: bridge never became reachable"
  tail -4 "$DATA_DIR/bridge.log"
  exit 1
fi
if ! wait_for "pairing-eligible state" 90 bash -c "curl -sf --max-time 2 http://127.0.0.1:$PORT/health | grep -qE 'qr|connecting'"; then
  echo "FAIL: bridge never reached qr/connecting"
  tail -4 "$DATA_DIR/bridge.log"
  exit 1
fi
echo "bridge reached pairing-eligible state"

echo "== 3. /health asserts not connected on fresh dir =="
HEALTH=$(curl -sf --max-time 2 "http://127.0.0.1:$PORT/health")
echo "health: $HEALTH"
echo "$HEALTH" | grep -q '"connected":false' || { echo "FAIL: unexpectedly connected"; FAILURES=$((FAILURES+1)); }
test -f "$DATA_DIR/auth/creds.json" && echo "creds initialized at startup (noise keys; pairing still pending)"

echo "== 4. /api/pairing-code with fake phone =="
TOKEN=$(cat "$DATA_DIR/token")
CODE=$(curl -sf --max-time 5 -X POST "http://127.0.0.1:$PORT/api/pairing-code" \
  -H "authorization: Bearer $TOKEN" -H "content-type: application/json" \
  -d '{"phone":"9999999999"}')
echo "pairing-code response: $CODE"
echo "$CODE" | grep -q '"code"' || { echo "FAIL: no code in response"; FAILURES=$((FAILURES+1)); }

echo "== 5. restart daemon =="
stop_bridge
start_bridge
if ! wait_for "health reachable" 15 bash -c "curl -sf --max-time 2 http://127.0.0.1:$PORT/health >/dev/null"; then
  echo "FAIL: bridge did not come back after restart"
  exit 1
fi

echo "== 6. negative control: restart without pairing still asks for pairing =="
HEALTH2=$(curl -sf --max-time 2 "http://127.0.0.1:$PORT/health")
echo "health after restart: $HEALTH2"
echo "$HEALTH2" | grep -q '"connected":false' || { echo "FAIL: unexpectedly connected after restart"; FAILURES=$((FAILURES+1)); }
echo "$HEALTH2" | grep -qE '"status":"(qr|connecting)"' || { echo "FAIL: daemon is not asking for pairing"; FAILURES=$((FAILURES+1)); }
echo "negative control: restart without pairing still asks for pairing (not connected, pairing-eligible state)"

if [[ "$FAILURES" -gt 0 ]]; then
  echo "ONBOARDING TEST: FAIL ($FAILURES failures)"
  exit 1
fi
echo "ONBOARDING TEST: PASS"
