/** T93-C3: e2e preflight primitive — poll a check until it passes or the
 * attempt budget runs out, instead of a fixed sleep that flakes on slow
 * daemons. scripts/webui-e2e.mjs mirrors this loop inline (plain node). */
import { ApiError } from "./api.ts";

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

/** T136: the UI boot fetch of /health can meet a drained pairing-surface
 * rate bucket (429) while other tabs hammer it — retry with backoff before
 * giving up, so a fresh session still bootstraps. Returns {} only after the
 * attempt budget is spent. */
export async function healthWithRetry(
  client: { getHealth(): Promise<Record<string, unknown>> },
  opts: { attempts: number; delayMs: number },
): Promise<Record<string, unknown>> {
  for (let attempt = 0; attempt < opts.attempts; attempt += 1) {
    try {
      return await client.getHealth();
    } catch (err) {
      const rateLimited = err instanceof ApiError && err.status === 429;
      if (!rateLimited || attempt === opts.attempts - 1) {
        return {};
      }
      const waitMs =
        err instanceof ApiError && err.retryAfterMs !== null ? err.retryAfterMs : opts.delayMs;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  return {};
}
