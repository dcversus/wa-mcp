#!/bin/sh
# T81 line67: the wa-mcp daemon entrypoint. When PUID/PGID are set (and the
# container runs as root), the mounted data dir is chowned to that uid:gid and
# the daemon execs via su-exec under it — so mounted stores never end up
# root-owned. Defaults keep the previous behavior (run as-is).
set -e

PUID="${PUID:-1000}"
PGID="${PGID:-1000}"
DATA_DIR="${DATA_DIR:-/data}"

if [ "$(id -u)" = "0" ] && { [ "$PUID" != "1000" ] || [ "$PGID" != "1000" ]; }; then
  mkdir -p "$DATA_DIR"
  chown -R "$PUID:$PGID" "$DATA_DIR"
  exec su-exec "$PUID:$PGID" "$@"
fi

exec "$@"
