#!/usr/bin/env bash
# Default: stop/remove the container, preserve .env, image and shared network.
# --purge: additionally delete .env; image and network are retained deliberately.
set -Eeuo pipefail
ROOT="$(cd -- "$(dirname -- "$0")" && pwd -P)"
cd "$ROOT"
[ "$#" -le 1 ] || { echo 'Usage: bash uninstall.sh [--purge]' >&2; exit 2; }
purge=0
if [ "$#" -eq 1 ]; then
  [ "$1" = '--purge' ] || { echo 'Usage: bash uninstall.sh [--purge]' >&2; exit 2; }
  purge=1
fi
[ ! -L .env ] || { echo 'Refusing symlinked .env' >&2; exit 1; }
if [ -f .env ]; then
  docker compose --env-file .env -f compose.yaml down --remove-orphans
else
  docker compose --env-file .env.example -f compose.yaml down --remove-orphans
fi
if [ "$purge" -eq 1 ]; then
  rm -f -- .env
  echo 'Container removed; .env deleted. Shared network and offline image retained.'
else
  echo 'Container removed; .env kept so credentials survive reinstall.'
fi
