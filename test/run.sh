#!/bin/bash
# Run the blockwatch suites.
#
#   test/run.sh          headless only: no bitcoind, no window, no side effects
#   test/run.sh --app    also the browser suites, against a running bitcoind
#
# The browser suites drive a real Electron window over CDP. They launch their
# own disposable instance with a scratch profile, so they never touch a
# dashboard you already have open or the layout you have saved.
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
RPC_="${RPC_:-8332}"
ZMQ_="${ZMQ_:-28332}"
STATE_DIR="${BW_TEST_STATE:-${TMPDIR:-/tmp}/blockwatch-test}"
export BW_TEST_STATE="$STATE_DIR"

BOLD=$'\033[1m'; DIM=$'\033[2m'; RED=$'\033[31m'; OFF=$'\033[0m'
pass=0; fail=0; launched=0

cleanup() {
  if [ "$launched" = 1 ]; then
    bash "$HERE/stop.sh" 2>/dev/null
    launched=0
  fi
}
# Without this, interrupting a run left the Electron instance alive and its
# ports bound.
trap 'echo; echo "${DIM}interrupted — stopping the test app${OFF}"; cleanup; exit 130' INT TERM
trap cleanup EXIT

run() {
  local name="$1"; shift
  printf '\n%s── %s%s\n' "$BOLD" "$name" "$OFF"
  if "$@"; then pass=$((pass+1)); else fail=$((fail+1)); printf '%s   FAILED: %s%s\n' "$RED" "$name" "$OFF"; fi
}

# Pick a port nothing is listening on, starting from $1.
free_port() {
  local p="$1"
  while ss -ltn 2>/dev/null | grep -q ":$p "; do p=$((p+1)); done
  echo "$p"
}

# ── headless: no node, no window, no shared state ───────────────────────────
run "explorer URL validation" node "$HERE/explorer-url.test.js"
run "contrast (WCAG AA)"      python3 "$HERE/contrast.py"

if [ "${1:-}" != "--app" ]; then
  printf '\n%sSkipping the browser suites. Re-run with --app to include them.%s\n' "$DIM" "$OFF"
else
  if ! ss -ltn 2>/dev/null | grep -q ":$RPC_ "; then
    printf '\n%sNo bitcoind listening on %s.%s\n' "$RED" "$RPC_" "$OFF"
    printf '%s  Start one, or point the suites elsewhere:%s\n' "$DIM" "$OFF"
    printf '%s    RPC_=38332 ZMQ_=28332 npm run test:app   # signet%s\n' "$DIM" "$OFF"
    exit 1
  fi

  PORT_="$(free_port "${PORT_:-3020}")"
  CDP_="$(free_port "${CDP_:-9333}")"
  printf '\n%sLaunching a disposable instance — dashboard %s, CDP %s, RPC %s%s\n' \
    "$DIM" "$PORT_" "$CDP_" "$RPC_" "$OFF"

  if ! out="$(PORT_="$PORT_" CDP_="$CDP_" RPC_="$RPC_" ZMQ_="$ZMQ_" bash "$HERE/launch.sh")"; then
    printf '%sThe app failed to start. Not running the browser suites.%s\n' "$RED" "$OFF"
    exit 1
  fi
  launched=1
  printf '%s  %s%s\n' "$DIM" "$out" "$OFF"
  export BW_PORT="$PORT_" BW_CDP="$CDP_"

  run "layout engine"                node "$HERE/layout-engine.test.js"
  run "horizontal reclaim + restore" node "$HERE/layout-reclaim.test.js"
  cleanup
fi

printf '\n%s%d suite(s) passed, %d failed%s\n' "$BOLD" "$pass" "$fail" "$OFF"
[ "$fail" -eq 0 ]
