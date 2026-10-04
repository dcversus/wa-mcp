import { mkdtemp, readFile } from "node:fs/promises";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import pino from "pino";

vi.mock("baileys", () => ({
  makeWASocket: vi.fn(),
  useMultiFileAuthState: vi.fn(),
  initAuthCreds: vi.fn(() => ({ advSecretKey: "fresh", registrationId: 1 })),
  jidDecode: (jid: string) => {
    const [userPart = "", server = ""] = jid.split("@");
    const [pureUser, device] = userPart.split(":");
    return { user: pureUser, server, device };
  },
  jidEncode: (user: string, server: string, device?: string) =>
    device !== undefined ? `${user}:${device}@${server}` : `${user}@${server}`,
  proto: {
    Message: {
      ProtocolMessage: {
        Type: { REVOKE: 0, MESSAGE_EDIT: 14, EPHEMERAL_SETTING: 3, STATUS_MENTION_MESSAGE: 4 },
      },
    },
  },
  DisconnectReason: { loggedOut: 401, restartRequired: 515, connectionClosed: 428 },
}));

import { DisconnectReason, makeWASocket, useMultiFileAuthState } from "baileys";
import type { AuthenticationState, UserFacingSocketConfig, WASocket } from "baileys";
import { EVENT_NAMES, type WaEvent } from "../src/events.ts";
import { openStore } from "../src/store/schema.ts";
import { addAutoreplyRule } from "../src/store/autoreply.ts";
import { listChats, listMessages } from "../src/store/queries.ts";
import type { WAMessage } from "baileys";
import { startBridge, type BridgeLogger, type StartBridgeOptions } from "../src/lifecycle.ts";

// handles started per test; afterEach closes them so no real reconnect
// timer outlives its test and fires inside a later one
const LIVE_HANDLES: Array<{ close(): Promise<void>; resumePairing(): void }> = [];
async function trackedStart(...args: Parameters<typeof startBridge>) {
  const handle = await startBridge(...args);
  LIVE_HANDLES.push(handle);
  return handle;
}

const mockMakeWASocket = vi.mocked(makeWASocket);
const mockAuthState = vi.mocked(useMultiFileAuthState);
const mockSaveCreds = vi.fn(async () => {});
let currentCreds: Record<string, unknown>;

type EvListener = (payload: unknown) => void;

function fakeSocket() {
  const listeners = new Map<string, EvListener[]>();
  const ev = {
    on: (name: string, listener: EvListener) => {
      const list = listeners.get(name) ?? [];
      list.push(listener);
      listeners.set(name, list);
    },
    emit: (name: string, payload: unknown) => {
      for (const listener of listeners.get(name) ?? []) {
        listener(payload);
      }
    },
    // the real Baileys ev is an EventEmitter — resume teardown detaches
    removeAllListeners: (name?: string) => {
      if (name === undefined) {
        listeners.clear();
      } else {
        listeners.delete(name);
      }
    },
  };
  return { ev, end: vi.fn(), emit: ev.emit, listeners };
}

function boomLike(statusCode: number): Error {
  return Object.assign(new Error(`boom ${statusCode}`), { output: { statusCode } });
}

async function started() {
  const sock = fakeSocket();
  mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
  const handle = await trackedStart("/tmp/wa-mcp-test-auth", { logger: pino({ level: "silent" }) });
  return { sock, handle };
}

beforeEach(() => {
  vi.clearAllMocks();
  currentCreds = {};
  mockSaveCreds.mockImplementation(async () => {});
  mockAuthState.mockResolvedValue({
    // creds object mirrors the real AuthenticationState shape; tests that
    // simulate a completed pairing set creds.account on it
    state: { creds: currentCreds } as unknown as AuthenticationState,
    saveCreds: mockSaveCreds,
  });
});

afterEach(() => {
  vi.useRealTimers();
  // every started handle leaks a real reconnect timer until closed; a timer
  // firing mid-test (coverage slows the suite enough to expose it) flips
  // status to "reconnecting" in later tests
  for (const handle of LIVE_HANDLES.splice(0)) {
    try {
      void handle.close();
    } catch {
      // already-closed handles are fine; the timer is what matters
    }
  }
});

function multiSocketArrangement() {
  const sockets: ReturnType<typeof fakeSocket>[] = [];
  mockMakeWASocket.mockImplementation(() => {
    const sock = fakeSocket();
    sockets.push(sock);
    return sock as unknown as WASocket;
  });
  const latest = () => {
    const sock = sockets[sockets.length - 1];
    if (!sock) {
      throw new Error("no socket was created");
    }
    return sock;
  };
  return { sockets, latest };
}

async function startArranged(extra: StartBridgeOptions = {}) {
  const arrangement = multiSocketArrangement();
  // default the helper's budget high: only budget-contract tests opt into 3
  const handle = await trackedStart("/tmp/wa-mcp-test-auth", {
    logger: pino({ level: "silent" }),
    pairingAttemptLimit: 1_000_000,
    ...extra,
  });
  return { ...arrangement, handle };
}

function closeEvent(code: number) {
  return { connection: "close", lastDisconnect: { error: boomLike(code), date: new Date() } };
}

test(
  "reconnects with exponential backoff after a non-logout close",
  { timeout: 15_000 },
  async () => {
    vi.useFakeTimers();
    const { latest, handle } = await startArranged();
    latest().emit("connection.update", closeEvent(428));
    expect(handle.status).toBe("reconnecting");
    await vi.advanceTimersByTimeAsync(999);
    expect(mockMakeWASocket).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(mockMakeWASocket).toHaveBeenCalledTimes(2);
    latest().emit("connection.update", closeEvent(428));
    await vi.advanceTimersByTimeAsync(1999);
    expect(mockMakeWASocket).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(mockMakeWASocket).toHaveBeenCalledTimes(3);
  },
);

test("backoff caps at 60 seconds", { timeout: 15_000 }, async () => {
  vi.useFakeTimers();
  const { latest } = await startArranged();
  for (let attempt = 0; attempt < 6; attempt += 1) {
    latest().emit("connection.update", closeEvent(428));
    await vi.advanceTimersByTimeAsync(60_000);
  }
  expect(mockMakeWASocket).toHaveBeenCalledTimes(7);
  latest().emit("connection.update", closeEvent(428));
  await vi.advanceTimersByTimeAsync(59_000);
  expect(mockMakeWASocket).toHaveBeenCalledTimes(7);
  await vi.advanceTimersByTimeAsync(1_000);
  expect(mockMakeWASocket).toHaveBeenCalledTimes(8);
});

test(
  "logged out wipes creds and starts a fresh registration (T45B contract)",
  { timeout: 15_000 },
  async () => {
    vi.useFakeTimers();
    const { latest, handle } = await startArranged();
    latest().emit("connection.update", closeEvent(DisconnectReason.loggedOut));
    expect(handle.status).toBe("logged-out");
    expect(handle.hasPairedAccount()).toBe(false);
    await vi.advanceTimersByTimeAsync(120_000);
    // dead creds are never retried: the new socket is a fresh registration
    expect(mockMakeWASocket).toHaveBeenCalledTimes(2);
  },
);

test("a successful connect resets the backoff attempt counter", { timeout: 15_000 }, async () => {
  vi.useFakeTimers();
  const { latest } = await startArranged();
  latest().emit("connection.update", closeEvent(428));
  await vi.advanceTimersByTimeAsync(1_000);
  latest().emit("connection.update", { connection: "open" });
  latest().emit("connection.update", closeEvent(428));
  await vi.advanceTimersByTimeAsync(999);
  expect(mockMakeWASocket).toHaveBeenCalledTimes(2);
  await vi.advanceTimersByTimeAsync(1);
  expect(mockMakeWASocket).toHaveBeenCalledTimes(3);
});

test("close() cancels a pending reconnect", { timeout: 15_000 }, async () => {
  vi.useFakeTimers();
  const { latest, handle } = await startArranged();
  latest().emit("connection.update", closeEvent(428));
  await handle.close();
  await vi.advanceTimersByTimeAsync(120_000);
  expect(mockMakeWASocket).toHaveBeenCalledTimes(1);
});

test("WA_DEVICE_NAME overrides the browser device name", async () => {
  process.env.WA_DEVICE_NAME = "dc-bridge";
  try {
    const sock = fakeSocket();
    mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
    await trackedStart("/tmp/wa-mcp-test-auth", {});
    const call = mockMakeWASocket.mock.calls[0];
    if (!call) throw new Error("makeWASocket was not called");
    expect((call[0] as UserFacingSocketConfig).browser).toEqual(["dc-bridge", "chrome", "0.9.0"]);
  } finally {
    delete process.env.WA_DEVICE_NAME;
  }
});

test("opts.deviceName beats WA_DEVICE_NAME", async () => {
  process.env.WA_DEVICE_NAME = "dc-bridge";
  try {
    const sock = fakeSocket();
    mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
    await trackedStart("/tmp/wa-mcp-test-auth", { deviceName: "explicit-name" });
    const call = mockMakeWASocket.mock.calls[0];
    if (!call) throw new Error("makeWASocket was not called");
    expect((call[0] as UserFacingSocketConfig).browser).toEqual([
      "explicit-name",
      "chrome",
      "0.9.0",
    ]);
  } finally {
    delete process.env.WA_DEVICE_NAME;
  }
});

test("startBridge builds auth state from the store dir and sockets with fixed options", async () => {
  const logger = pino({ level: "silent" });
  const sock = fakeSocket();
  mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
  await trackedStart("/tmp/wa-mcp-test-auth", { logger });
  expect(mockAuthState).toHaveBeenCalledWith("/tmp/wa-mcp-test-auth");
  const call = mockMakeWASocket.mock.calls[0];
  if (!call) throw new Error("makeWASocket was not called");
  const config = call[0] as UserFacingSocketConfig;
  expect(config.printQRInTerminal).toBe(false);
  expect(config.syncFullHistory).toBe(false);
  expect(config.browser).toEqual(["wa-mcp", "chrome", "0.9.0"]);
  const authResult = await mockAuthState.mock.results[0]?.value;
  expect(config.auth).toEqual(authResult?.state);
  // T79 line48: the socket gets a conflict-aware WRAPPER that delegates to it
  expect(config.logger).toBeDefined();
  expect(config.logger).not.toBe(logger);
});

test("syncFullHistory passes through from opts", async () => {
  const sock = fakeSocket();
  mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
  await trackedStart("/tmp/wa-mcp-test-auth", { syncFullHistory: true });
  const call = mockMakeWASocket.mock.calls[0];
  if (!call) throw new Error("makeWASocket was not called");
  expect((call[0] as UserFacingSocketConfig).syncFullHistory).toBe(true);
});

test("browser descriptor passes through from opts", async () => {
  const sock = fakeSocket();
  mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
  await trackedStart("/tmp/wa-mcp-test-auth", { browser: ["wa-mcp", "desktop", "1.2.3"] });
  const call = mockMakeWASocket.mock.calls[0];
  if (!call) throw new Error("makeWASocket was not called");
  expect((call[0] as UserFacingSocketConfig).browser).toEqual(["wa-mcp", "desktop", "1.2.3"]);
});

test("status starts connecting and tracks qr and connected", async () => {
  const { sock, handle } = await started();
  expect(handle.status).toBe("connecting");
  sock.emit("connection.update", { connection: "connecting" });
  expect(handle.status).toBe("connecting");
  sock.emit("connection.update", { connection: "connecting", qr: "QRDATA" });
  expect(handle.status).toBe("qr");
  sock.emit("connection.update", { connection: "open" });
  expect(handle.status).toBe("connected");
});

test("close event maps to reconnecting unless logged out", async () => {
  const { sock, handle } = await started();
  sock.emit("connection.update", {
    connection: "close",
    lastDisconnect: { error: boomLike(428), date: new Date() },
  });
  expect(handle.status).toBe("reconnecting");
  sock.emit("connection.update", {
    connection: "close",
    lastDisconnect: { error: boomLike(DisconnectReason.loggedOut), date: new Date() },
  });
  expect(handle.status).toBe("logged-out");
});

test("close event with a plain error still means reconnecting", async () => {
  const { sock, handle } = await started();
  sock.emit("connection.update", {
    connection: "close",
    lastDisconnect: { error: new Error("Connection Closed"), date: new Date() },
  });
  expect(handle.status).toBe("reconnecting");
});

test("close() ends the socket", async () => {
  const { sock, handle } = await started();
  await handle.close();
  expect(sock.end).toHaveBeenCalledWith(undefined);
});

test("socket events forward onto the bus as typed events", async () => {
  const { sock, handle } = await started();
  const seen: WaEvent[] = [];
  handle.events.subscribe((event) => seen.push(event));
  sock.emit("messages.upsert", { messages: [], type: "notify" });
  expect(seen.map((event) => event.type)).toEqual(["messages.upsert"]);
  expect(seen[0]?.payload).toEqual({ messages: [], type: "notify" });
});

test("all engine events forward through the bus", async () => {
  const { sock, handle } = await started();
  const seen: WaEvent[] = [];
  handle.events.subscribe((event) => seen.push(event));
  const payloads: Record<string, unknown> = {
    "connection.update": { connection: "open" },
    "messages.upsert": { messages: [], type: "notify" },
    "message-receipt.update": [],
    "presence.update": { id: "x", presences: {} },
    "chats.update": [],
    "chats.upsert": [],
    "contacts.upsert": [],
    "groups.update": [],
    "group-participants.update": { id: "g", author: "a", participants: [], action: "add" },
    call: [],
    "creds.update": {},
  };
  for (const name of EVENT_NAMES) {
    sock.emit(name, payloads[name]);
  }
  expect(seen.map((event) => event.type)).toEqual([...EVENT_NAMES]);
});

test("credentials updates persist through the serialized save chain", async () => {
  const saveCreds = vi.fn(async () => {});
  mockAuthState.mockResolvedValue({
    state: { creds: {} } as unknown as AuthenticationState,
    saveCreds,
  });
  const sock = fakeSocket();
  mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
  await trackedStart("/tmp/wa-mcp-test-auth", {});
  sock.emit("creds.update", { noiseKey: "rotated" });
  // the save is chained (never interleaved): flush the microtask queue
  await vi.waitFor(() => expect(saveCreds).toHaveBeenCalled());
});

test("getLastQr is null before any qr event", async () => {
  const { handle } = await started();
  expect(handle.getLastQr()).toBeNull();
});

test(
  "qr events render stderr, persist png, and expose getLastQr",
  { timeout: 15_000 },
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "wa-mcp-qr-"));
    const pngPath = join(dir, "qr.png");
    const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    try {
      const sock = fakeSocket();
      mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
      const handle = await trackedStart("/tmp/wa-mcp-test-auth", { qrPngPath: pngPath });
      sock.emit("connection.update", { connection: "connecting", qr: "QRDATA-rotation-1" });
      expect(handle.status).toBe("qr");
      expect(handle.getLastQr()).toBe("QRDATA-rotation-1");
      expect(stderrSpy).toHaveBeenCalled();
      const written = stderrSpy.mock.calls.map((call) => String(call[0])).join("");
      expect(written).toContain("#");
      await vi.waitFor(
        async () => {
          const bytes = await readFile(pngPath);
          expect(bytes.length).toBeGreaterThan(100);
        },
        { timeout: 10_000, interval: 100 },
      );
    } finally {
      stderrSpy.mockRestore();
    }
  },
);

test("qr rotations update getLastQr", async () => {
  const { sock, handle } = await started();
  sock.emit("connection.update", { connection: "connecting", qr: "QRDATA-rotation-1" });
  sock.emit("connection.update", { connection: "connecting", qr: "QRDATA-rotation-2" });
  expect(handle.getLastQr()).toBe("QRDATA-rotation-2");
});

test("qr pool exhaustion reconnects and reissues a qr", { timeout: 15_000 }, async () => {
  vi.useFakeTimers();
  const { latest, handle } = await startArranged();
  for (let round = 0; round < 3; round += 1) {
    latest().emit("connection.update", { connection: "connecting", qr: `QR-ROUND-${round}` });
    latest().emit("connection.update", closeEvent(428));
    await vi.advanceTimersByTimeAsync(60_000);
  }
  latest().emit("connection.update", { connection: "connecting", qr: "QR-FINAL" });
  expect(handle.status).toBe("qr");
  expect(handle.getLastQr()).toBe("QR-FINAL");
});

test(
  "hasPairedAccount is false before any completed pairing (T44)",
  { timeout: 15_000 },
  async () => {
    const { latest, handle } = await startArranged();
    expect(handle.hasPairedAccount()).toBe(false);
    latest().emit("connection.update", closeEvent(428));
    expect(handle.status).toBe("reconnecting");
    expect(handle.hasPairedAccount()).toBe(false);
  },
);

test(
  "515 restart-required reconnects immediately despite saturated backoff (T45A)",
  { timeout: 15_000 },
  async () => {
    vi.useFakeTimers();
    const { sockets, latest } = await startArranged();
    // 3 saturated rounds put the pending ordinary backoff at 8s (> 5s window)
    for (let round = 0; round < 3; round += 1) {
      latest().emit("connection.update", { connection: "connecting", qr: `QR-SAT-${round}` });
      latest().emit("connection.update", closeEvent(428));
      await vi.advanceTimersByTimeAsync(60_000);
    }
    const socketsBefore = sockets.length;
    const savesBefore = mockSaveCreds.mock.calls.length;
    latest().emit("connection.update", closeEvent(515));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sockets.length).toBe(socketsBefore + 1);
    expect(mockSaveCreds.mock.calls.length).toBeGreaterThan(savesBefore);
    // exactly ONE immediate reconnect: no further socket may appear
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets.length).toBe(socketsBefore + 1);
  },
);

test(
  "device_removed 401 wipes creds, persists, and re-registers (T45B)",
  { timeout: 15_000 },
  async () => {
    vi.useFakeTimers();
    const { sockets, latest, handle } = await startArranged();
    currentCreds.account = { details: new Uint8Array() };
    currentCreds.me = { id: "358497773518@s.whatsapp.net", name: "Versus" };
    expect(handle.hasPairedAccount()).toBe(true);
    const socketsBefore = sockets.length;
    latest().emit("connection.update", closeEvent(401));
    expect(handle.status).toBe("logged-out");
    expect(handle.hasPairedAccount()).toBe(false);
    // flush the save chain first, so the re-registration timer is observable
    await vi.advanceTimersByTimeAsync(0);
    expect(mockSaveCreds).toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(sockets.length).toBe(socketsBefore + 1);
    latest().emit("connection.update", { connection: "connecting", qr: "QR-FRESH" });
    expect(handle.status).toBe("qr");
    expect(handle.getLastQr()).toBe("QR-FRESH");
    // exactly ONE re-registration: a long window must not mint another socket
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets.length).toBe(socketsBefore + 1);
  },
);

test(
  "duplicate close events in a burst produce exactly one re-registration (T45 hardening)",
  { timeout: 15_000 },
  async () => {
    vi.useFakeTimers();
    const { sockets, latest } = await startArranged();
    const socketsBefore = sockets.length;
    // real 401s arrive as a burst: stream-error close + ws close
    latest().emit("connection.update", closeEvent(401));
    latest().emit("connection.update", closeEvent(401));
    latest().emit("connection.update", closeEvent(428));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets.length).toBe(socketsBefore + 1);
  },
);

test(
  "stops re-registering after the pairing attempt budget is exhausted (T46)",
  { timeout: 15_000 },
  async () => {
    vi.useFakeTimers();
    const { sockets, latest, handle } = await startArranged({ pairingAttemptLimit: 3 });
    // attempts 2 and 3: qr-pool auto-recovery minting new registrations
    for (const round of [0, 1]) {
      latest().emit("connection.update", { connection: "connecting", qr: `QR-BUDGET-${round}` });
      latest().emit("connection.update", closeEvent(408));
      await vi.advanceTimersByTimeAsync(60_000);
    }
    expect(sockets.length).toBe(3);
    expect(handle.pairingBudget()).toEqual({ blocked: false, used: 3, limit: 3 });
    // a 4th registration must be refused outright
    latest().emit("connection.update", closeEvent(408));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets.length).toBe(3);
    expect(handle.status).toBe("pairing-blocked");
    expect(handle.pairingBudget()).toEqual({ blocked: true, used: 3, limit: 3 });
    // no new QR either: the last QR is still the pre-block one
    expect(handle.getLastQr()).toBe("QR-BUDGET-1");
  },
);

test(
  "within-attempt qr rotations do not consume the budget (T46)",
  { timeout: 15_000 },
  async () => {
    vi.useFakeTimers();
    const { latest, handle } = await startArranged({ pairingAttemptLimit: 3 });
    for (const rotation of [0, 1, 2]) {
      latest().emit("connection.update", { connection: "connecting", qr: `QR-ROT-${rotation}` });
    }
    expect(handle.pairingBudget()).toEqual({ blocked: false, used: 1, limit: 3 });
  },
);

test(
  "515 reconnect after a real pairing does not consume the budget (T46)",
  { timeout: 15_000 },
  async () => {
    vi.useFakeTimers();
    const { sockets, latest, handle } = await startArranged({ pairingAttemptLimit: 3 });
    currentCreds.account = { details: new Uint8Array() };
    expect(handle.hasPairedAccount()).toBe(true);
    const socketsBefore = sockets.length;
    latest().emit("connection.update", closeEvent(515));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(sockets.length).toBe(socketsBefore + 1);
    expect(handle.pairingBudget()).toEqual({ blocked: false, used: 0, limit: 3 });
  },
);

test(
  "resumePairing resets the budget and re-enters the cycle (T46)",
  { timeout: 15_000 },
  async () => {
    vi.useFakeTimers();
    const { sockets, latest, handle } = await startArranged({ pairingAttemptLimit: 3 });
    for (const round of [0, 1]) {
      latest().emit("connection.update", { connection: "connecting", qr: `QR-RES-${round}` });
      latest().emit("connection.update", closeEvent(408));
      await vi.advanceTimersByTimeAsync(60_000);
    }
    latest().emit("connection.update", closeEvent(408));
    await vi.advanceTimersByTimeAsync(60_000);
    expect(handle.status).toBe("pairing-blocked");
    handle.resumePairing();
    // the resume connect is itself the first attempt of the fresh budget
    expect(handle.pairingBudget()).toEqual({ blocked: false, used: 1, limit: 3 });
    await vi.advanceTimersByTimeAsync(60_000);
    expect(sockets.length).toBe(4);
    expect(handle.status).toBe("connecting");
  },
);

test(
  "strips stale pairing fields on boot so registration + rotation work (T48)",
  { timeout: 15_000 },
  async () => {
    currentCreds.me = { id: "9999999999@s.whatsapp.net", name: "~" };
    currentCreds.pairingCode = "ABCD-1234";
    mockMakeWASocket.mockReturnValue(fakeSocket() as unknown as WASocket);
    const savesBefore = mockSaveCreds.mock.calls.length;
    await trackedStart("/tmp/wa-mcp-test-auth", { logger: pino({ level: "silent" }) });
    expect(currentCreds.me).toBeUndefined();
    expect(currentCreds.pairingCode).toBeUndefined();
    expect(mockSaveCreds.mock.calls.length).toBeGreaterThan(savesBefore);
  },
);

test(
  "keeps me on a genuinely paired session (515 login branch intact, T48)",
  { timeout: 15_000 },
  async () => {
    currentCreds.account = { details: new Uint8Array() };
    currentCreds.me = { id: "358497773518@s.whatsapp.net", name: "Versus" };
    mockMakeWASocket.mockReturnValue(fakeSocket() as unknown as WASocket);
    await trackedStart("/tmp/wa-mcp-test-auth", { logger: pino({ level: "silent" }) });
    expect(currentCreds.me).toBeDefined();
  },
);

test(
  "a saveCreds failure is logged as an error, not swallowed (T48)",
  { timeout: 15_000 },
  async () => {
    const errorSpy = vi.fn();
    const sock = fakeSocket();
    mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
    mockSaveCreds.mockRejectedValueOnce(new Error("disk full"));
    await trackedStart("/tmp/wa-mcp-test-auth", {
      logger: { error: errorSpy } as unknown as BridgeLogger,
    });
    sock.emit("creds.update", { routingInfo: new Uint8Array() });
    await vi.waitFor(() => expect(errorSpy).toHaveBeenCalled(), { timeout: 5_000 });
  },
);

describe("T55 live ingestion", { timeout: 15_000 }, () => {
  function makeMsg(id: string, text: string, fromMe = false): WAMessage {
    return {
      key: { remoteJid: "15551234567@s.whatsapp.net", fromMe, id },
      message: { conversation: text },
      messageTimestamp: 1700000000,
      pushName: "V",
    } as unknown as WAMessage;
  }

  test("messages.upsert (notify) persists the message + chat row", async () => {
    vi.useFakeTimers();
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-ing-")));
    const { latest } = await startArranged({ store });
    latest().emit("messages.upsert", { messages: [makeMsg("m1", "hello live")], type: "notify" });
    const rows = listMessages(store, { chatJid: "15551234567@s.whatsapp.net", limit: 10 });
    expect(rows.some((row) => row.id === "m1" && row.content === "hello live")).toBe(true);
    const chats = listChats(store, {});
    expect(chats.some((chat) => chat.jid === "15551234567@s.whatsapp.net")).toBe(true);
  });

  test("messages.upsert (append) persists history-style batches", async () => {
    vi.useFakeTimers();
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-ing2-")));
    const { latest } = await startArranged({ store });
    latest().emit("messages.upsert", {
      messages: [makeMsg("m2", "one"), makeMsg("m3", "two", true)],
      type: "append",
    });
    expect(listMessages(store, { chatJid: "15551234567@s.whatsapp.net", limit: 10 }).length).toBe(
      2,
    );
  });

  test("messaging-history.set bulk-persists inside one transaction", async () => {
    vi.useFakeTimers();
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-ing3-")));
    const { latest } = await startArranged({ store });
    latest().emit("messaging-history.set", {
      chats: [{ id: "15551234567@s.whatsapp.net", name: "History Chat" }],
      contacts: [],
      messages: [makeMsg("h1", "old one"), makeMsg("h2", "old two"), makeMsg("h3", "old three")],
    });
    expect(listMessages(store, { chatJid: "15551234567@s.whatsapp.net", limit: 10 }).length).toBe(
      3,
    );
    const chats = listChats(store, {});
    expect(
      chats.some(
        (chat) => chat.jid === "15551234567@s.whatsapp.net" && chat.name === "History Chat",
      ),
    ).toBe(true);
  });

  test("media messages persist their media_type metadata", async () => {
    vi.useFakeTimers();
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-ing4-")));
    const { latest } = await startArranged({ store });
    latest().emit("messages.upsert", {
      messages: [
        {
          key: { remoteJid: "15551234567@s.whatsapp.net", fromMe: false, id: "img1" },
          message: {
            imageMessage: {
              caption: "pic",
              url: "https://mm.example/x",
              mediaKey: new Uint8Array(1),
            },
          },
          messageTimestamp: 1700000001,
        } as unknown as WAMessage,
      ],
      type: "notify",
    });
    const rows = listMessages(store, { chatJid: "15551234567@s.whatsapp.net", limit: 10 });
    expect(rows.find((row) => row.id === "img1")?.mediaType).toBe("image");
  });
});

function withLidMapping(socket: object, pnForLid: Record<string, string>): void {
  // engine-style: getPNForLID keyed by the FULL @lid jid; getLIDForPN by the
  // FULL @s.whatsapp.net jid (fork lid-mapping isPnUser/isLidUser checks)
  Object.assign(socket, {
    signalRepository: {
      lidMapping: {
        getPNForLID: async (lid: string) => pnForLid[lid] ?? null,
        getLIDForPN: async (pn: string) => pnForLid[pn] ?? null,
      },
    },
  });
}

describe("T58 ingest normalization", { timeout: 15_000 }, () => {
  test("messageTimestamp in MILLISECONDS stores the correct instant (T58a)", async () => {
    vi.useFakeTimers();
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-t58a-")));
    const { latest } = await startArranged({ store });
    latest().emit("messages.upsert", {
      messages: [
        {
          key: { remoteJid: "15551234567@s.whatsapp.net", fromMe: false, id: "ms1" },
          message: { conversation: "ms units" },
          messageTimestamp: 1_760_000_000_000,
        } as unknown as WAMessage,
      ],
      type: "notify",
    });
    const rows = listMessages(store, { chatJid: "15551234567@s.whatsapp.net", limit: 5 });
    expect(rows[0]?.timestamp.startsWith("2025")).toBe(true);
  });

  test("LID-keyed incoming messages store under the canonical PN chat (T58b)", async () => {
    vi.useFakeTimers();
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-t58b-")));
    const { latest } = await startArranged({ store });
    withLidMapping(latest(), {
      "55600000009854@lid": "351930017568:0@s.whatsapp.net",
    });
    latest().emit("messages.upsert", {
      messages: [
        {
          key: { remoteJid: "55600000009854@lid", fromMe: false, id: "lid1" },
          message: { conversation: "from the lid" },
          messageTimestamp: 1_760_000_000,
        } as unknown as WAMessage,
      ],
      type: "notify",
    });
    await vi.advanceTimersByTimeAsync(0); // drain the async canonicalization chain
    const rows = listMessages(store, { chatJid: "351930017568@s.whatsapp.net", limit: 5 });
    expect(rows.some((row) => row.id === "lid1" && row.content === "from the lid")).toBe(true);
    const lidRows = listMessages(store, { chatJid: "55600000009854@lid", limit: 5 });
    expect(lidRows.length).toBe(0);
  });
});

describe("T59 canonical full-jid mapping", { timeout: 15_000 }, () => {
  test("canonicalChatJid resolves a device-suffixed PN and strips the device", async () => {
    vi.useFakeTimers();
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-t59-")));
    const { latest } = await startArranged({ store });
    withLidMapping(latest(), {
      // engine style: keyed by the FULL @lid jid, returns a device-suffixed PN
      "55600000009854@lid": "351930017568:0@s.whatsapp.net",
    });
    latest().emit("messages.upsert", {
      messages: [
        {
          key: { remoteJid: "55600000009854@lid", fromMe: false, id: "t59a" },
          message: { conversation: "device test" },
          messageTimestamp: 1_760_000_000,
        } as unknown as WAMessage,
      ],
      type: "notify",
    });
    await vi.advanceTimersByTimeAsync(0);
    const rows = listMessages(store, { chatJid: "351930017568@s.whatsapp.net", limit: 5 });
    expect(rows.some((row) => row.id === "t59a")).toBe(true);
    const leaked = listMessages(store, { chatJid: "351930017568:0@s.whatsapp.net", limit: 5 });
    expect(leaked.length).toBe(0);
  });
});

describe("T62/I groups.upsert persistence", { timeout: 15_000 }, () => {
  test("groups.upsert writes the subject into chats.name and participants rows", async () => {
    vi.useFakeTimers();
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-gups-")));
    const { latest } = await startArranged({ store });
    console.log("T62I groups.upsert registered:", latest().listeners.has("groups.upsert"));
    latest().emit("groups.upsert", [
      {
        id: "120363428874442773@g.us",
        subject: "The Test Group",
        owner: "358497773518@s.whatsapp.net",
        participants: [
          { id: "358497773518@s.whatsapp.net", admin: "superadmin" },
          { id: "351930017568@s.whatsapp.net" },
        ],
      },
    ] as never);
    await vi.advanceTimersByTimeAsync(0);
    const allChats = store.db.prepare("SELECT jid, name FROM chats").all();
    console.log("T62I ALL chats:", JSON.stringify(allChats));
    const parts = store.db.prepare("SELECT * FROM group_participants").all();
    console.log("T62I participants:", JSON.stringify(parts));
    const chats = listChats(store, {});
    expect(
      chats.some(
        (chat) => chat.jid === "120363428874442773@g.us" && chat.name === "The Test Group",
      ),
    ).toBe(true);
    const participants = store.db
      .prepare("SELECT jid, admin FROM group_participants WHERE group_jid = ? ORDER BY jid")
      .all("120363428874442773@g.us") as Array<{ jid: string; admin: string | null }>;
    expect(participants).toEqual([
      { jid: "351930017568@s.whatsapp.net", admin: null },
      { jid: "358497773518@s.whatsapp.net", admin: "superadmin" },
    ]);
  });
});

test("T76 H4: the socket config wires getMessage so the fork can decode poll votes", async () => {
  const sock = fakeSocket();
  mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
  await trackedStart("/tmp/wa-mcp-test-auth", {});
  const call = mockMakeWASocket.mock.calls[0];
  if (!call) throw new Error("makeWASocket was not called");
  const config = call[0] as UserFacingSocketConfig;
  expect(typeof config.getMessage).toBe("function");
});

describe("T76 H7 — contact + roster events are consumed, not discarded", () => {
  test("contacts.upsert persists contact rows", async () => {
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-h7-contacts-")));
    const sock = fakeSocket();
    mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
    await trackedStart("/tmp/wa-mcp-test-auth", { store });
    sock.emit("contacts.upsert", [
      { id: "358497773518@s.whatsapp.net", name: "Vasilisa", notify: "V" },
      { id: "120363428874442773@g.us" },
    ]);
    const rows = store.db.prepare("SELECT * FROM contacts").all();
    expect(rows).toHaveLength(2);
    const first = store.db
      .prepare("SELECT * FROM contacts WHERE jid = ?")
      .get("358497773518@s.whatsapp.net") as Record<string, unknown>;
    expect(first.name).toBe("Vasilisa");
    store.close();
  });

  test("group-participants.update applies add and remove to the roster", async () => {
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-h7-roster-")));
    const sock = fakeSocket();
    mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
    await trackedStart("/tmp/wa-mcp-test-auth", { store });
    const group = "120363428874442773@g.us";
    sock.emit("group-participants.update", {
      id: group,
      participants: [{ id: "358497773518@s.whatsapp.net", admin: null }],
      action: "add",
    });
    let jids = (
      store.db
        .prepare("SELECT jid FROM group_participants WHERE group_jid = ?")
        .all(group) as Array<{ jid: string }>
    ).map((r) => r.jid);
    expect(jids).toEqual(["358497773518@s.whatsapp.net"]);
    sock.emit("group-participants.update", {
      id: group,
      participants: [{ id: "358497773518@s.whatsapp.net" }],
      action: "remove",
    });
    jids = (
      store.db
        .prepare("SELECT jid FROM group_participants WHERE group_jid = ?")
        .all(group) as Array<{ jid: string }>
    ).map((r) => r.jid);
    expect(jids).toEqual([]);
    store.close();
  });
});

test("T76 H1 — resumePairing ends the live socket before minting a new one", async () => {
  const first = fakeSocket();
  const second = fakeSocket();
  mockMakeWASocket.mockReturnValueOnce(first as unknown as WASocket);
  await trackedStart("/tmp/wa-mcp-test-auth", {});
  expect(mockMakeWASocket.mock.calls).toHaveLength(1);
  mockMakeWASocket.mockReturnValueOnce(second as unknown as WASocket);
  const handle = LIVE_HANDLES[LIVE_HANDLES.length - 1];
  if (handle === undefined) throw new Error("no live handle");
  handle.resumePairing();
  // the OLD socket must be ended — resume must not stack a second socket
  // (RED today: the old socket keeps running alongside the new one)
  expect(first.end).toHaveBeenCalledTimes(1);
  expect(mockMakeWASocket.mock.calls).toHaveLength(2);
  await handle.close();
});

describe("T79 — connection robustness", () => {
  test("line49 — reconnects/lastDisconnectAt tracked after a forced reconnect", async () => {
    const sock = fakeSocket();
    mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
    const handle = await trackedStart("/tmp/wa-mcp-test-auth", {});
    sock.emit("connection.update", {
      connection: "close",
      lastDisconnect: { error: { output: { statusCode: 428 } } },
    });
    sock.emit("connection.update", { connection: "connecting" });
    sock.emit("connection.update", { connection: "open" });
    const quality = handle.connectionQuality();
    expect(quality.reconnects).toBe(1);
    expect(quality.lastDisconnectAt).not.toBeNull();
    await handle.close();
  });

  test("line50 — 3 consecutive failures fire ONE alert (env threshold)", async () => {
    process.env.WA_RECONNECT_ALERT_N = "3";
    const warns: string[] = [];
    const sock = fakeSocket();
    mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
    const handle = await trackedStart("/tmp/wa-mcp-test-auth", {
      logger: {
        error: () => undefined,
        warn: (obj: unknown, msg?: unknown) => warns.push(String(msg ?? obj)),
      } as unknown as BridgeLogger,
    });
    for (let i = 0; i < 3; i += 1) {
      sock.emit("connection.update", {
        connection: "close",
        lastDisconnect: { error: { output: { statusCode: 515 } } },
      });
      sock.emit("connection.update", { connection: "connecting" });
    }
    const alerts = warns.filter((w) => w.includes("RECONNECT-ALERT"));
    expect(alerts).toHaveLength(1);
    await handle.close();
    delete process.env.WA_RECONNECT_ALERT_N;
  });
});

test("T79 line48 — an app-state conflict triggers ONE recovery", async () => {
  const warns: string[] = [];
  const sock = fakeSocket();
  mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
  const handle = await trackedStart("/tmp/wa-mcp-test-auth", {
    logger: {
      error: () => undefined,
      warn: (obj: unknown, msg?: unknown) => warns.push(String(msg ?? obj)),
    } as unknown as BridgeLogger,
  });
  // the fork logs LTHash 409 conflicts through the INJECTED logger
  const injected = (
    (mockMakeWASocket.mock.calls[0]?.[0] as unknown as { logger?: BridgeLogger }).logger
  );
  injected?.warn({ collection: "regular" }, "conflict in processing state");
  injected?.warn({ collection: "regular" }, "conflict in processing state");
  const recoveries = warns.filter((entry) => entry.includes("APP-STATE-RECOVERY"));
  expect(recoveries).toHaveLength(1);
  await handle.close();
});

test("T79 line47 — a stale socket (queries never answered) is torn down and replaced", async () => {
  vi.useFakeTimers();
  process.env.WA_STALENESS_MS = "100";
  const stale = fakeSocket();
  (stale as { query?: unknown }).query = vi.fn(() => new Promise<never>(() => {}));
  mockMakeWASocket.mockReturnValueOnce(stale as unknown as WASocket);
  const second = fakeSocket();
  mockMakeWASocket.mockReturnValueOnce(second as unknown as WASocket);
  const handle = await trackedStart("/tmp/wa-mcp-test-auth", {});
  await vi.advanceTimersByTimeAsync(400);
  // RED today: no staleness hook — the dead socket keeps running silently
  expect(stale.end).toHaveBeenCalledTimes(1);
  expect(mockMakeWASocket.mock.calls).toHaveLength(2);
  delete process.env.WA_STALENESS_MS;
  vi.useRealTimers();
  await handle.close();
});

test("T80 line44 — syncFullHistory applies only on FRESH creds (pairing-time)", async () => {
  currentCreds.account = { id: "123", lid: "456" };
  const sock = fakeSocket();
  mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
  await trackedStart("/tmp/wa-mcp-test-auth", { syncFullHistory: true });
  const paired = mockMakeWASocket.mock.calls[0]?.[0] as UserFacingSocketConfig;
  // RED today: a full-history sync re-fires on EVERY reconnect of an
  // already-paired session — the engine should resync only at pairing
  expect(paired.syncFullHistory).toBe(false);
  await LIVE_HANDLES[LIVE_HANDLES.length - 1]?.close();

  // a NEW auth state without account = the pairing moment — flag kept
  mockAuthState.mockResolvedValue({
    state: { creds: {} } as unknown as AuthenticationState,
    saveCreds: mockSaveCreds,
  });
  const freshSock = fakeSocket();
  mockMakeWASocket.mockReturnValueOnce(freshSock as unknown as WASocket);
  await trackedStart("/tmp/wa-mcp-test-auth", { syncFullHistory: true });
  const fresh = mockMakeWASocket.mock.calls[1]?.[0] as UserFacingSocketConfig;
  expect(fresh.syncFullHistory).toBe(true);
  await LIVE_HANDLES[LIVE_HANDLES.length - 1]?.close();
});

test("T80-FIX — the conflict-aware logger preserves the pino prototype surface", async () => {
  const calls: Array<[unknown, unknown?]> = [];
  class PinoLike {
    level = "warn";
    child() {
      return new PinoLike();
    }
    trace() {}
    debug() {}
    info() {}
    warn(obj: unknown, msg?: unknown) {
      calls.push([obj, msg]);
    }
    error() {}
  }
  // pino instances carry methods on the PROTOTYPE — a spread copy loses them
  const base = new PinoLike();
  const sock = fakeSocket();
  mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
  const handle = await trackedStart("/tmp/wa-mcp-test-auth", {
    logger: base as unknown as BridgeLogger,
  });
  const injected = (
    (mockMakeWASocket.mock.calls[0]?.[0] as unknown as { logger?: BridgeLogger }).logger
  );
  expect(typeof injected?.child).toBe("function");
  expect(() => injected?.child({}).warn({}, "via child")).not.toThrow();
  // interception still fires on conflict
  injected?.warn({ collection: "regular" }, "conflict in processing state");
  const recoveries = calls.filter(([, msg]) => String(msg).includes("APP-STATE-RECOVERY"));
  expect(recoveries).toHaveLength(1);
  await handle.close();
});

describe("T84 line92 — logout", () => {
  test("logout ends the socket, marks creds, keeps status logged-out (no auto-reconnect)", async () => {
    const sock = fakeSocket();
    (sock as unknown as { logout: ReturnType<typeof vi.fn> }).logout = vi.fn(async () => ({
      success: true,
    }));
    mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
    const handle = await trackedStart("/tmp/wa-mcp-test-auth", {});
    await handle.logout();
    expect((sock as unknown as { logout: ReturnType<typeof vi.fn> }).logout).toHaveBeenCalledTimes(
      1,
    );
    expect(handle.status).toBe("logged-out");
    // a later close from the dead socket must NOT schedule a reconnect
    sock.emit("connection.update", {
      connection: "close",
      lastDisconnect: { error: { output: { statusCode: 401 } } },
    });
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(mockMakeWASocket.mock.calls).toHaveLength(1);
    await handle.close();
  });
});

test("T84-B line93 — an autoreply rule answers an inbound hello once per cooldown", async () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-autoreply-")));
  addAutoreplyRule(store, { match: "hello", reply: "hi from the daemon" });
  const sock = fakeSocket();
  (sock as { sendMessage?: unknown }).sendMessage = vi.fn(async () => ({
    key: { id: "AUTO1", fromMe: true },
  }));
  mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
  await trackedStart("/tmp/wa-mcp-test-auth", { store });
  sock.emit("messages.upsert", {
    messages: [
      {
        key: { remoteJid: "358497773518@s.whatsapp.net", fromMe: false, id: "IN1" },
        message: { conversation: "hello" },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  sock.emit("messages.upsert", {
    messages: [
      {
        key: { remoteJid: "358497773518@s.whatsapp.net", fromMe: false, id: "IN2" },
        message: { conversation: "hello again" },
        messageTimestamp: Math.floor(Date.now() / 1000),
      },
    ],
  });
  await new Promise((resolve) => setTimeout(resolve, 50));
  const sendCalls = (
    (sock as unknown as { sendMessage: ReturnType<typeof vi.fn> }).sendMessage.mock.calls.filter(
    (call) => (call[1] as { text?: string }).text === "hi from the daemon",
  );
  expect(sendCalls).toHaveLength(1);
  store.close();
});
