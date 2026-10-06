import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  createPairingPoller,
  shouldRewritePane,
  type PairingPaneState,
} from "../src/pairing-poll.ts";

afterEach(() => {
  vi.useRealTimers();
});

const PANE: PairingPaneState = {
  pane: "methods",
  qr: "ref",
  code: null,
  error: null,
  me: null,
  attempts: 0,
};

function host(overrides: Partial<Parameters<typeof createPairingPoller>[0]> = {}) {
  let fetches = 0;
  let rewrites = 0;
  let focused = false;
  const h = {
    fetchHealth: async () => {
      fetches += 1;
      return { attempts: fetches };
    },
    derive: (health: unknown) => ({
      ...PANE,
      attempts: (health as { attempts?: number }).attempts ?? 0,
    }),
    render: (_view: PairingPaneState, rewrite: boolean) => {
      if (rewrite) {
        rewrites += 1;
      }
    },
    focused: () => focused,
    ...overrides,
  };
  return {
    host: h,
    fetches: () => fetches,
    rewrites: () => rewrites,
    setFocused: (value: boolean) => {
      focused = value;
    },
  };
}

test("T151 F2 — exactly one health fetch per interval after a minute on the page", async () => {
  vi.useFakeTimers();
  const probe = host();
  const poller = createPairingPoller(probe.host, 3_000);
  poller.start();
  await vi.advanceTimersByTimeAsync(60_000);
  expect(probe.fetches()).toBe(20);
  poller.stop();
});

test("T151 F2 — re-binding the flow never adds a second interval", async () => {
  vi.useFakeTimers();
  const probe = host();
  const poller = createPairingPoller(probe.host, 3_000);
  poller.start();
  poller.start();
  await vi.advanceTimersByTimeAsync(6_000);
  expect(probe.fetches()).toBe(2);
  poller.stop();
});

test("T151 F2 — stop() ends the polling", async () => {
  vi.useFakeTimers();
  const probe = host();
  const poller = createPairingPoller(probe.host, 3_000);
  poller.start();
  await vi.advanceTimersByTimeAsync(3_000);
  poller.stop();
  await vi.advanceTimersByTimeAsync(30_000);
  expect(probe.fetches()).toBe(1);
});

test("T151 F2 — a focused phone form is never rewritten, even when state changes", async () => {
  vi.useFakeTimers();
  const probe = host();
  const poller = createPairingPoller(probe.host, 3_000);
  poller.start();
  probe.setFocused(true);
  await vi.advanceTimersByTimeAsync(9_000);
  expect(probe.fetches()).toBe(3);
  expect(probe.rewrites()).toBe(0);
  poller.stop();
});

test("T151 F2 — an unchanged pane does not rewrite the DOM", async () => {
  let fetches = 0;
  let rewrites = 0;
  const poller = createPairingPoller(
    {
      fetchHealth: async () => {
        fetches += 1;
        return { attempts: 0 };
      },
      derive: () => ({ ...PANE, attempts: 0 }),
      render: (_view, rewrite) => {
        if (rewrite) {
          rewrites += 1;
        }
      },
      focused: () => false,
    },
    3_000,
  );
  await poller.tickForTest();
  await poller.tickForTest();
  expect(fetches).toBe(2);
  expect(rewrites).toBe(1);
});

test("T151 F2 — shouldRewritePane gate", () => {
  expect(shouldRewritePane({ nextKey: "a", prevKey: null, focused: false })).toBe(true);
  expect(shouldRewritePane({ nextKey: "a", prevKey: "a", focused: false })).toBe(false);
  expect(shouldRewritePane({ nextKey: "b", prevKey: "a", focused: true })).toBe(false);
});
