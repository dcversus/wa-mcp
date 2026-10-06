# TASK: AUDIT R1 — D3 Quality assurance deep manual (opus, independent)

You are the INDEPENDENT QA AUDITOR. Dimension D3 of the campaign. D1
(onboarding) and D2 (product flow) are done — their findings live in
review/AUDIT-R1-D1.md and review/AUDIT-R1-D2.md. Do NOT re-audit those;
focus on QA surfaces they did not cover.

## Context
wa-mcp: local WhatsApp MCP bridge, vanilla-JS web UI at
http://127.0.0.1:8080, repo ~/Documents/GitHub/wa-mcp, daemon LIVE and
paired (owner's account). Fix waves for D1/D2 are landing in the
worktree — audit what you SEE live; where a known D1/D2 finding explains
a defect, reference it instead of re-reporting.

## Your D3 mission — deep manual QA

1. **Control sweep.** Every control on every page: click/submit/toggle
   each one. Does it do what its label says? Log every dead, misleading,
   or partially-working control WITH a live observation (not code-only).
   Known-dead from D1/D2: chat rows, search, archived toggle, group
   participant buttons, transcribe — verify current state after fixes.
2. **State sweep.** Exercise and screenshot: empty states, loading
   states, error states (stop the daemon: `launchctl unload
   ~/Library/LaunchAgents/com.wa-mcp.bridge.plist` then reload after;
   bad token in localStorage; rate-limit 429 by bursting), offline
   (network off), half-loaded (throttle). RESTORE the daemon after.
3. **Forms & keyboard.** Every form: validation (empty, too long,
   invalid), error display, focus after submit, Enter-submits. Tab order
   sanity. Escape behavior.
4. **Content robustness.** Long names (200 chars), long messages,
   unicode/emoji (Russian, Arabic, emoji-only), many chats (does the
   list virtualize or lag?). Use harmless existing data where possible;
   live sends ONLY to Test group 120363428874442773@g.us.
5. **Consistency audit.** Spacing, font sizes, button styles,
   capitalization, label tense, date/time formats — enumerate
   inconsistencies with file:line. Compare against styles.css tokens.
6. **Copy audit.** Every user-facing string: is it human? List all
   developer-speak ("bearer token", "JID", "kinds", "bridge") with
   file:line and a proposed human rewrite.
7. **Accessibility quick pass.** alt/aria where present, focus visible,
   contrast eyeball, keyboard reachability of primary actions.

## Rules
- Live-first: observations from a clean-browser Playwright probe in /tmp
  (fresh --user-data-dir). You are multimodal — screenshot and LOOK.
- Evidence per finding: severity P0-P3 + DEFECT/PRODUCT/SECURITY + live
  repro + screenshot/DOM + fix + effort S/M/L.
- Daemon restore is MANDATORY after any stop (launchctl load + verify
  /health 200 + connected:true).
- No repo modification. ONLY writes: review/AUDIT-R1-D3.md + /tmp.
- Rate limit near → save partial with "DIMENSION 3 PARTIAL — continue
  from finding <N>", stop.

## Deliverable
review/AUDIT-R1-D3.md: VERDICT · FINDINGS (severity-sorted) ·
CONSISTENCY TABLE · COPY REWRITE TABLE · TOP-5 FIXES · WHAT WORKS.
End "DIMENSION 3 COMPLETE" (or PARTIAL marker).
