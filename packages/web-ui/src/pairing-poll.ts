export interface PairingPaneState {
  pane: string;
  qr: string | null;
  code: string | null;
  error: string | null;
  me: string | null;
  attempts: number | null;
}

export function pairingPaneKey(view: PairingPaneState): string {
  return JSON.stringify(view);
}

export function shouldRewritePane(input: {
  nextKey: string;
  prevKey: string | null;
  focused: boolean;
}): boolean {
  return !input.focused && input.prevKey !== input.nextKey;
}

export interface PairingPollHost {
  fetchHealth(): Promise<unknown>;
  derive(health: unknown): PairingPaneState;
  render(view: PairingPaneState, rewrite: boolean): void;
  focused(): boolean;
}

export interface PairingPoller {
  start(): void;
  stop(): void;
  tickForTest(): Promise<void>;
  fetches(): number;
}

export function createPairingPoller(host: PairingPollHost, intervalMs: number): PairingPoller {
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;
  let prevKey: string | null = null;
  let fetchCount = 0;
  async function tick(): Promise<void> {
    if (stopped) {
      return;
    }
    let health: unknown = {};
    try {
      health = await host.fetchHealth();
    } catch {
      health = {};
    }
    fetchCount += 1;
    const view = host.derive(health);
    const key = pairingPaneKey(view);
    const rewrite = shouldRewritePane({ nextKey: key, prevKey, focused: host.focused() });
    prevKey = key;
    host.render(view, rewrite);
  }
  return {
    start(): void {
      if (timer !== null || stopped) {
        return;
      }
      timer = setInterval(() => {
        void tick();
      }, intervalMs);
    },
    stop(): void {
      stopped = true;
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    },
    tickForTest: tick,
    fetches: () => fetchCount,
  };
}
