# Troubleshooting

Symptom → cause → fix, grouped by area. Start with `wa-mcp doctor`, then see [Diagnostics](./diagnostics.md).

## Pairing

### Pairing-block playbook (fresh accounts, containers)

"Can't link new devices right now" is a server-side gate on the account+number. Ranked causes: a **fresh account** (new SIM = highest-risk class — give it 2–3 days of normal use before linking), **attempt cadence** (every attempt restarts the cooldown; QR rotation counts per rotation — the code flow is one attempt), **virtual/VoIP number ranges**, and a phased server-side cohort that blocks third-party clients during WhatsApp's rollout (engine-wide; only time fixes it).

Do: stop ALL attempts → 24h+ quiet (longer for fresh accounts) → on the phone: update WhatsApp, remove other Linked Devices sessions, use the account normally → then pair **once** with `wa-mcp pair --code` (single registration) with an operator present. Containers: gate bridge start on creds existing so restart loops can't fire registrations (see the [voice-dictation cookbook's container notes](/cookbook/voice-dictation.md); a `--no-pair` boot mode is tracked).

**Register from the account's home geography, operate anywhere** (beta data point, 2026-10-25): companion REGISTRATIONS are geo/IP-risk gated — an established EU account linked instantly from an EU home IP and was refused repeatedly ("Can't link new devices right now") from an Indonesian datacenter IP the same day, while post-registration connections from the distant IP were accepted. Pair where the account lives (or through an egress there), then move the data dir; `WA_PROXY` (#51) makes the egress side clean for geo-split deployments.

The code flow hits the same wall with the same message at code entry (beta data point, 2026-10-25: fresh SIM rejected QR and code across two days of attempts — consistent rejection of BOTH flows after quiet windows points at the phased server-side cohort — though one beta number cleared with ~48h of quiet + an EU-IP QR (2026-10-27), so try 24–48h quiet from a home-geography IP before assuming the long cohort; the fast path to a working bot remains an established account).

Don't: delete/re-register the number, retry in a loop, or leave an unpaired daemon running under a restart policy.

| Symptom                                                | Cause                                                                                                                                                                                                                                                                      | Fix                                                                                                                                   |
| ------------------------------------------------------ | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------- |
| "can't link new devices right now"                     | WhatsApp's anti-abuse counts **every** link attempt, and each attempt restarts its cooldown. After 3 registrations without a successful pairing, wa-mcp stops creating new ones (`/health.pairingBlocked: true`). <!-- src: packages/bridge/src/http.ts:2398-2399, 572 --> | Stop all attempts and wait hours. Then send `POST /api/pair/resume` with the account token, or restart, and pair **once**. See below. |
| `pairingAttempts.used` keeps rising on its own         | A second daemon, or a restart loop, is creating registrations                                                                                                                                                                                                              | Check for two daemons (see CLI). Every boot counts.                                                                                   |
| The pairing page says the QR codes expired             | Nobody scanned any code of the batch, so the daemon stopped registering (the way WhatsApp Web shows "click to reload")                                                                                                                                                     | Have the phone ready, then click **Show a new QR code** or run `wa-mcp pair`. Each click is one link attempt.                         |
| `wa-mcp pair --code` prints a code but nothing happens | You need to enter the code on the phone: **Linked devices → Link with phone number instead**. The CLI waits while you do it. <!-- src: packages/cli/src/pair.ts:61-71 -->                                                                                                  | Enter the code in time. The code path counts as one link against the budget, the same as QR.                                          |
| Restart asks for a QR again                            | `~/.wa-mcp/auth/` was wiped, or the phone removed the device (401 `device_removed` wipes creds by design)                                                                                                                                                                  | Pair again (once). Check Linked devices on the phone.                                                                                 |
| `/api/pair/resume` returns 401 with a pairing token    | Resume was removed from the pairing surface (it resets the budget) <!-- src: packages/bridge/src/http.ts:200-204 -->                                                                                                                                                       | Use the account token or the web UI's token.                                                                                          |

**Recovering from the lockout:**

```sh
# 1. stop everything that might create registrations
wa-mcp stop
# 2. wait out the cooldown (hours; every attempt restarts it)
# 3. start once and pair once
wa-mcp start
wa-mcp pair            # or: wa-mcp pair --code <phone>
# if the daemon stayed up and reports pairingBlocked:
curl -X POST -H "Authorization: Bearer $(cat ~/.wa-mcp/token)" \
  http://127.0.0.1:27777/api/pair/resume
```

## Sends

| Symptom                                        | Cause                                                                                 | Fix                                                                                                                                                         |
| ---------------------------------------------- | ------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------- |
| A send fails with nothing in the log           | Before T56, engine errors were swallowed                                              | Upgrade. The engine error is now logged verbatim (`"send failed"`, level 50) before the 500. <!-- src: packages/bridge/src/http.ts:1366-1371, 1408-1412 --> |
| 429 `RATE_LIMITED` with `retryAfterMs`         | Send pacing: at least 1s between sends                                                | Space sends; honour `retryAfterMs`.                                                                                                                         |
| 429 `RATE_LIMITED` with a `Retry-After` header | Transport bucket (60/min per token)                                                   | Space your requests. See [Diagnostics → rate limits](./diagnostics.md#rate-limits).                                                                         |
| 429 `DAILY_CAP_EXCEEDED`                       | 200 sends per UTC day reached                                                         | Wait for UTC midnight, or set `WA_DAILY_CAP`.                                                                                                               |
| 403 `SENDS_DISABLED`                           | `WA_SENDS_DISABLED=1`                                                                 | Unset it and restart.                                                                                                                                       |
| 429 `SEND_LIMIT_REACHED` with `Retry-After`    | A connection send limit (per minute/hour/day or per chat per day) is reached          | Wait the `Retry-After` seconds, or raise the limit: `wa-mcp settings set --per-day <n>` (or the Connection page).                                           |
| 403 `SEND_BLOCKED`                             | A send rule matches the target, its alias or its LID form                             | `GET /api/send-rules`; delete the rule.                                                                                                                     |
| 400 `INVALID_JID`                              | The recipient can't be resolved                                                       | Use a full jid, `+phone`, or a known alias.                                                                                                                 |
| Reaction stored twice (`[{👍},{👍}]`)          | The send echo and the reaction event both reached ingest                              | Deduplicated since T60; upgrade.                                                                                                                            |
| Poll content empty or `poll_options` missing   | The engine sends `pollCreationMessage`, `…V2` or `…V3` depending on `selectableCount` | Fixed in T58b (all three keys are read and stored); upgrade.                                                                                                |

## Chats and contacts

| Symptom                                                        | Cause                                    | Fix                                                                                                                                                 |
| -------------------------------------------------------------- | ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------- |
| A group shows a contact name, not the subject                  | `groups.upsert` metadata wasn't consumed | Fixed in T62/I: the subject goes into `chats.name` and the roster into `group_participants`. `GET /api/group/info?jid=<group>` refreshes on demand. |
| One person split across a phone-number chat and an `@lid` chat | LID-era addressing                       | Fixed at ingest (canonical phone-number chat, T59). For older rows run `vp run merge-lid-chats`.                                                    |

## Media and engines

| Symptom                                    | Cause                                                                                                                                                         | Fix                                                                                                 |
| ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 422 `ENGINE_NOT_CONFIGURED`                | The selected engine isn't set up. `message` and `setup` contain the setup text. <!-- src: packages/bridge/src/http.ts:2153-2158 -->                           | Follow the `setup` text; run `wa-mcp doctor --engines`.                                             |
| 422 `ENGINE_UNAVAILABLE`                   | The engine's binary is missing or failed to run <!-- src: packages/bridge/src/http.ts:2159-2164 -->                                                           | Install the binary named in the message.                                                            |
| whisper-local fails: model missing         | `WA_WHISPER_MODEL` isn't set, or doesn't point to a file <!-- src: packages/cli/src/doctor.ts:117-134 -->                                                     | Set `WA_WHISPER_MODEL` to a ggml `.bin` path. If the binary is missing: `brew install whisper-cpp`. |
| PDF text extraction fails                  | `pdftotext` isn't installed <!-- src: packages/bridge/src/media/document.ts:101-117 -->                                                                       | `brew install poppler`                                                                              |
| Image text returns `ENGINE_NOT_CONFIGURED` | OCR is off by default (`WA_OCR_ENGINE=none`) <!-- src: packages/bridge/src/media/ocr.ts:11-16 -->                                                             | `brew install tesseract`, then `WA_OCR_ENGINE=tesseract` (and `WA_OCR_LANG` if needed).             |
| Video or audio processing fails            | `ffmpeg` is missing                                                                                                                                           | `brew install ffmpeg` (or point `WA_FFMPEG_BIN` at it)                                              |
| `list_messages` shows no transcripts       | Transcripts exist only after the first transcribe call. They're cached per (chat, message, engine). <!-- src: packages/bridge/src/store/schema.ts:291-302 --> | Call `transcribe_audio` once. Switching engines creates a new cache entry.                          |
| 400 `SSRF_BLOCKED` on a media URL          | The URL resolves to a loopback, private or link-local address                                                                                                 | Use a public URL, or send by `path` / base64.                                                       |

## Subscriptions and inbox

| Symptom                                                               | Cause                                                                                                                                                                              | Fix                                                                  |
| --------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- |
| The inbox file isn't growing                                          | The subscription doesn't match (chats, `%like%` filter, mention-only, disabled) or delivers to a session spool or agent instead <!-- src: packages/bridge/src/subs-dispatch.ts --> | `wa-mcp subs`; then `wa-mcp subs test <id>`.                         |
| The inbox file isn't growing, and `/health.subscriptions.dropped` > 0 | Writes are failing                                                                                                                                                                 | Check disk space and permissions on `~/.wa-mcp/subs/<id>/`.          |
| The inbox file shrank or reset                                        | It rotates to `inbox.1.jsonl` at 2 MB <!-- src: packages/bridge/src/inbox.ts:19-30 -->                                                                                             | Read both files.                                                     |
| Media events missing from the inbox, or false media hits              | Older builds misdetected Baileys proto media                                                                                                                                       | Upgrade (fixed). fixed in T107b (`aca4144`)                          |
| Inbox `text` is cut short                                             | Inbox lines cap `text` at 280 characters <!-- src: packages/bridge/src/inbox.ts:19 -->                                                                                             | Fetch the full message with `list_messages` / `get_message_context`. |

## Web UI

| Symptom                                           | Cause                                                                                | Fix                                                                   |
| ------------------------------------------------- | ------------------------------------------------------------------------------------ | --------------------------------------------------------------------- |
| Stale chats or messages                           | The SSE stream dropped and the page is holding old state                             | Hard reload (Cmd+Shift+R). EventSource reconnects by itself.          |
| Media bubbles render broken                       | The daemon restarted, so the UI token in `?token=` is stale                          | Reload; the UI fetches a new token.                                   |
| `missing or invalid bearer token` on `#/contacts` | `WA_UI_BOOTSTRAP=0` is set and the browser has no stored token                       | Paste the account token into UI settings, or unset `WA_UI_BOOTSTRAP`. |
| 403 `FORBIDDEN_HOST`                              | The UI was opened through a non-loopback hostname (port-forward, LAN IP, custom DNS) | Open `http://127.0.0.1:27777/`. Remote access isn't supported.        |
| The old UI bundle shows after a build             | Browser cache                                                                        | Hard reload; the bridge replaces bundles whose hash changed.          |

## CLI and daemon

| Symptom                                                          | Cause                                                                                                               | Fix                                                                                                  |
| ---------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------- |
| `PORT_IN_USE` from `install --service` or `start`                | A daemon is already listening on that port (T104 port guard) <!-- src: packages/cli/src/bin.ts:153-160, 353-360 --> | `wa-mcp stop`, then retry.                                                                           |
| Bridge unreachable after `install --service`                     | The service failed to start, or another daemon held the port                                                        | `wa-mcp status`; `wa-mcp logs`; `wa-mcp doctor`.                                                     |
| Two daemons fighting (the token changes, pairing attempts climb) | The launchd/systemd service plus a manually started daemon                                                          | Stop the manual one (`wa-mcp stop`) and keep only the service. The port guard blocks new duplicates. |
| `config.json permissions too open`                               | Group or other users can read the file <!-- src: packages/cli/src/config-store.ts:36-45 -->                         | `chmod 600 ~/.wa-mcp/config.json`                                                                    |
| `doctor` reports `bridge token: present but mode …`              | The token file mode isn't 0600 <!-- src: packages/cli/src/doctor.ts:42-57 -->                                       | `chmod 600 ~/.wa-mcp/token`                                                                          |
| The daemon won't start: `node:sqlite` errors                     | Node is older than 26                                                                                               | Upgrade Node.                                                                                        |

---
