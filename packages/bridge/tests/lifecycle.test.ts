import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import pino from "pino";

vi.mock("baileys", () => ({
  makeWASocket: vi.fn(),
  useMultiFileAuthState: vi.fn(),
  initAuthCreds: vi.fn(() => ({ advSecretKey: "fresh", registrationId: 1 })),
  DisconnectReason: { loggedOut: 401, restartRequired: 515, connectionClosed: 428 },
}));

import { DisconnectReason, makeWASocket, useMultiFileAuthState } from "baileys";
import type { AuthenticationState, UserFacingSocketConfig, WASocket } from "baileys";
import { EVENT_NAMES, type WaEvent } from "../src/events.ts";
import { startBridge } from "../src/lifecycle.ts";

// handles started per test; afterEach closes them so no real reconnect
// timer outlives its test and fires inside a later one
const LIVE_HANDLES: Array<{ close(): Promise<void> }> = [];
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

async function startArranged() {
  const arrangement = multiSocketArrangement();
  const handle = await trackedStart("/tmp/wa-mcp-test-auth", { logger: pino({ level: "silent" }) });
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
  expect(config.logger).toBe(logger);
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
