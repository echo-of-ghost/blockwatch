#!/bin/bash
# Launch a disposable blockwatch instance for the browser suites.
#
# Three things this deliberately does NOT do, because the previous version did
# and each was destructive:
#
#   1. It does not pkill every Electron process. That killed the user's own
#      running dashboard, and any other Electron app started from source.
#      Only the pid we launch is ever signalled, via the pid file below.
#   2. It does not share the user's Electron profile. --user-data-dir points at
#      a scratch directory, so the suites cannot read or destroy the saved
#      panel layout in bw_layout_v44.
#   3. It does not assume a fixed debugging port. The caller passes one, and
#      run.sh picks a free pair, so a second Chrome on 9222 cannot be driven by
#      mistake.
#
# Writes to stdout:  PORT=<n> CDP=<n> PID=<n> PROFILE=<dir>
set -u

HERE="$(cd "$(dirname "$0")" && pwd)"
REPO="$(cd "$HERE/.." && pwd)"
STATE_DIR="${BW_TEST_STATE:-${TMPDIR:-/tmp}/blockwatch-test}"
PORT_="${PORT_:-3020}"
CDP_="${CDP_:-9333}"
RPC_="${RPC_:-8332}"
ZMQ_="${ZMQ_:-28332}"

mkdir -p "$STATE_DIR"
PIDFILE="$STATE_DIR/app.pid"
PROFILE="$STATE_DIR/profile"
LOG="$STATE_DIR/app.log"

# A previous run that was killed hard may have left an instance behind. Only
# the recorded pid is touched.
if [ -f "$PIDFILE" ]; then
  old="$(cat "$PIDFILE" 2>/dev/null || true)"
  if [ -n "${old:-}" ] && kill -0 "$old" 2>/dev/null; then
    echo "stopping previous test instance (pid $old)"
    kill "$old" 2>/dev/null
    for _ in $(seq 1 20); do kill -0 "$old" 2>/dev/null || break; sleep 0.1; done
    kill -9 "$old" 2>/dev/null
  fi
  rm -f "$PIDFILE"
fi

if [ ! -x "$REPO/node_modules/electron/dist/electron" ]; then
  echo "ERROR: electron binary missing. Run npm install." >&2
  exit 1
fi
if ss -ltn 2>/dev/null | grep -q ":$PORT_ "; then
  echo "ERROR: port $PORT_ is already in use. Set PORT_ to a free port." >&2
  exit 1
fi
if ss -ltn 2>/dev/null | grep -q ":$CDP_ "; then
  echo "ERROR: CDP port $CDP_ is already in use. Set CDP_ to a free port." >&2
  exit 1
fi

# A fresh profile every run: deterministic start state, and no path from a test
# to the user's real layout.
rm -rf "$PROFILE"
mkdir -p "$PROFILE"
rm -f "$LOG"

cd "$REPO" || exit 1
env -u ELECTRON_RUN_AS_NODE \
    PORT="$PORT_" \
    BITCOIN_RPC_PORT="$RPC_" \
    ZMQ_PORT="$ZMQ_" \
    ./node_modules/electron/dist/electron \
      --user-data-dir="$PROFILE" \
      --remote-debugging-port="$CDP_" \
      . > "$LOG" 2>&1 &
APP_PID=$!
echo "$APP_PID" > "$PIDFILE"

# Readiness means both halves are up: the dashboard is serving and the
# debugging endpoint is answering. Waiting on the HTTP port alone raced the CDP
# socket, which is what the old fixed `sleep 3` was papering over.
http_ok=0; cdp_ok=0
for _ in $(seq 1 60); do
  sleep 0.5
  if ! kill -0 "$APP_PID" 2>/dev/null; then
    echo "ERROR: the app exited during startup." >&2
    sed 's/\x1b\[[0-9;]*m//g' "$LOG" | grep -viE "mesa|dri_gbm|libva|gpu|vaapi|fontconfig|dbus" | tail -20 >&2
    rm -f "$PIDFILE"
    exit 1
  fi
  [ "$http_ok" = 1 ] || { ss -ltn 2>/dev/null | grep -q ":$PORT_ " && http_ok=1; }
  [ "$cdp_ok" = 1 ]  || { curl -sf -m 2 "http://127.0.0.1:$CDP_/json/version" >/dev/null 2>&1 && cdp_ok=1; }
  [ "$http_ok" = 1 ] && [ "$cdp_ok" = 1 ] && break
done

if [ "$http_ok" != 1 ] || [ "$cdp_ok" != 1 ]; then
  echo "ERROR: app did not become ready (http=$http_ok cdp=$cdp_ok) after 30s." >&2
  sed 's/\x1b\[[0-9;]*m//g' "$LOG" | grep -viE "mesa|dri_gbm|libva|gpu|vaapi|fontconfig|dbus" | tail -20 >&2
  kill "$APP_PID" 2>/dev/null
  rm -f "$PIDFILE"
  exit 1
fi

echo "PORT=$PORT_ CDP=$CDP_ PID=$APP_PID PROFILE=$PROFILE"
