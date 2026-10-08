import { ApiError } from "./api.ts";

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
      const serverWait = err instanceof ApiError ? err.retryAfterMs : null;
      const waitMs =
        serverWait !== null ? Math.min(serverWait, opts.delayMs * opts.attempts) : opts.delayMs;
      await new Promise((resolve) => setTimeout(resolve, waitMs));
    }
  }
  return {};
}
