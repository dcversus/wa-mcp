# TASK: AUDIT R1 — D2 Product flow & information architecture (opus, independent, read-only)

You are the INDEPENDENT PRODUCT AUDITOR with fresh eyes. This is
dimension D2 of the campaign (D1 onboarding is done — do NOT re-audit
onboarding; its findings live in review/AUDIT-R1-D1.md and fixes are
in flight).

## Context (all you know)

wa-mcp is a local WhatsApp MCP bridge: a Node daemon (Baileys) serving a
vanilla-JS web UI at http://127.0.0.1:8080 and 74 MCP tools over
stdio/HTTP. Repo: ~/Documents/GitHub/wa-mcp. Daemon LIVE and paired
(owner's real account). The product's REASON TO EXIST: let a local AI
agent read/react to WhatsApp chats.

CAUTION: a fix wave is landing in the worktree for D1 findings (chat
routing, pairing poll, link-state gate, agent-connect step). Audit the
PRODUCT STRUCTURE — pages, IA, flows, copy — which the fixes do not
reshape. Where a D1 finding overlaps (dead controls etc.), note it but
don't re-litigate; focus on what D1 did not cover.

## Your D2 mission

1. **Page inventory.** Enumerate EVERY route the router serves (grep the
   router + nav). For each page: purpose, primary persona (owner vs
   agent-operator — often the same person), does it fulfill its purpose,
   what's missing, what's extraneous. Include pages with no nav entry.
2. **Core jobs end-to-end.** Walk each as a user would (live, careful):
   - Read messages (chats → open → read → search)
   - Send a message (works? feedback? errors?)
   - THE HERO: let MY AGENT react to a chat — subscriptions page →
     enable a chat → get the hook command → understand where events land
     → wire it into a real agent (claude code hook, cron, etc.) → verify
     delivery. Judge the WHOLE path including the parts outside the UI.
     Is it teachable? Where does a user get lost?
   - Manage my profile (name/about/privacy/blocklist)
   - Check health/diagnose
3. **IA analysis.** Nav structure, grouping, ordering. Duplicate paths.
   Missing cross-links (chat → its subscription; contact → its chat;
   group → its participants). Orphan pages (reachable only by URL).
4. **Personas & scenarios.** Define 2-3 concrete personas (e.g. "dev who
     wants agent notifications in claude code", "non-technical partner
     who just wants to read/send from desktop"). For each: top 3 tasks,
     success/failure against the current UI.
5. **The MCP surface as product.** 74 tools exist — does the web UI need
   to surface any of that power (scheduled messages? templates?
   autoreply? newsletters?) or link to docs for it? What's the right
   boundary between UI and MCP tools?

## Tools & rules (same as D1)

- Clean-browser probes: write Playwright scripts in /tmp (fresh
  --user-data-dir). You are multimodal — screenshot and LOOK.
- curl http://127.0.0.1:8080 (token: $(cat ~/.wa-mcp/token), never print).
- Source read: packages/web-ui/src, packages/bridge/src/http.ts,
  packages/mcp-server/src/tools.ts (the 74 tools — the product's
  capability surface).
- Live sends ONLY to Test group 120363428874442773@g.us. Spaced, few.
  No pairing attempts.
- Do not modify repo files. ONLY writes: review/AUDIT-R1-D2.md + /tmp
  probes. No vp test/build/install runs.
- Every finding: severity (P0-P3) + PRODUCT/DEFECT/SECURITY label +
  evidence (repro/file:line/DOM/screenshot) + analysis + fix + effort
  (S/M/L).
- Rate limit approaching → save partial report with "DIMENSION 2 PARTIAL
  — continue from finding <N>" and stop.

## Deliverable

review/AUDIT-R1-D2.md:
  VERDICT (one honest paragraph) · FINDINGS (numbered, severity-sorted) ·
  PAGE-BY-PAGE TABLE (page | purpose | verdict | top gap) ·
  PERSONA SCORECARD · TOP-5 FIXES · WHAT WORKS
  End with exactly "DIMENSION 2 COMPLETE" (or the PARTIAL marker).
