# TASK: R2-8 — DESIGN POLISH (design skills mandated by owner)

## Canon (owner, verbatim)
> web ui DESIGN looks strange, i need you to point agent use design
> related skills to polish everything, like
>     ✔ high-end-visual-design   user · ~90 tok
>     ✔ minimalist-ui   user · ~50 tok

## MANDATE — load the design skills FIRST
This task REQUIRES the user skills. Before touching any CSS:
1. Read ~/.claude/skills/minimalist-ui/SKILL.md — PRIMARY guide
   (wa-mcp is a utility tool: clean editorial, warm monochrome,
   typographic contrast, generous whitespace).
2. Read ~/.claude/skills/high-end-visual-design/SKILL.md — informs
   typography quality, motion choreography, anti-patterns.
Follow their protocols. Where they conflict, minimalist-ui wins (this
is a tool UI, not a marketing site). NO code rewrites — this wave is
styles.css + page markup classes only, behavior untouched.

## Constraints
- Vanilla TS SPA, ONE stylesheet (packages/web-ui/src/styles.css) +
  inline SVG icons already in use. NO new dependencies, no webfonts
  from CDN (system font stack with typographic tuning is fine — pick
  a premium-feeling native stack, e.g. ui-serif display + system
  sans body, per the skills' typography guidance).
- Both light and dark themes exist — keep both, tune both.
- Zero behavior changes: same routes, handlers, tests. Only visual.
- Existing test classes/ids MUST keep working (tests target
  ids/classes/strings — grep the test files for class selectors
  before renaming anything; if a rename is needed, update tests in
  the same wave).
- Emoji: minimalist-ui bans emoji in UI. Current UI uses a few (✅ in
  status card, ⬇⬆ in logs). Replace with inline SVG or typographic
  marks — update the tests that pin them.

## The polish pass (all pages)
1. TOKENS: rebuild CSS custom properties — spacing scale, type scale
   (clamp-based), radii, borders (hairlines, not gray boxes),
   shadows (layered, subtle), warm monochrome palette + one accent.
2. LAYOUT: consistent page container + max-width, vertical rhythm,
   section spacing, card system (single style, not per-page one-offs),
   nav refinement (calmer, more compact, active state via accent).
3. TYPOGRAPHY: hierarchy (h1 vs section vs body vs meta), tabular
   nums for times/counts, letter-spacing on labels/eyebrows.
4. COMPONENTS: buttons (primary/secondary/danger — consistent
   heights, focus rings), inputs (unified), tables (logs) → cleaner
   row rhythm, badges (direction, delivery mode, status) as small
   typographic chips, empty states (icon + one line), skeleton
   loaders already exist — align their look.
5. MOTION (high-end skill): subtle 150-250ms transitions on
   hover/focus/state changes, no linear timing, respect
  prefers-reduced-motion.
6. DENSITY: this is a data tool — comfortable but efficient. Logs
   and contacts rows tighter than marketing spacing.

## Process
1. Load both skills (mandate above).
2. Audit current styles.css + every page fn markup (pages.ts,
   logs.ts, contacts.ts, subscriptions, connection, help, profile).
3. One coherent pass — not per-page experiments. Keep the CSS
   organized: tokens → base → layout → components → pages → motion.
4. Run FULL gates: vp check 0, vp test green (fix pinned strings
   where emoji removed), webui-e2e green.
5. Report: what the skills changed concretely (fonts, palette,
   spacing, motion decisions), per-page summary, gates.

## Report format
Per the campaign standard: summary + gates + anything the skills
mandated that you deliberately skipped and why.
