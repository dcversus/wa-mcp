import type { BridgeLogger } from "./lifecycle.ts";

export interface ShutdownDeps {
  processLike?: {
    on(signal: string, handler: () => void): unknown;
    exit(code: number): void;
  };
  http?: { close(): Promise<void> };
  bridge?: { close(): Promise<void> };
  store?: { close(): void };
  lock?: { release(): void };
  logger?: BridgeLogger;
  forceExitMs?: number;
}

export interface ShutdownHooks {
  stop(reason: string): Promise<void>;
}

export function installShutdownHooks(deps: ShutdownDeps = {}): ShutdownHooks {
  const proc = deps.processLike ?? process;
  const forceExitMs = deps.forceExitMs ?? 3000;
  let stopping = false;
  const stop = async (reason: string): Promise<void> => {
    if (stopping) {
      return;
    }
    stopping = true;
    deps.logger?.info({ reason }, "shutting down");
    const work = (async () => {
      try {
        await deps.http?.close();
        await deps.bridge?.close();
        deps.store?.close();
        deps.lock?.release();
      } catch (err) {
        deps.logger?.error({ err }, "error during shutdown");
      }
    })();
    await Promise.race([
      work,
      new Promise<void>((resolve) => {
        setTimeout(resolve, forceExitMs);
      }),
    ]);
    proc.exit(0);
  };
  for (const signal of ["SIGTERM", "SIGINT"]) {
    proc.on(signal, () => {
      void stop(signal);
    });
  }
  return { stop };
}
