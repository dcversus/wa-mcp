import type { SendLimits } from "@wa-mcp/shared";
import { getConnectionSettings } from "../store/connection-settings.ts";
import type { Store } from "../store/schema.ts";

export type LimitWindow = "minute" | "hour" | "day" | "chat-day";

export interface LimitRefusal {
  ok: false;
  code: "SEND_LIMIT_REACHED";
  window: LimitWindow;
  limit: number;
  retryAfterMs: number;
  message: string;
}

export type GuardVerdict =
  | { ok: true }
  | { ok: false; code: "RATE_LIMITED"; retryAfterMs: number }
  | { ok: false; code: "DAILY_CAP_EXCEEDED"; cap: number }
  | LimitRefusal;

const MINUTE_MS = 60_000;
const HOUR_MS = 3_600_000;
const DAY_MS = 86_400_000;

const WINDOW_LABELS: Record<LimitWindow, string> = {
  minute: "per-minute send limit",
  hour: "hourly send limit",
  day: "daily send limit",
  "chat-day": "daily send limit for this chat",
};

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
  private limits(): SendLimits | null {
    try {
      const limits = getConnectionSettings(this.store).sendLimits;
      return limits.enabled ? limits : null;
    } catch {
      return null;
    }
  }

  private windowRefusal(
    now: number,
    window: LimitWindow,
    spanMs: number,
    limit: number,
    chatJid?: string,
  ): LimitRefusal | null {
    const scope = chatJid === undefined ? "" : " AND chat_jid = ?";
    const params: Array<number | string> =
      chatJid === undefined ? [now - spanMs] : [now - spanMs, chatJid];
    const row = this.store.db
      .prepare(`SELECT COUNT(*) AS n FROM send_log WHERE ts > ?${scope}`)
      .get(...params) as { n: number };
    const count = Number(row.n);
    if (count < limit) {
      return null;
    }
    const oldest = this.store.db
      .prepare(`SELECT ts FROM send_log WHERE ts > ?${scope} ORDER BY ts ASC LIMIT 1 OFFSET ?`)
      .get(...params, count - limit) as { ts: number };
    return {
      ok: false,
      code: "SEND_LIMIT_REACHED",
      window,
      limit,
      retryAfterMs: Math.max(Number(oldest.ts) + spanMs - now, 1),
      message: `${WINDOW_LABELS[window]} reached (${limit})`,
    };
  }

  private limitRefusal(now: number, chatJid: string | undefined): LimitRefusal | null {
    const limits = this.limits();
    if (limits === null) {
      return null;
    }
    return (
      this.windowRefusal(now, "minute", MINUTE_MS, limits.perMinute) ??
      this.windowRefusal(now, "hour", HOUR_MS, limits.perHour) ??
      this.windowRefusal(now, "day", DAY_MS, limits.perDay) ??
      (limits.perChatPerDay !== null && chatJid !== undefined
        ? this.windowRefusal(now, "chat-day", DAY_MS, limits.perChatPerDay, chatJid)
        : null)
    );
  }

  private logSend(now: number, chatJid: string | undefined): void {
    try {
      this.store.db.prepare("DELETE FROM send_log WHERE ts <= ?").run(now - DAY_MS);
      this.store.db
        .prepare("INSERT INTO send_log (ts, chat_jid) VALUES (?, ?)")
        .run(now, chatJid ?? null);
    } catch {
      return;
    }
  }

  check(now: number, chatJid?: string): GuardVerdict {
    if (this.sentToday(now) >= this.dailyCap) {
      return { ok: false, code: "DAILY_CAP_EXCEEDED", cap: this.dailyCap };
    }
    if (this.lastSendAt !== null) {
      const elapsed = now - this.lastSendAt;
      if (elapsed < this.minIntervalMs) {
        return { ok: false, code: "RATE_LIMITED", retryAfterMs: this.minIntervalMs - elapsed };
      }
    }
    const refusal = this.limitRefusal(now, chatJid);
    if (refusal !== null) {
      return refusal;
    }
    this.lastSendAt = now;
    this.addSent(now);
    this.logSend(now, chatJid);
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
    try {
      this.store.db.prepare("DELETE FROM send_log WHERE id = (SELECT MAX(id) FROM send_log)").run();
    } catch {
      return;
    }
  }
}
