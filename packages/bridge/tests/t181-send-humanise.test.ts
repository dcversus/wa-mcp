import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { WASocket } from "baileys";
import { DEFAULT_CONNECTION_SETTINGS, type HumanisationSettings } from "@wa-mcp/shared";
import { openStore, type Store } from "../src/store/schema.ts";
import { saveConnectionSettings } from "../src/store/connection-settings.ts";
import {
  createHumanizer,
  humanDelayMs,
  TYPING_REFRESH_MS,
  type Humanizer,
} from "../src/send/humanize.ts";
import { SendError, sendProtoViaSocket, sendViaSocket } from "../src/send/send.ts";
import { SendGuard } from "../src/send/safety.ts";
import { createEventBus } from "../src/events.ts";
import { createHttpServer, type BridgeHttp } from "../src/http.ts";
import type { BridgeHandle } from "../src/lifecycle.ts";

const DM = "358401112222@s.whatsapp.net";
const OTHER = "358401113333@s.whatsapp.net";
const TOKEN = "t181-send";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  vi.useRealTimers();
  for (const fn of cleanups.splice(0).reverse()) {
    await fn();
  }
});

function makeStore(): Store {
  const dir = mkdtempSync(join(tmpdir(), "t181-send-"));
  const store = openStore(dir);
  cleanups.push(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

function humanOn(overrides: Partial<HumanisationSettings> = {}): HumanisationSettings {
  return {
    ...DEFAULT_CONNECTION_SETTINGS.humanisation,
    enabled: true,
    minDelayMs: 1000,
    maxDelayMs: 5000,
    delayPerCharMs: 100,
    ...overrides,
  };
}

function fakeSocket(log: string[], opts: { presenceFails?: boolean } = {}): WASocket {
  let seq = 0;
  return {
    user: { id: "358497773518:1@s.whatsapp.net" },
    sendMessage: async (jid: string, content: { text?: string }) => {
      seq += 1;
      log.push(`send:${jid}`);
      return {
        key: { id: `SENT${seq}`, remoteJid: jid, fromMe: true },
        message: { conversation: content.text ?? "" },
      };
    },
    relayMessage: async (jid: string) => {
      log.push(`relay:${jid}`);
      return "";
    },
    sendPresenceUpdate: async (type: string, jid: string) => {
      log.push(`presence:${type}:${jid}`);
      if (opts.presenceFails === true) {
        throw new Error("presence offline");
      }
    },
  } as unknown as WASocket;
}

function recordingSleep(log: string[]): (ms: number, signal: AbortSignal) => Promise<void> {
  return async (ms) => {
    log.push(`sleep:${ms}`);
  };
}

test("T181 B1 — humanDelayMs: min + chars × perChar, clamped to [min, max], ±20% jitter", () => {
  const settings = humanOn();
  expect(humanDelayMs(settings, 10, () => 0.5)).toBe(2000);
  expect(humanDelayMs(settings, 10, () => 0)).toBe(1600);
  expect(humanDelayMs(settings, 10, () => 1)).toBe(2400);
  expect(humanDelayMs(settings, 500, () => 0.5)).toBe(5000);
  expect(humanDelayMs(settings, 0, () => 0.5)).toBe(1000);
  expect(humanDelayMs({ ...settings, minDelayMs: 0, maxDelayMs: 0 }, 50, () => 1)).toBe(0);
});

test("T181 B1 — enabled: composing starts immediately, the delay is awaited, paused right before the send", async () => {
  const log: string[] = [];
  const humanizer = createHumanizer({
    settings: () => humanOn(),
    sleep: recordingSleep(log),
    random: () => 0.5,
  });
  const result = await sendViaSocket(fakeSocket(log), DM, { text: "0123456789" }, { humanizer });
  expect(result.messageId).toBe("SENT1");
  expect(log).toEqual([
    `presence:composing:${DM}`,
    "sleep:2000",
    `presence:paused:${DM}`,
    `send:${DM}`,
  ]);
});

test("T181 B1 — long delays refresh the typing indicator; typingStatus off sends no presence", async () => {
  const log: string[] = [];
  const humanizer = createHumanizer({
    settings: () => humanOn({ minDelayMs: 25_000, maxDelayMs: 25_000 }),
    sleep: recordingSleep(log),
    random: () => 0.5,
  });
  await sendViaSocket(fakeSocket(log), DM, { text: "hi" }, { humanizer });
  expect(TYPING_REFRESH_MS).toBe(10_000);
  expect(log).toEqual([
    `presence:composing:${DM}`,
    "sleep:10000",
    `presence:composing:${DM}`,
    "sleep:10000",
    `presence:composing:${DM}`,
    "sleep:5000",
    `presence:paused:${DM}`,
    `send:${DM}`,
  ]);
  const quiet: string[] = [];
  const silent = createHumanizer({
    settings: () => humanOn({ typingStatus: false }),
    sleep: recordingSleep(quiet),
    random: () => 0.5,
  });
  await sendViaSocket(fakeSocket(quiet), DM, { text: "0123456789" }, { humanizer: silent });
  expect(quiet).toEqual(["sleep:2000", `send:${DM}`]);
});

test("T181 B1 — voice notes show 'recording'; captions count as text; reactions, edits, deletes and status skip the delay", async () => {
  const log: string[] = [];
  const humanizer = createHumanizer({
    settings: () => humanOn(),
    sleep: recordingSleep(log),
    random: () => 0.5,
  });
  const socket = fakeSocket(log);
  await sendViaSocket(socket, DM, { audio: Buffer.from("a"), ptt: true } as never, { humanizer });
  await sendViaSocket(socket, DM, { image: Buffer.from("i"), caption: "0123456789" } as never, {
    humanizer,
  });
  expect(log).toEqual([
    `presence:recording:${DM}`,
    "sleep:1000",
    `presence:paused:${DM}`,
    `send:${DM}`,
    `presence:composing:${DM}`,
    "sleep:2000",
    `presence:paused:${DM}`,
    `send:${DM}`,
  ]);
  log.length = 0;
  await sendViaSocket(socket, DM, { react: { key: { id: "X" }, text: "👍" } } as never, {
    humanizer,
  });
  await sendViaSocket(socket, DM, { edit: { id: "X" }, text: "fixed" } as never, { humanizer });
  await sendViaSocket(socket, DM, { delete: { id: "X" } } as never, { humanizer });
  await sendViaSocket(socket, "status@broadcast", { text: "story" }, { humanizer });
  expect(log).toEqual([`send:${DM}`, `send:${DM}`, `send:${DM}`, "send:status@broadcast"]);
});

test("T181 B1 — a failing presence update never fails the send", async () => {
  const log: string[] = [];
  const humanizer = createHumanizer({
    settings: () => humanOn(),
    sleep: recordingSleep(log),
    random: () => 0.5,
  });
  const result = await sendViaSocket(
    fakeSocket(log, { presenceFails: true }),
    DM,
    { text: "x" },
    {
      humanizer,
    },
  );
  expect(result.messageId).toBe("SENT1");
  expect(log.at(-1)).toBe(`send:${DM}`);
});

test("T181 B1 — the proto (buttons/list) path is humanised too", async () => {
  const log: string[] = [];
  const humanizer = createHumanizer({
    settings: () => humanOn(),
    sleep: recordingSleep(log),
    random: () => 0.5,
  });
  await sendProtoViaSocket(
    fakeSocket(log),
    DM,
    { listMessage: { description: "0123456789" } },
    { humanizer },
  );
  expect(log).toEqual([
    `presence:composing:${DM}`,
    "sleep:2000",
    `presence:paused:${DM}`,
    `relay:${DM}`,
  ]);
});

test("T181 B1 — the default sleep really waits (fake timers)", async () => {
  vi.useFakeTimers();
  const log: string[] = [];
  const humanizer = createHumanizer({ settings: () => humanOn(), random: () => 0.5 });
  const pending = sendViaSocket(fakeSocket(log), DM, { text: "0123456789" }, { humanizer });
  await vi.advanceTimersByTimeAsync(1999);
  expect(log).toEqual([`presence:composing:${DM}`]);
  await vi.advanceTimersByTimeAsync(1);
  await pending;
  expect(log).toEqual([`presence:composing:${DM}`, `presence:paused:${DM}`, `send:${DM}`]);
});

test("T181 B1 — close() aborts a pending delay: nothing is sent, typing stops, SHUTTING_DOWN", async () => {
  vi.useFakeTimers();
  const log: string[] = [];
  const humanizer = createHumanizer({ settings: () => humanOn(), random: () => 0.5 });
  const pending = sendViaSocket(fakeSocket(log), DM, { text: "0123456789" }, { humanizer });
  const outcome = pending.catch((err: unknown) => err);
  await vi.advanceTimersByTimeAsync(500);
  humanizer.close();
  const err = (await outcome) as SendError;
  expect(err).toBeInstanceOf(SendError);
  expect(err.code).toBe("SHUTTING_DOWN");
  expect(log).toEqual([`presence:composing:${DM}`, `presence:paused:${DM}`]);
  expect(vi.getTimerCount()).toBe(0);
  const late = await sendViaSocket(fakeSocket(log), DM, { text: "late" }, { humanizer }).catch(
    (error: unknown) => error as SendError,
  );
  expect((late as SendError).code).toBe("SHUTTING_DOWN");
});

test("T181 B3 — disabled humanisation is the zero-delay path: no sleep, no presence, settings read once", async () => {
  const log: string[] = [];
  const settings = vi.fn(() => DEFAULT_CONNECTION_SETTINGS.humanisation);
  const sleep = vi.fn(recordingSleep(log));
  const humanizer = createHumanizer({ settings, sleep });
  expect(humanizer.active()).toBe(false);
  await sendViaSocket(fakeSocket(log), DM, { text: "hello" }, { humanizer });
  expect(log).toEqual([`send:${DM}`]);
  expect(sleep).not.toHaveBeenCalled();
});

test("T181 B2 — limits off (default): the guard behaves exactly as before", () => {
  const store = makeStore();
  const guard = new SendGuard(store, { minIntervalMs: 0, dailyCap: 1000 });
  for (let index = 0; index < 40; index += 1) {
    expect(guard.check(1_000_000 + index, DM)).toEqual({ ok: true });
  }
});

function enableLimits(
  store: Store,
  limits: Partial<typeof DEFAULT_CONNECTION_SETTINGS.sendLimits>,
) {
  saveConnectionSettings(store, {
    ...DEFAULT_CONNECTION_SETTINGS,
    sendLimits: { ...DEFAULT_CONNECTION_SETTINGS.sendLimits, enabled: true, ...limits },
  });
}

test("T181 B2 — per-minute, per-hour and per-day windows refuse with retryAfterMs and a clear message", () => {
  const store = makeStore();
  const guard = new SendGuard(store, { minIntervalMs: 0, dailyCap: 100_000 });
  enableLimits(store, { perMinute: 2, perHour: 3, perDay: 4 });
  const t0 = 10_000_000;
  expect(guard.check(t0, DM).ok).toBe(true);
  expect(guard.check(t0 + 1000, DM).ok).toBe(true);
  expect(guard.check(t0 + 2000, DM)).toEqual({
    ok: false,
    code: "SEND_LIMIT_REACHED",
    window: "minute",
    limit: 2,
    retryAfterMs: 58_000,
    message: "per-minute send limit reached (2)",
  });
  expect(guard.check(t0 + 61_000, DM).ok).toBe(true);
  expect(guard.check(t0 + 200_000, DM)).toMatchObject({
    code: "SEND_LIMIT_REACHED",
    window: "hour",
    limit: 3,
    retryAfterMs: 3_600_000 - 200_000,
    message: "hourly send limit reached (3)",
  });
  expect(guard.check(t0 + 3_601_000, DM).ok).toBe(true);
  expect(guard.check(t0 + 3_700_000, DM)).toMatchObject({
    code: "SEND_LIMIT_REACHED",
    window: "day",
    limit: 4,
    retryAfterMs: 86_400_000 - 3_700_000,
    message: "daily send limit reached (4)",
  });
});

test("T181 B2 — per-chat daily cap applies per chat; release() gives the slot back", () => {
  const store = makeStore();
  const guard = new SendGuard(store, { minIntervalMs: 0, dailyCap: 100_000 });
  enableLimits(store, { perChatPerDay: 2 });
  const t0 = 20_000_000;
  expect(guard.check(t0, DM).ok).toBe(true);
  expect(guard.check(t0 + 1, DM).ok).toBe(true);
  expect(guard.check(t0 + 2, DM)).toMatchObject({
    code: "SEND_LIMIT_REACHED",
    window: "chat-day",
    limit: 2,
    message: "daily send limit for this chat reached (2)",
  });
  expect(guard.check(t0 + 3, OTHER).ok).toBe(true);
  guard.release(t0 + 4);
  expect(guard.check(t0 + 5, OTHER).ok).toBe(true);
  guard.release(t0 + 6);
  guard.release(t0 + 7);
  expect(guard.check(t0 + 8, DM).ok).toBe(true);
});

function stubHandle(socket: WASocket): BridgeHandle {
  return {
    status: "connected",
    events: createEventBus(),
    close: async () => {},
    getLastQr: () => null,
    hasPairedAccount: () => true,
    pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
    resumePairing: () => {},
    connectionQuality: () => ({ reconnects: 0, lastDisconnectAt: null }),
    logout: async () => {},
    fetchHistory: async () => ({ requested: false, request_id: "" }),
    contactsWarm: () => true,
    socket,
  } as unknown as BridgeHandle;
}

async function boot(store: Store, socket: WASocket, humanizer?: Humanizer): Promise<BridgeHttp> {
  const bridge = await createHttpServer(stubHandle(socket), {
    token: TOKEN,
    store,
    sendGuard: new SendGuard(store, { minIntervalMs: 0, dailyCap: 1000 }),
    humanizer,
  });
  cleanups.push(() => bridge.close());
  return bridge;
}

function send(bridge: BridgeHttp, chat: string, text: string): Promise<Response> {
  return fetch(`http://127.0.0.1:${bridge.port}/api/send`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({ chat_jid: chat, text }),
  });
}

test("T181 B2 — POST /api/send: limit refusal is 429 with Retry-After and the message", async () => {
  const store = makeStore();
  enableLimits(store, { perDay: 2, perChatPerDay: 1 });
  const bridge = await boot(store, fakeSocket([]));
  expect((await send(bridge, DM, "one")).status).toBe(200);
  const chatCapped = await send(bridge, DM, "two");
  expect(chatCapped.status).toBe(429);
  expect(Number(chatCapped.headers.get("retry-after"))).toBeGreaterThan(86_000);
  expect(await chatCapped.json()).toMatchObject({
    error: {
      code: "SEND_LIMIT_REACHED",
      message: "daily send limit for this chat reached (1)",
      window: "chat-day",
      limit: 1,
    },
  });
  expect((await send(bridge, OTHER, "three")).status).toBe(200);
  const dayCapped = await send(bridge, "358401114444@s.whatsapp.net", "four");
  expect(dayCapped.status).toBe(429);
  const body = (await dayCapped.json()) as {
    error: { message: string; retryAfterSeconds: number };
  };
  expect(body.error.message).toBe("daily send limit reached (2)");
  expect(body.error.retryAfterSeconds).toBe(Number(dayCapped.headers.get("retry-after")));
});

test("T181 B1 — HTTP and MCP sends share the humanised choke point", async () => {
  const store = makeStore();
  const log: string[] = [];
  const humanizer = createHumanizer({
    settings: () => humanOn(),
    sleep: recordingSleep(log),
    random: () => 0.5,
  });
  const bridge = await boot(store, fakeSocket(log), humanizer);
  expect((await send(bridge, DM, "0123456789")).status).toBe(200);
  const mcp = await fetch(`http://127.0.0.1:${bridge.port}/mcp`, {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 1,
      method: "tools/call",
      params: { name: "send_message", arguments: { chat_jid: OTHER, text: "abc" } },
    }),
  });
  expect(mcp.status).toBe(200);
  expect(log).toEqual([
    `presence:composing:${DM}`,
    "sleep:2000",
    `presence:paused:${DM}`,
    `send:${DM}`,
    `presence:composing:${OTHER}`,
    "sleep:1300",
    `presence:paused:${OTHER}`,
    `send:${OTHER}`,
  ]);
});

test(
  "T181 B1 — closing the server aborts a pending humanised send with 503 and returns its budget",
  { timeout: 15_000 },
  async () => {
    const store = makeStore();
    const log: string[] = [];
    const humanizer = createHumanizer({
      settings: () => humanOn({ minDelayMs: 60_000, maxDelayMs: 60_000 }),
      random: () => 0.5,
    });
    const guard = new SendGuard(store, { minIntervalMs: 0, dailyCap: 1 });
    const bridge = await createHttpServer(stubHandle(fakeSocket(log)), {
      token: TOKEN,
      store,
      sendGuard: guard,
      humanizer,
    });
    const pending = send(bridge, DM, "hello");
    await vi.waitFor(() => expect(log).toEqual([`presence:composing:${DM}`]));
    const started = Date.now();
    await bridge.close();
    const res = await pending;
    expect(Date.now() - started).toBeLessThan(5000);
    expect(res.status).toBe(503);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("SHUTTING_DOWN");
    expect(log).toEqual([`presence:composing:${DM}`, `presence:paused:${DM}`]);
    expect(guard.check(Date.now(), DM).ok).toBe(true);
  },
);
