# Service definitions

Reference units for running the bridge as a persistent service. Prefer
`wa-mcp install --service`, which writes a unit with your resolved node +
bridge-bin absolute paths into the per-user location and loads it.

## macOS (launchd)

Template: `com.wa-mcp.bridge.plist` — installed by `wa-mcp install --service`
to `~/Library/LaunchAgents/com.wa-mcp.bridge.plist`, then loaded with
`launchctl load <plist>`. KeepAlive + RunAtLoad keep the bridge up and start
it at login. Logs: `<data-dir>/bridge.log`.

Unload/remove: `wa-mcp uninstall --service --remove`.

## Linux (systemd user unit)

Template: `wa-mcp.service` — installed by `wa-mcp install --service` to
`~/.config/systemd/user/wa-mcp.service`. Enable manually (never auto-enabled
by the CLI):

```
systemctl --user daemon-reload
systemctl --user enable --now wa-mcp.service
```

Remove: `wa-mcp uninstall --service --remove`.

## Windows (Task Scheduler) — documented manual step

No auto-install. Register a scheduled task that runs the bridge at logon:

```
schtasks /Create /TN "wa-mcp bridge" /TR "node C:\wa-mcp\packages\bridge\dist\bin.mjs --data-dir C:\wa-mcp\data --port 8080" /SC ONLOGON /RL HIGHEST
```

Query / remove:

```
schtasks /Query /TN "wa-mcp bridge"
schtasks /Delete /TN "wa-mcp bridge" /F
```
