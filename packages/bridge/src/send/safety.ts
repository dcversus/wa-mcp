import type { Store } from "../store/schema.ts";

export type GuardVerdict =
  | { ok: true }
  | { ok: false; code: "RATE_LIMITED"; retryAfterMs: number }
  | { ok: false; code: "DAILY_CAP_EXCEEDED"; cap: number };

export interface SendGuardOptions {
  minIntervalMs?: number;
  dailyCap?: number;
}

const DEFAULT_MIN_INTERVAL_MS = 1000;
const DEFAULT_DAILY_CAP = 200;

function dayKey(now: number): string {
  return new Date(now).toISOString().slice(0, 10);
}

export class SendGuard {
  private readonly store: Store;
  private readonly minIntervalMs: number;
  private readonly dailyCap: number;
  private lastSendAt: number | null = null;

  constructor(store: Store, opts: SendGuardOptions = {}) {
    this.store = store;
    this.minIntervalMs = opts.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
    this.dailyCap = opts.dailyCap ?? DEFAULT_DAILY_CAP;
  }

  private metaKey(now: number): string {
    return `send_count:${dayKey(now)}`;
  }

  private sentToday(now: number): number {
    const row = this.store.db
      .prepare("SELECT value FROM meta WHERE key = ?")
      .get(this.metaKey(now)) as { value: string | null } | undefined;
    if (row === undefined || row.value === null) {
      return 0;
    }
    const parsed = Number(row.value);
    return Number.isFinite(parsed) ? parsed : 0;
  }

  private addSent(now: number): void {
    const next = this.sentToday(now) + 1;
    this.store.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(this.metaKey(now), String(next));
  }

  /** T94-E H2 (RUNTIME review): check() RESERVES atomically — a pure read
   * let N parallel callers all pass a budget of 1. A failed send calls
   * release() to give the reservation back. */
  check(now: number): GuardVerdict {
    if (this.sentToday(now) >= this.dailyCap) {
      return { ok: false, code: "DAILY_CAP_EXCEEDED", cap: this.dailyCap };
    }
    if (this.lastSendAt !== null) {
      const elapsed = now - this.lastSendAt;
      if (elapsed < this.minIntervalMs) {
        return { ok: false, code: "RATE_LIMITED", retryAfterMs: this.minIntervalMs - elapsed };
      }
    }
    this.lastSendAt = now;
    this.addSent(now);
    return { ok: true };
  }

  /** give one reservation back after a failed send (floor 0). Rate pacing
   * stays consumed — conservative, never over-sends. */
  release(now: number): void {
    const next = Math.max(this.sentToday(now) - 1, 0);
    this.store.db
      .prepare(
        "INSERT INTO meta (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      )
      .run(this.metaKey(now), String(next));
  }
}
