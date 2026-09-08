#!/bin/bash
# Stop the instance launch.sh started — and only that instance.
#
# The previous version killed every process whose cmdline contained
# node_modules/electron/dist/electron, which meant running the tests killed the
# user's own dashboard and any other Electron app started from source. It now
# signals exactly the recorded pid and its process group.
set -u

STATE_DIR="${BW_TEST_STATE:-${TMPDIR:-/tmp}/blockwatch-test}"
PIDFILE="$STATE_DIR/app.pid"

[ -f "$PIDFILE" ] || exit 0
pid="$(cat "$PIDFILE" 2>/dev/null || true)"
rm -f "$PIDFILE"
[ -n "${pid:-}" ] || exit 0
kill -0 "$pid" 2>/dev/null || exit 0

# Electron spawns renderer and GPU children. Ask politely, then insist.
pkill -TERM -P "$pid" 2>/dev/null
kill -TERM "$pid" 2>/dev/null
for _ in $(seq 1 30); do
  kill -0 "$pid" 2>/dev/null || exit 0
  sleep 0.1
done
pkill -KILL -P "$pid" 2>/dev/null
kill -KILL "$pid" 2>/dev/null
exit 0
