# Docker

## Volumes

Mount a host directory at `/data` — the daemon keeps `store.db`, the auth
session, and `media/` there:

```sh
docker run -v ~/.wa-mcp:/data ghcr.io/dcversus/wa-mcp:latest
```

## Permissions (PUID/PGID)

The daemon runs as uid/gid 1000 by default. If your host user differs, set
`PUID`/`PGID` — on startup (as root) the entrypoint chowns the data dir to
that uid:gid and drops privileges via `su-exec`, so mounted stores never end
up root-owned:

```sh
docker run -e PUID=1001 -e PGID=1001 -v ~/.wa-mcp:/data ghcr.io/dcversus/wa-mcp:latest
```

Recommended: keep the mount owned by a non-root uid (`chmod 1000:1000` or
`chown -R 1001:1001 ~/.wa-mcp` once) and match `PUID`/`PGID` to it. Unset
`PUID`/`PGID` keeps the current behavior exactly.

`DATA_DIR` (default `/data`) can be redirected when mounting elsewhere.
