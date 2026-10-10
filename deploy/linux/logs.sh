#!/usr/bin/env bash
set -euo pipefail
SERVICE="wechatsync-mcp.service"
LINES=100
FOLLOW=0
usage() { echo "Usage: logs.sh [--follow|-f] [--lines|-n 100]"; exit 2; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --follow|-f) FOLLOW=1; shift ;;
    --lines|-n)
      [ "$#" -ge 2 ] || usage
      LINES="$2"
      shift 2
      ;;
    --help|-h) usage ;;
    *) usage ;;
  esac
done
case "$LINES" in
  ''|*[!0-9]*) usage ;;
esac
[ "$LINES" -ge 1 ] && [ "$LINES" -le 5000 ] || usage
command -v journalctl >/dev/null 2>&1 || { echo "journalctl not found" >&2; exit 1; }
if [ "$FOLLOW" -eq 1 ]; then
  exec journalctl -u "$SERVICE" -n "$LINES" --no-pager -f
fi
exec journalctl -u "$SERVICE" -n "$LINES" --no-pager
