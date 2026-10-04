/** T93-C3: e2e preflight primitive — poll a check until it passes or the
 * attempt budget runs out, instead of a fixed sleep that flakes on slow
 * daemons. scripts/webui-e2e.mjs mirrors this loop inline (plain node). */
export async function retryUntil(
  check: () => Promise<boolean>,
  opts: { attempts: number; delayMs: number },
): Promise<boolean> {
  for (let attempt = 0; attempt < opts.attempts; attempt += 1) {
    if (await check()) {
      return true;
    }
    if (attempt < opts.attempts - 1) {
      await new Promise((resolve) => setTimeout(resolve, opts.delayMs));
    }
  }
  return false;
}
