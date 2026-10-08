# TASK: R2-5 — Profile formatting + Connection settings (humanisation, rate limits) (TDD, no commit)

## Canon (owner spec)
docs/raw/2026-10-07-webui-r2-restructure.md:
"Profile page (like now, but formatted), Connection (options to add new
profile, select what would be default for answering, connect new -
QR/phone-code/API-key) + some stats for connection + settings for
connection like it should be some flag to enable humanisation -
answering with delay equal human input with randomness and proper
typing statuses + limit for sending messages total /per chats /per
day/hour for each connection"

## Part A — connection settings model
1. shared: ConnectionSettings { humanisation: { enabled, minDelayMs,
   maxDelayMs, typingStatus: boolean, delayPerCharMs? }, sendLimits:
   { perMinute, perHour, perDay, perChatPerDay? } } with defaults
   (humanisation off; limits: 30/min, 120/hour, 500/day — sane
   WhatsApp-safe defaults, document as anti-ban).
2. Store: connection_settings table (single row per connection id;
   default connection id "default"), CRUD in store layer, defensive
   migration.
3. Bridge: GET/PUT /api/connection-settings (validated: delays >=0,
   min<=max, limits >0, reject absurd values like >1000/min).
   RED: round-trip, validation errors, defaults on empty.

## Part B — humanisation in the send path
In serveSend (and the MCP send path — find the shared choke point):
1. If humanisation.enabled: before sending, compute delay =
   clamp(minDelayMs + text.length * delayPerCharMs, min, max) + jitter
   (±20%). Await the delay. If typingStatus: send presence
   "composing" for the duration (start immediately, stop on send).
   The delay MUST be abortable on shutdown (injectable sleep fn;
   clearTimeout on close — read how the bridge shuts down).
2. Enforce send limits: token bucket per window (minute/hour/day) +
   per-chat daily; when exceeded → 429 with Retry-After and a clear
   error ("daily send limit reached (500)").
3. All of this OFF by default; when off, behavior byte-identical to
   today (existing tests must pass unchanged).
- RED: delay applied (fake timers), typing status toggled, limit 429s
  with retryAfter, per-chat cap, disabled = zero-delay path, shutdown
  aborts pending delay.

## Part C — Profile page formatting
Audit + polish the existing #/profile against wave-4 standards: card
layout, avatar, name/status forms with save feedback, privacy selects
with WhatsApp labels, blocklist with unblock. Nothing new
functionally — formatting pass only. RED: existing profile tests
still green + add snapshot-ish assertions for the new layout pieces.

## Part D — Connection page (rename of current #/status or #/pairing — owner calls it "Connection")
1. Sections: linked status card (exists: Linked as Versus…),
   "Connect new" (QR + phone-code pairing UI — EXISTS from earlier
   waves, verify + link prominently), connection STATS (uptime,
   reconnects, messages sent/received today — query store), SETTINGS
   (the Part A model: humanisation toggle + delay inputs + typing
   toggle; limits inputs; save via PUT).
2. Nav: System group → "Connection" (single entry; #/status redirects
   to it).
- RED: render assertions (settings form bound, stats shown, redirect
  works), router test.

## Part E — CLI
wa-mcp settings get/set (humanisation + limits flags:
--humanise on/off, --min-delay, --max-delay, --typing on/off,
--per-minute, --per-hour, --per-day). RED: flag parsing + API calls.

Report: per-part summary, RED→GREEN list, the exact send-choke-point
files touched, gates.
