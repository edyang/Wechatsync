#!/usr/bin/env bash
set -euo pipefail
command -v systemctl >/dev/null 2>&1 || { echo "systemctl not found" >&2; exit 1; }
exec systemctl --no-pager --full status wechatsync-mcp.service
