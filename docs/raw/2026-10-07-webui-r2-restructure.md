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
