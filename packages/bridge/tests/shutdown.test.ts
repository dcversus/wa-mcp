import { afterEach, expect, test, vi } from "vite-plus/test";
import { installShutdownHooks, type ShutdownDeps } from "../src/shutdown.ts";

type FakeProcess = {
  on: (signal: string, handler: () => void) => void;
  exit: (code: number) => void;
  handlers: Map<string, () => void>;
};

function fakeProcess(): FakeProcess {
  const handlers = new Map<string, () => void>();
  return {
    handlers,
    on: (signal, handler) => {
      handlers.set(signal, handler);
    },
    exit: vi.fn(),
  };
}

function orderedDeps() {
  const order: string[] = [];
  const deps: ShutdownDeps = {
    processLike: undefined,
    http: {
      close: async () => {
        order.push("http");
      },
    },
    bridge: {
      close: async () => {
        order.push("bridge");
      },
    },
    store: {
      close: () => {
        order.push("store");
      },
    },
  };
  return { order, deps };
}

afterEach(() => {
  vi.useRealTimers();
});

test("SIGTERM and SIGINT both get handlers registered", () => {
  const proc = fakeProcess();
  installShutdownHooks({ ...orderedDeps().deps, processLike: proc });
  expect(proc.handlers.has("SIGTERM")).toBe(true);
  expect(proc.handlers.has("SIGINT")).toBe(true);
});

test("stop closes http, bridge, store in order, then exits 0", async () => {
  const proc = fakeProcess();
  const { order, deps } = orderedDeps();
  installShutdownHooks({ ...deps, processLike: proc });
  const handler = proc.handlers.get("SIGTERM");
  if (!handler) throw new Error("SIGTERM handler missing");
  handler();
  await vi.waitFor(() => {
    expect(proc.exit).toHaveBeenCalledWith(0);
  });
  expect(order).toEqual(["http", "bridge", "store"]);
});

test("a second signal does not exit twice", async () => {
  const proc = fakeProcess();
  const { deps } = orderedDeps();
  installShutdownHooks({ ...deps, processLike: proc });
  const handler = proc.handlers.get("SIGTERM");
  if (!handler) throw new Error("SIGTERM handler missing");
  handler();
  await vi.waitFor(() => {
    expect(proc.exit).toHaveBeenCalledTimes(1);
  });
  handler();
  await vi.waitFor(() => {
    expect(proc.exit).toHaveBeenCalledTimes(1);
  });
});

test("stop is directly callable for tests and shutdown hooks", async () => {
  const proc = fakeProcess();
  const { order, deps } = orderedDeps();
  const hooks = installShutdownHooks({ ...deps, processLike: proc });
  await hooks.stop("manual");
  expect(order).toEqual(["http", "bridge", "store"]);
  expect(proc.exit).toHaveBeenCalledWith(0);
});

test("a hanging close forces exit 0 within 3 seconds", async () => {
  vi.useFakeTimers();
  const proc = fakeProcess();
  const hang = () => new Promise<void>(() => {});
  installShutdownHooks({
    processLike: proc,
    http: { close: hang },
    bridge: { close: hang },
    store: { close: () => {} },
  });
  const handler = proc.handlers.get("SIGTERM");
  if (!handler) throw new Error("SIGTERM handler missing");
  handler();
  await vi.advanceTimersByTimeAsync(2999);
  expect(proc.exit).not.toHaveBeenCalled();
  await vi.advanceTimersByTimeAsync(1);
  expect(proc.exit).toHaveBeenCalledWith(0);
});
