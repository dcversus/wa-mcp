# Web UI dogfood findings — 2026-10-03 (post-T65 build, live daemon, 10 routes)

Method: scripts/webui-dogfood.mjs — headless Chrome over CDP, per-route DOM + console + network capture. Zero console errors, zero failed requests, all routes render. Evidence: 2026-10-03-webui-routes.json.

## Critical UX gaps (owner: "too raw, not satisfy expectations")

| # | Severity | Route | Finding |
|---|----------|-------|---------|
| 1 | High | #/contacts | Page is COMPLETELY EMPTY: no contact rows, no empty-state text, no add/search affordance. API has /api/contacts + alias mgmt. |
| 2 | High | #/chats, #/chat/:jid | Message send form missing from chat view? (verify — buttons list shows context/download per message but no visible send affordance in top-8) |
| 3 | High | chat list rows | Name+time+preview crammed into one text line ("Test group408:31") — no layout, no avatars, no unread badges visible |
| 4 | High | #/events | Route dead ("not found") — no events/SSE feed page despite events-feed.ts module existing |
| 5 | Med | #/nonexistent | Bare "not found" — no link home, no guidance |
| 6 | Med | #/profile | Privacy matrix limited to read-receipts (all/none) — GOAL wants group/last-seen/status-addressee etc. |
| 7 | Med | #/groups | No subject/description editing (API exists: /api/group/meta), no participant view (API exists: /api/group/info) |
| 8 | Low | all | No avatars anywhere (imgCount=0) — WhatsApp UI convention missing |
| 9 | Low | #/chats | "show archived" toggle present but archived chats untested |
| 10 | Low | #/settings | Token field labeled "(optional — the UI uses the daemon's ephemeral token automatically)" — good, matches T54 design |

## Ready-to-publish checklist derived (owner demand: tested for every use case)
- E2E happy paths: open → chats → open chat → send text → see own message → receive reply (live SSE) → mark read
- Pairing happy path: fresh daemon → QR → paired → lands in chats
- Contacts: list, search, alias set/see
- Groups: create → send → leave; subject edit; participants list
- Media: image in chat renders; download works
- Error states: daemon down (bridge unreachable banner), 401 (auto re-auth), invalid route (home link)
- Empty states: every list page (chats/contacts/groups) with human text, not blank
