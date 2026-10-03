# Troubleshooting

Real failure modes from the live session, with the actual mechanics.

## Pairing fails: "can't link new devices right now"

WhatsApp's anti-abuse counts EVERY link attempt and the cooldown RESETS on
each attempt. A daemon that re-registers on a timer (QR-pool recovery) keeps
the clock at zero — the lockout deepens. wa-mcp budgets this: after 3
registrations without pairing it stops minting registrations entirely
(`/health.pairingBlocked`) until you `POST /api/pair/resume` or restart.

Do: stop all pairing attempts, wait out the cooldown (hours), restart the
daemon, pair once.

## Reaction/emote stored twice

The send-echo and the reaction event both reach the ingest. Deduped since
T60 — upgrade if you see `[{👍},{👍}]`.

## Poll content empty / poll_options missing

Engine dispatch: `{poll}` input becomes `pollCreationMessage`, `V2` or `V3`
by selectableCount. Fixed in T58b to extract all three keys and write
`poll_options` at storage time.

## Group chats show a contact name instead of the subject

`groups.upsert` metadata is now consumed (T62/I): subject lands in
`chats.name`, the roster in `group_participants`. A `GET
/api/group/info?jid=<group>` fetches fresh metadata on demand.

## Chat split between phone number and @lid (LID-era)

One person, two rows. Fixed at ingest (canonical PN chat, T59 full-jid
contract); run `vp run merge-lid-chats` for the historical rows.

## Sends fail with nothing in the log

Fixed in T56 — send failures log the engine error verbatim before the 500.
If your deployment predates it, upgrade.

## Media bubbles render broken

Media elements authenticate via the ephemeral token in the query string
(T70). If they still break, the daemon restarted mid-session — reload the
page to pick up the fresh token.

## Daemon restart loses pairing

Session persistence is `~/.wa-mcp/auth/` (0700). A restart that asks for QR
again means the auth dir was wiped or the device was removed server-side
(401 device_removed → wa-mcp wipes creds and starts a fresh registration by
design).
