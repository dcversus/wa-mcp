# TASK: WebUI design upgrade — modern, compact, light

Owner verdict on the current UI: "it looks like a mess without proper paddings with strange float checkboxes". Target: modern, compact, light. This is 0.1.0 polish — no behavior changes, no new routes, no new dependencies (stay plain CSS, no framework).

## Scope (files)
- `packages/web-ui/src/styles.css` — full rewrite of the design system
- `packages/web-ui/src/pages.ts` / `pages-pairing.ts` / `app.ts` — ONLY markup class/structure tweaks needed to carry the new design (keep all ids, data-* attributes, form names, and hook snippets EXACTLY — tests depend on them)
- `packages/web-ui/tests/styles.test.ts` + any drift tests — update expectations to the new design tokens

## Design requirements
1. LIGHT theme by default: near-white background (#f7f8fa or similar), white surfaces, soft borders (#e4e7ec), dark text (#1a1d23). Keep a coherent token set in :root (like the current --bg/--surface/--border/--text set, light values).
2. MODERN: Inter/system-ui font stack, 13-14px base (compact), subtle shadows (0 1px 2px rgba(16,24,40,.06)), 8px radius, consistent 4/8/12/16 spacing scale, uppercase 11px letter-spaced section labels where labels exist.
3. COMPACT: reduce vertical padding everywhere (nav items, list rows, form gaps). Sidebar stays 200px max; content max-width 860px unchanged.
4. CHECKBOXES (the owner's specific complaint): no floating checkboxes. Use proper check rows: `display:flex; align-items:center; gap:8px` label rows with `accent-color` matching the accent; no default browser float behavior. Style checkbox+text as one pill/row.
5. Forms: consistent input styling (border, focus ring with accent, 36px height, 100% width inside labels for text inputs; inline for checkboxes). Buttons: primary (accent) + secondary (ghost/border) variants.
6. Lists (chats, subscriptions): row hover state, aligned two-line layout (name + preview), monospace for jids/inbox paths stays.
7. Nav: clean sidebar with brand row ("wa-mcp" + version), grouped links, active state = accent text + left bar, not just background.
8. Keep ALL existing ids/classes that tests or scripts query: #nav, #app, #chats-page, .chat-list, li[data-jid], #chat-search, #subscription-form, #subscription-list, .subscription-row, #settings-form, #events-feed, #status-dashboard, pages-pairing ids (phone-form etc.), error banners, hashchange routing — the webui-e2e and dogfood scripts must stay green.

## Constraints (non-negotiable)
- TDD: update/extend styles.test.ts FIRST (design tokens exist, light values, check-row class) → RED → implement → GREEN. Run: `npx vitest run packages/web-ui/` then `vp check` then `pnpm --filter @wa-mcp/web-ui build`.
- Zero comments in source (styles.css section headers like `/* ---- x ---- */` are allowed, they exist today).
- Do NOT touch: api.ts, main.ts loaders, preflight.ts, app.ts routing logic (markup shell in app.ts renderFrame is OK to restyle), any bridge/CLI code.
- No dependency changes.
- Version stays 0.1.0. Conventional commit: `feat(web-ui): light compact redesign — ...`

## Acceptance (the orchestrator will verify all of this)
1. `npx vitest run packages/web-ui/` green (including updated styles tests)
2. `vp check` 0 errors
3. `pnpm --filter @wa-mcp/web-ui build` EXIT 0
4. visual: no floated checkboxes anywhere; light bg; compact spacing (spot-check via served HTML)
5. webui-e2e + webui-dogfood still PASS (I run them on the live daemon after redeploy)
6. All test-queried selectors intact (mechanical grep)
