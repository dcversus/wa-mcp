# TASK: fix [object Object] on the Status/health pages

Owner on #/status: "pairingAttempts [object Object]? uptime 912? subscriptions [object Object]" — "not usable at all".

Root cause: `packages/web-ui/src/pages.ts` renders health values with `String(value)` in TWO places:
- `statusDashboardHtml` line ~49 (`<dd>${escapeHtml(String(value))}</dd>`)
- `healthHtml` line ~275 (`<dd>${String(value)}</dd>`)

/health returns nested objects for these keys:
- `pairingAttempts: {used, limit}` → should render like "0 / 3"
- `subscriptions: {count, dropped}` → should render like "0 (0 dropped)"

## Fix
1. Add a shared formatter in pages.ts, e.g. `formatStatValue(value: unknown): string`:
   - boolean → "yes"/"no"
   - null/undefined → "—"
   - object → readable compact form. For the two known keys render semantic strings:
     `pairingAttempts` → `${used} / ${limit}`; `subscriptions` → `${count}${dropped > 0 ? " (" + dropped + " dropped)" : ""}`
     (key-aware: pass the key into the formatter, or special-case before the generic path)
   - any other object → `Object.entries` joined as `k: v, k: v` (never "[object Object]")
   - arrays → comma-joined items (each through the same scalar formatting)
   - scalars → String(value)
2. Use it in BOTH call sites (statusDashboardHtml keeps escapeHtml around the result; healthHtml should ALSO escape — it currently does NOT, fix that too: `escapeHtml(formatStatValue(key, value))`).
3. Keep all ids/classes/selectors unchanged.
4. Also scan pages-pairing.ts + main.ts for any other raw object rendering of health/api data (grep for String( and `${` interpolation of unknown values) and fix the same class if present. The pairing page's "registrations used" row already formats correctly (escapeHtml of a computed string) — verify it stays right.

## TDD (RED first)
In `packages/web-ui/tests/pages.test.ts` (or a new t141-status-format.test.ts):
- statusDashboardHtml with health `{pairingAttempts: {used: 1, limit: 3}, subscriptions: {count: 2, dropped: 0}, connected: true, loggedIn: false, uptime: 912}` → output contains `1 / 3`, `2`, NOT `[object Object]`, contains `yes` (connected) and `no` (loggedIn)
- healthHtml same health → no `[object Object]`, no unescaped raw object
- an unknown object key `{meta: {a: 1, b: "x"}}` → renders `a: 1, b: x`

## Gates (orchestrator re-runs all)
- `npx vitest run packages/web-ui/` green
- `vp check` 0
- `pnpm --filter @wa-mcp/web-ui build` EXIT 0
- No selector changes; version untouched; no comments; do NOT commit — leave for review.
