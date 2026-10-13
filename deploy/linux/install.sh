#!/usr/bin/env bash
# Install or safely upgrade Baize Wechatsync MCP as a systemd service.
set -Eeuo pipefail

SERVICE="wechatsync-mcp.service"
USER_NAME="wechatsync-mcp"
INSTALL_DIR="/opt/wechatsync-mcp"
ENV_DIR="/etc/wechatsync-mcp"
ENV_FILE="$ENV_DIR/.env"
UNIT_FILE="/etc/systemd/system/$SERVICE"
SCRIPT_DIR="$(CDPATH='' cd -- "$(dirname -- "$0")" && pwd -P)"
STAGE=""
BACKUP_DIR=""
UNIT_BACKUP=""
OLD_ACTIVE=0
CUTOVER=0
SUCCESS=0

die() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }
log() { printf '[wechatsync-mcp] %s\n' "$*"; }
usage() { echo "Usage: sudo bash install.sh"; }

on_exit() {
  local rc="$1"
  trap - EXIT
  if [ "$SUCCESS" -eq 0 ] && [ "$CUTOVER" -eq 1 ]; then
    log "Install failed; restoring previous service where possible."
    systemctl stop "$SERVICE" >/dev/null 2>&1 || true
    if [ -d "$INSTALL_DIR" ] && [ -f "$INSTALL_DIR/.baize-wechatsync-managed" ]; then
      rm -rf -- "$INSTALL_DIR"
    fi
    if [ -n "$BACKUP_DIR" ] && [ -d "$BACKUP_DIR" ]; then
      mv -- "$BACKUP_DIR" "$INSTALL_DIR" || true
      BACKUP_DIR=""
    fi
    if [ -n "$UNIT_BACKUP" ] && [ -f "$UNIT_BACKUP" ]; then
      cp -- "$UNIT_BACKUP" "$UNIT_FILE"
    else
      rm -f -- "$UNIT_FILE"
    fi
    systemctl daemon-reload || true
    if [ "$OLD_ACTIVE" -eq 1 ]; then
      systemctl enable --now "$SERVICE" || true
    fi
  fi
  if [ -n "$STAGE" ] && [ -d "$STAGE" ]; then rm -rf -- "$STAGE"; fi
  if [ -n "$UNIT_BACKUP" ] && [ -f "$UNIT_BACKUP" ]; then rm -f -- "$UNIT_BACKUP"; fi
  if [ "$SUCCESS" -eq 1 ] && [ -n "$BACKUP_DIR" ] && [ -d "$BACKUP_DIR" ]; then
    rm -rf -- "$BACKUP_DIR"
  fi
  exit "$rc"
}
trap 'on_exit $?' EXIT

[ "$#" -eq 0 ] || { usage; die "Unknown arguments"; }
[ "$(id -u)" -eq 0 ] || die "Run as root: sudo bash install.sh"
command -v systemctl >/dev/null 2>&1 || die "systemctl not found; systemd is required"
[ -d /run/systemd/system ] || die "systemd is not running (containers without systemd are unsupported)"
for tool in useradd getent cp mv install mktemp grep chmod chown readlink; do
  command -v "$tool" >/dev/null 2>&1 || die "Missing command: $tool"
done
[ -f "$SCRIPT_DIR/mcp-server/dist/index.js" ] || die "Missing bundled mcp-server/dist/index.js"
[ -f "$SCRIPT_DIR/mcp-server/package.json" ] || die "Missing bundled package.json"
[ -d "$SCRIPT_DIR/mcp-server/node_modules" ] || die "Missing bundled node_modules; use the Linux release package"

NODE_BIN="$(command -v node || true)"
[ -n "$NODE_BIN" ] || die "Node.js 22+ is required. Install a system-wide Node.js first."
NODE_BIN="$(readlink -f -- "$NODE_BIN")"
case "$NODE_BIN" in
  /usr/*|/opt/*) ;;
  *) die "Node must be installed system-wide (/usr or /opt), not under a user's home: $NODE_BIN" ;;
esac
[ -x "$NODE_BIN" ] || die "Node executable not found: $NODE_BIN"
NODE_MAJOR="$("$NODE_BIN" -p 'Number(process.versions.node.split(".")[0])')"
case "$NODE_MAJOR" in
  ''|*[!0-9]*) die "Unable to read Node.js version" ;;
esac
[ "$NODE_MAJOR" -ge 22 ] || die "Node.js 22+ required; found major version $NODE_MAJOR"
"$NODE_BIN" --check "$SCRIPT_DIR/mcp-server/dist/index.js" >/dev/null

if [ -e "$INSTALL_DIR" ] && [ ! -f "$INSTALL_DIR/.baize-wechatsync-managed" ]; then
  die "$INSTALL_DIR exists but was not created by this installer; refusing to overwrite"
fi
if [ -f "$UNIT_FILE" ] && ! grep -qx '# Managed by Baize Wechatsync installer' "$UNIT_FILE"; then
  die "$UNIT_FILE is not managed by this installer; refusing to overwrite"
fi
[ ! -L "$ENV_DIR" ] || die "Refusing a symlinked configuration directory"
[ ! -L "$ENV_FILE" ] || die "Refusing a symlinked configuration file"

STAGE="$(mktemp -d /opt/.wechatsync-mcp-new.XXXXXXXX)"
cp -a -- "$SCRIPT_DIR/mcp-server/dist" "$STAGE/dist"
cp -a -- "$SCRIPT_DIR/mcp-server/node_modules" "$STAGE/node_modules"
install -m 0644 "$SCRIPT_DIR/mcp-server/package.json" "$STAGE/package.json"
install -d -m 0755 "$STAGE/bin"
for script in manage.sh status.sh logs.sh uninstall.sh; do
  install -m 0755 "$SCRIPT_DIR/$script" "$STAGE/bin/$script"
done
install -m 0644 "$SCRIPT_DIR/.env.example" "$STAGE/.env.example"
install -m 0644 /dev/null "$STAGE/.baize-wechatsync-managed"
chmod 0755 "$STAGE"
chown -R root:root "$STAGE"

install -d -m 0700 -o root -g root "$ENV_DIR"
if [ ! -e "$ENV_FILE" ]; then
  BRIDGE_TOKEN="$("$NODE_BIN" -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
  HTTP_TOKEN="$("$NODE_BIN" -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("hex"))')"
  (
    umask 077
    cat > "$ENV_FILE" <<ENV
# Edit with: sudoedit /etc/wechatsync-mcp/.env
# Restart after changes: sudo systemctl restart wechatsync-mcp
WECHATSYNC_TOKEN=$BRIDGE_TOKEN
WECHATSYNC_HTTP_TOKEN=$HTTP_TOKEN
SYNC_WS_HOST=127.0.0.1
SYNC_WS_PORT=9527
SYNC_HTTP_HOST=127.0.0.1
SYNC_HTTP_PORT=9528
SYNC_BRIDGE_API_PORT=9529
ENV
  )
  log "Generated independent random tokens in $ENV_FILE (not printed)."
else
  log "Retaining existing configuration at $ENV_FILE."
fi
chown root:root "$ENV_FILE"
chmod 0600 "$ENV_FILE"
for key in WECHATSYNC_TOKEN WECHATSYNC_HTTP_TOKEN; do
  grep -Eq "^$key=[^[:space:]]{16,}$" "$ENV_FILE" ||
    die "Missing/weak $key in $ENV_FILE; edit it before installation"
done

if ! getent passwd "$USER_NAME" >/dev/null; then
  NOLOGIN="$(command -v nologin || true)"
  [ -n "$NOLOGIN" ] || NOLOGIN="/usr/sbin/nologin"
  useradd --system --user-group --no-create-home \
    --home-dir /nonexistent --shell "$NOLOGIN" "$USER_NAME"
fi
SERVICE_GROUP="$(id -gn "$USER_NAME")"

if systemctl is-active --quiet "$SERVICE"; then OLD_ACTIVE=1; fi
if [ -f "$UNIT_FILE" ]; then
  UNIT_BACKUP="$(mktemp /tmp/wechatsync-mcp-unit.XXXXXXXX)"
  cp -- "$UNIT_FILE" "$UNIT_BACKUP"
fi

CUTOVER=1
if [ "$OLD_ACTIVE" -eq 1 ]; then
  log "Stopping existing service for upgrade."
  systemctl stop "$SERVICE"
fi
if [ -d "$INSTALL_DIR" ]; then
  BACKUP_DIR="$(mktemp -d /opt/.wechatsync-mcp-old.XXXXXXXX)"
  rmdir -- "$BACKUP_DIR"
  mv -- "$INSTALL_DIR" "$BACKUP_DIR"
fi
mv -- "$STAGE" "$INSTALL_DIR"
STAGE=""

# systemd reads EnvironmentFile as root before dropping privileges.
cat > "$UNIT_FILE" <<UNIT
# Managed by Baize Wechatsync installer
[Unit]
Description=Baize Wechatsync MCP Server (SSE and Chrome bridge)
Documentation=https://github.com/edyang/Wechatsync
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
User=$USER_NAME
Group=$SERVICE_GROUP
WorkingDirectory=$INSTALL_DIR
Environment=NODE_ENV=production
EnvironmentFile=$ENV_FILE
ExecStart=$NODE_BIN $INSTALL_DIR/dist/index.js --sse
Restart=on-failure
RestartSec=5
TimeoutStopSec=20
UMask=0077
NoNewPrivileges=true
PrivateTmp=true
ProtectSystem=strict
ProtectHome=true
ProtectKernelTunables=true
ProtectKernelModules=true
ProtectControlGroups=true
RestrictAddressFamilies=AF_UNIX AF_INET AF_INET6
CapabilityBoundingSet=
AmbientCapabilities=
LimitNOFILE=8192
StandardOutput=journal
StandardError=journal

[Install]
WantedBy=multi-user.target
UNIT
chmod 0644 "$UNIT_FILE"
systemctl daemon-reload
systemctl enable "$SERVICE" >/dev/null
systemctl start "$SERVICE"
sleep 2
systemctl is-active --quiet "$SERVICE" || {
  systemctl --no-pager -l status "$SERVICE" || true
  die "Service is not active; check journalctl -u $SERVICE"
}
SUCCESS=1
log "Installed and enabled: $SERVICE"
log "Configuration: $ENV_FILE (root:root 0600; preserved on re-install)"
log "Status: sudo $INSTALL_DIR/bin/status.sh"
log "Logs: sudo $INSTALL_DIR/bin/logs.sh --follow"
log "Restart after editing .env: sudo $INSTALL_DIR/bin/manage.sh restart"
