# TASK: AUDIT R1 — D1 First-run onboarding (opus, independent, read-only)

You are the INDEPENDENT PRODUCT AUDITOR with fresh eyes. You have never
seen this app. This is dimension D1 (onboarding) of a 4-dimension audit
campaign. Other dimensions come later — do NOT audit them now.

## Context (all you know)

wa-mcp is a local WhatsApp MCP bridge: a Node daemon (Baileys) serving a
vanilla-JS web UI at http://127.0.0.1:8080 and 74 MCP tools over
stdio/HTTP. Repo: ~/Documents/GitHub/wa-mcp. The daemon is LIVE and paired
(real WhatsApp account, owner's). The product's REASON TO EXIST: let a
local AI agent read/react to WhatsApp chats.

Your job: find out whether onboarding works, with evidence. Do NOT try to
confirm any prior verdict — falsify it if you can. If something works
well, say so.

## Your D1 mission

Pretend you just installed. You ARE a new user who knows what WhatsApp is
but nothing about MCP, JIDs, tokens, or bridges.

1. Start at http://127.0.0.1:8080 with a CLEAN browser profile (no
   localStorage — clear it first or use an incognito context in your
   screenshot tool).
2. Answer with evidence (screenshots + DOM excerpts):
   - What do you see? Is it obvious WHAT this app is and WHAT to do first?
   - Is there a guided path: unpaired → QR scan → first chat → first
     subscription? Where does it break, dead-end, or assume knowledge?
   - What jargon leaks (JIDs, tokens, kinds, bridge URLs)?
   - What would a non-engineer do at each step? What would they never find?
   - How do native WhatsApp / Telegram Desktop / Signal onboard (from
     memory is fine)? What does this app do worse, what better?
   - Define the IDEAL first-5-minutes flow, then gap-analyze against reality.

NOTE: the daemon is ALREADY PAIRED — you cannot see the true unpaired
state live. Simulate it: (a) read the code path for unpaired
(pages-pairing.ts, main.ts syncPairingToken flow), (b) use curl on
/health to see what an unpaired daemon returns, (c) CLEAR localStorage
and observe what the UI does with no stored token while paired (this is
what a fresh browser hits). Reason carefully about what changes when the
daemon is unpaired vs paired.

## Tools you can use

- Screenshots: write a Playwright script in /tmp (npx playwright may need
  install — use `npx -y playwright@latest screenshot <url> <out.png>` or
  a small script with chromium). You are multimodal — LOOK at the pages.
- Live probes: curl http://127.0.0.1:8080 (token: $(cat ~/.wa-mcp/token)
  — NEVER print the token value).
- Source: packages/web-ui/src/{pages.ts,main.ts,api.ts,state.ts,styles.css,
  pages-pairing.ts}, packages/bridge/src/http.ts.
- Harness: node scripts/webui-dogfood.mjs (all-route DOM dump).
- CAREFUL MODE ABSOLUTE: live sends ONLY to Test group
  120363428874442773@g.us. No pairing attempts. No re-registration.

## Method rules

- EVIDENCE OR IT DIDN'T HAPPEN: every finding = severity (P0 broken core
  flow / P1 confusing secondary / P2 polish / P3 nice-to-have) + exact
  repro or file:line + screenshot/DOM excerpt + one-paragraph analysis +
  concrete fix recommendation + effort (S/M/L).
- Label each finding PRODUCT / DEFECT / SECURITY.
- You may write ONLY these files: review/AUDIT-R1-D1.md (your report) and
  throwaway probes/screenshots in /tmp. Nothing else. No repo edits.
- Do not run vp test/builds/installs. Git read-only + live probes + /tmp
  scripts only.
- When you hit your rate limit: write what you have so far to the report
  file, end with "DIMENSION 1 PARTIAL — continue from finding <N>", and
  stop cleanly. The orchestrator re-dispatches you.

## Deliverable

review/AUDIT-R1-D1.md:
  VERDICT: one honest paragraph, product-perspective
  FINDINGS: numbered, sorted by severity
  TOP-5 FIXES: if only five things could be fixed, which five and why
  WHAT WORKS: what's genuinely good (be fair)
  End with exactly: "DIMENSION 1 COMPLETE" (or the PARTIAL marker).
