# 2026-10-07 — WebUI R2 restructure requirements (owner, verbatim)

Source: Telegram/TUI message from owner, 2026-10-07. Canon for WebUI round 2.
Unparsed, verbatim, anchor for all R2 tasks.

---

all pages in webui still not polyshed, no padding, strange layout and VERY
confusing page structure. I DONT understand why we need Connect your agent
run one command so your AI agent can use WhatsApp: in different pages. instead
i need to see ACTUAL connections and maybe DOCS with all help and
instructions? Automations looks terible and not usable. I DONT EXPECT THIS
FUNCTIONALITY AT ALL! I NEED SUBSCRIPTIONS (what the fuck is alerts?) and it
should be well formated and structured; EXPECTED WEBUI structure: Logs (ALL
incoming-outcoming events with filters by chat/person/direction/date-time),
Contacts (SHOULD BE exactly REAL names/contacts from my whatsapp, with
ability to add contact or search by username, name, number. SHOULD BE 100%
functionality parity with whatsappweb), Connections (connected agent list,
with shortcat links to logs, disconnect button, status do hooks enabled ot
not and link to Subscriptions), Subscriptions - list of created
subscriptions, each subscription include: chats - with checkbox, some
message filter (with %like%) + some flag to react ONLY when bot itself
mentioned in message) + prompt with which incoming message should be
triggered, option to put message in ANY active session OR specifc session
from list  OR create a new agent with params (and config with CLI path and
params) each time with clean context OR events could be delivered into
inbox.jsonl with some help to use subscription command - list this options,
provide more configuration here; Profile page (like now, but formatted),
Connection (options to add new profile, select what would be default for
answering, connect new - QR/phone-code/API-key) + some stats for connection
+ ssettings for connection like it should be some flag to enable
humanisation -  answering with delay equal human input with randomnes and
proper typing statuses + limit for sending messages total /per chats /per
day/hour for each connection; + HELP page with information how everything
working and guides;  OTHER PAGES SHOULD BE DELETED; Subscriptions should be
configurable via cli, logs should be avaiable via cli, connections should be
manageble via cli, contacts should be avaiable via cli; should be 100% parity
between web ui and cli; all should be well tested and dodocumented, use
cantropic claude for refactoring, clear all the rest and unusable /
unreachable code

---

## Owner clarification (2026-10-07, verbatim — canon)

> how did whatsApp have no API if in web version of whatsapp i am able to
> work with my contacts and see all of them? something is wrong here. API
> exists and it should work as expected

Resolution: owner is RIGHT. Companion-device protocol (which WhatsApp Web
and our Baileys bridge both speak) exposes addOrEditContact/removeContact
via app-state sync actions; contacts.upsert returns
{id, name, username, lid, phoneNumber}. Verified in fork source
(Socket/chats.js addOrEditContact; sync-action-utils.js processContactAction).
Contacts page = TRUE parity with WhatsApp Web, no local-only hacks.

---

## Owner corrections (2026-10-08, verbatim — canon)

> chats page have no sense, list of chats needed only for subscriptions

> Changes sync to your WhatsApp account, like WhatsApp Web. -> this LOOKS
> VERY STRANGE. can we sync in background 1:1 like whatsApp doing it? it
> should be seamless, without separate action

Resolution: (1) Chats page DELETED — a chat list exists only inside the
subscriptions picker; chat detail stays reachable from Contacts/Logs rows.
(2) Contacts sync is ALREADY background (contacts.upsert listener +
addOrEditContact on write + backfill on boot) — the offending copy that
describes sync as if it were an action gets removed; save flows show
plain "Saved" like WhatsApp Web. No separate sync action in the UI.

---

## Owner directive (2026-10-08, verbatim — canon)

> web ui DESIGN looks strange, i need you to point agent use design
> related skills to polish everything, like
>     ✔ high-end-visual-design   user · ~90 tok
>     ✔ minimalist-ui   user · ~50 tok

Resolution: design polish wave (R2-8) executed by the agent with the
user skills high-end-visual-design and minimalist-ui LOADED and
followed (both exist in ~/.claude/skills, also mirrored in
.claude-zai and .claude-shared). wa-mcp WebUI = a utility tool, so
the minimalist-ui protocol (clean editorial, warm monochrome,
typographic contrast) is the primary guide; high-end-visual-design
informs motion/typography quality.

---

## Owner directive (2026-10-08 evening, verbatim — canon)

> we dont need a http://127.0.0.1:8080/#/settings page; at left menu
> regroup everything into two categories: logs, Subscriptions, Agents
> (prev renamed Connections) AND profile, Contacts, Connection, Help.
> no need group header, just more space between groups;

Resolution: (1) #/settings page DELETED — whatever it holds (token
display etc.) moves to Connection page or dies. (2) Nav regrouped into
exactly two visual groups, NO group headers, larger gap between
groups: [Logs, Subscriptions, Agents] + [Profile, Contacts,
Connection, Help]. (3) "Connections" page renamed "Agents".

---

## Owner question + resolution (2026-10-08, verbatim)

> claude mem uses http://127.0.0.1:37777 by default, what port should
> we use as default? need something NOT 8080 or popular, to avoid
> conflicts; make websearch and find out what would be the BEST port
> for us (maybe there is something known for whatsapp mcp already?
> cause at least we positioning ourself as replacement)

Research (websearch + IANA registry CSV + local lsof, 2026-10-08):
- WhatsApp-bridge ecosystem ports: WPPConnect-Server = 21465 (the
  de-facto "WhatsApp HTTP bridge" port, years of usage); WAHA = 3000;
  Evolution API = 8080; lncitador/whatsapp-mcp = 8080 (conflicts);
  Sealjay mcp-whatsapp = 8765; panghy = 13491.
- IANA registry: 21465 UNASSIGNED; 13491 UNASSIGNED; 8765 ASSIGNED
  (ultraseek-http) — avoid 8765.
- Local machine listeners: no 21465/13491 in use; busy: 37777
  (claude-mem), 8080, 8000, 5000, 3000-range dev ports etc.
Decision: DEFAULT PORT = 21465 (WPPConnect's established WhatsApp-
bridge port — signals "WhatsApp bridge" to tooling, unassigned by
IANA, free locally, and replacement-positioning: WPPConnect users
get a drop-in URL). 8080 remains supported via --port/PORT for
existing installs; migration note in docs.

## Port decision update (2026-10-08, owner)

Owner picked 27777 after 424242 (invalid — TCP max 65535) and 21465.
Verified: valid port, IANA-unassigned (27505-27781 block unassigned),
free on this machine. Known user: PowerJob worker (Java scheduler,
mostly China-deployed, rare on macOS dev machines). Adjacent to
claude-mem's 37777 but distinct. ACCEPTED as the new default:
DEFAULT PORT = 27777 (was 8080). 8080 remains supported via
--port/PORT for compatibility; migration note in docs.

---

## Owner complaints (2026-10-08, verbatim — canon)

> http://localhost:27777/#/agents HOW ALL of agents registered, but i
> am not have codex installed? AND View logs should navigate
> me to page with agent filter to see EXACTLY logs related to this
> agent

Facts verified: codex CLI IS installed (/opt/homebrew/bin/codex);
grok/antigravity have ONLY config stubs written by our
platform installer E2E — zero apps in /Applications. Resolution:
R2-12 — installed-detection + 'App not installed' badge + installed-
first sort; agent-dimension logs filter + View-logs → #/logs?agent=.
