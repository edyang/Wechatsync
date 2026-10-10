#!/usr/bin/env bash
set -euo pipefail
SERVICE="wechatsync-mcp.service"
usage() {
  echo "Usage: sudo manage.sh {start|stop|restart|enable|disable|status|logs}"
  exit 2
}
[ "$#" -eq 1 ] || usage
command -v systemctl >/dev/null 2>&1 || { echo "systemctl not found" >&2; exit 1; }
case "$1" in
  start|stop|restart|enable|disable)
    [ "$(id -u)" -eq 0 ] || { echo "Run with sudo for $1" >&2; exit 1; }
    systemctl "$1" "$SERVICE"
    systemctl --no-pager --full status "$SERVICE" || true
    ;;
  status) exec systemctl --no-pager --full status "$SERVICE" ;;
  logs) exec journalctl -u "$SERVICE" --no-pager -n 100 ;;
  *) usage ;;
esac
