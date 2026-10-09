#!/usr/bin/env bash
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "$0")" && pwd -P)"
cd "$ROOT"
[ -f .env ] || { echo 'Missing .env; run bash install.sh first' >&2; exit 1; }
[ "$#" -ge 1 ] || { echo 'Usage: bash manage.sh {start|stop|restart|status|logs|health} [args]' >&2; exit 2; }
action="$1"
shift
compose() { docker compose --env-file .env -f compose.yaml "$@"; }
case "$action" in
  start)
    [ "$#" -eq 0 ] || exit 2
    compose up -d --no-build --pull never
    ;;
  stop)
    [ "$#" -eq 0 ] || exit 2
    compose stop
    ;;
  restart)
    [ "$#" -eq 0 ] || exit 2
    compose restart wechatsync-mcp
    ;;
  status)
    [ "$#" -eq 0 ] || exit 2
    compose ps --all
    ;;
  logs)
    compose logs --tail=100 "$@" wechatsync-mcp
    ;;
  health)
    [ "$#" -eq 0 ] || exit 2
    node_bin="$(command -v node || true)"
    if [ -n "$node_bin" ]; then
      "$node_bin" -e 'fetch("http://127.0.0.1:9528/health").then(r=>r.text().then(t=>{console.log(t);process.exit(r.ok?0:1)})).catch(e=>{console.error(e.message);process.exit(1)})'
    else
      docker exec baize-wechatsync-mcp node -e 'fetch("http://127.0.0.1:9528/health").then(r=>r.text().then(t=>{console.log(t);process.exit(r.ok?0:1)})).catch(e=>{console.error(e.message);process.exit(1)})'
    fi
    ;;
  *)
    echo 'Usage: bash manage.sh {start|stop|restart|status|logs|health} [args]' >&2
    exit 2
    ;;
esac
