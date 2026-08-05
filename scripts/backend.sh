#!/bin/bash
# Start/stop/status for the local backend, detached from any terminal or
# session — survives the Claude session ending. Logs: .backend.log
set -e
cd "$(dirname "$0")/../apps/backend"
PIDFILE="../../.backend.pid"
case "${1:-start}" in
  start)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then
      echo "already running (pid $(cat "$PIDFILE"))"; exit 0
    fi
    nohup ./node_modules/.bin/tsx src/index.ts > ../../.backend.log 2>&1 &
    echo $! > "$PIDFILE"
    echo "started (pid $!)"
    ;;
  stop)
    [ -f "$PIDFILE" ] && kill "$(cat "$PIDFILE")" 2>/dev/null && rm -f "$PIDFILE" && echo stopped || echo "not running"
    ;;
  status)
    if [ -f "$PIDFILE" ] && kill -0 "$(cat "$PIDFILE")" 2>/dev/null; then echo "running (pid $(cat "$PIDFILE"))"; else echo "not running"; fi
    ;;
esac
