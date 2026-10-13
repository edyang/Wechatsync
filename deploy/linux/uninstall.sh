#!/usr/bin/env bash
# Safe uninstall. By default, preserve /etc/wechatsync-mcp/.env.
set -Eeuo pipefail
SERVICE="wechatsync-mcp.service"
INSTALL_DIR="/opt/wechatsync-mcp"
ENV_DIR="/etc/wechatsync-mcp"
UNIT_FILE="/etc/systemd/system/$SERVICE"
PURGE=0
usage() { echo "Usage: sudo bash uninstall.sh [--purge]"; exit 2; }
[ "$(id -u)" -eq 0 ] || { echo "Run as root: sudo bash uninstall.sh" >&2; exit 1; }
while [ "$#" -gt 0 ]; do
  case "$1" in
    --purge) PURGE=1 ;;
    --help|-h) usage ;;
    *) usage ;;
  esac
  shift
done
if [ -f "$UNIT_FILE" ] && ! grep -qx '# Managed by Baize Wechatsync installer' "$UNIT_FILE"; then
  echo "Refusing to remove an unmanaged unit: $UNIT_FILE" >&2
  exit 1
fi
if [ -e "$INSTALL_DIR" ] && [ ! -f "$INSTALL_DIR/.baize-wechatsync-managed" ]; then
  echo "Refusing to remove an unmanaged directory: $INSTALL_DIR" >&2
  exit 1
fi
if command -v systemctl >/dev/null 2>&1; then
  systemctl disable --now "$SERVICE" >/dev/null 2>&1 || true
fi
rm -f -- "$UNIT_FILE"
if command -v systemctl >/dev/null 2>&1; then
  systemctl daemon-reload
  systemctl reset-failed "$SERVICE" >/dev/null 2>&1 || true
fi
if [ -f "$INSTALL_DIR/.baize-wechatsync-managed" ]; then
  rm -rf -- "$INSTALL_DIR"
fi
if [ "$PURGE" -eq 1 ]; then
  [ ! -L "$ENV_DIR" ] || { echo "Refusing symlinked config path" >&2; exit 1; }
  [ ! -L "$ENV_DIR/.env" ] || { echo "Refusing symlinked .env" >&2; exit 1; }
  rm -f -- "$ENV_DIR/.env"
  rmdir -- "$ENV_DIR" 2>/dev/null || true
  echo "Uninstalled and deleted .env (service account retained)."
else
  echo "Uninstalled service and binaries; retained configuration: $ENV_DIR/.env"
  echo "To delete config later: sudo bash uninstall.sh --purge"
fi
