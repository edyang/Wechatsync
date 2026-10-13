# Baize Wechatsync MCP Linux service

This Linux bundle runs the Wechatsync MCP SSE endpoint and Chrome WebSocket bridge as a systemd service. Supported: Linux with systemd and system-wide Node.js 22+ (Ubuntu 22.04/24.04, Debian 12, etc.). It installs a dedicated unprivileged account, starts at boot, and logs to journald.

## Installation

Download the Wechatsync-Baize-MCP-Linux GitHub Actions artifact; extract the outer GitHub ZIP and then the inner Wechatsync-Baize-MCP-Linux.zip.

From the extracted directory containing install.sh:

    sudo bash install.sh

The package includes node_modules; no npm install is necessary on the target host. Installation generates two random 256-bit tokens in /etc/wechatsync-mcp/.env (permissions root:root 0600). Reinstallation upgrades the code and preserves the .env file. Failed upgrades attempt rollback.

## Control, status, and logs

    sudo /opt/wechatsync-mcp/bin/status.sh
    sudo /opt/wechatsync-mcp/bin/logs.sh --lines 100
    sudo /opt/wechatsync-mcp/bin/logs.sh --follow
    sudo /opt/wechatsync-mcp/bin/manage.sh restart
    sudo /opt/wechatsync-mcp/bin/manage.sh stop
    sudo /opt/wechatsync-mcp/bin/manage.sh start

    sudoedit /etc/wechatsync-mcp/.env
    sudo systemctl restart wechatsync-mcp

The .env.example is documentation; the installed .env is generated on first installation and never contains fixed example passwords.

## Manager and browser connectivity

* SYNC_WS_HOST=127.0.0.1, port 9527: Chrome WebSocket bridge. On a different client PC, use an SSH tunnel:
  ssh -N -L 9527:127.0.0.1:9527 user@your-mcp-server
  Then point Chrome to ws://127.0.0.1:9527 and set its token to WECHATSYNC_TOKEN.
* SYNC_HTTP_HOST=127.0.0.1, port 9528: SSE endpoint http://127.0.0.1:9528/sse. Manager must use the independent WECHATSYNC_HTTP_TOKEN as Bearer token.
* Port 9529: internal HTTP bridge, always loopback. Do not expose it.
* Manager in a Docker container has its own loopback interface. For cross-host access, use a private reverse proxy or explicitly bind a protected internal interface; do not open raw HTTP or WS to the public Internet.
* Local health probe: curl http://127.0.0.1:9528/health. An extensionConnected value of false means Chrome is not connected, not that the MCP process is unhealthy.

Open https://chsparta.com/admin/content-settings to configure the SSE address and the HTTP token. Keep publish mode at draft until platform account testing has passed. Browser credentials remain on the Chrome client.

## Uninstallation

    sudo /opt/wechatsync-mcp/bin/uninstall.sh

Default removes the service and binaries while retaining /etc/wechatsync-mcp/.env, which contains secrets. To delete configuration too, run the extracted archive copy:

    sudo bash uninstall.sh --purge

The dedicated Linux user account is retained (safe for installations where it may be managed externally). Uninstall refuses to delete paths that were not created by this installer.

## Troubleshooting

    systemctl status wechatsync-mcp --no-pager
    journalctl -u wechatsync-mcp -n 100 --no-pager
    journalctl -u wechatsync-mcp -f
    ss -ltn | grep -E ':(9527|9528|9529)[[:space:]]'

Install the separately built Chrome extension package as well. Successful CI packaging is not proof of live publication; verify drafts and platform-specific publishing with an authorized account.
