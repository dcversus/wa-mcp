import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import pino from "pino";

vi.mock("@whiskeysockets/baileys", () => ({
  makeWASocket: vi.fn(),
  useMultiFileAuthState: vi.fn(),
  DisconnectReason: { loggedOut: 401 },
}));

import { DisconnectReason, makeWASocket, useMultiFileAuthState } from "@whiskeysockets/baileys";
import type {
  AuthenticationState,
  UserFacingSocketConfig,
  WASocket,
} from "@whiskeysockets/baileys";
import { EVENT_NAMES, type WaEvent } from "../src/events.ts";
import { startBridge } from "../src/lifecycle.ts";

const mockMakeWASocket = vi.mocked(makeWASocket);
const mockAuthState = vi.mocked(useMultiFileAuthState);

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
  const handle = await startBridge("/tmp/wa-mcp-test-auth", { logger: pino({ level: "silent" }) });
  return { sock, handle };
}

beforeEach(() => {
  vi.clearAllMocks();
  mockAuthState.mockResolvedValue({
    state: {} as unknown as AuthenticationState,
    saveCreds: async () => {},
  });
});

afterEach(() => {
  vi.useRealTimers();
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
  const handle = await startBridge("/tmp/wa-mcp-test-auth", { logger: pino({ level: "silent" }) });
  return { ...arrangement, handle };
}

function closeEvent(code: number) {
  return { connection: "close", lastDisconnect: { error: boomLike(code), date: new Date() } };
}

test("reconnects with exponential backoff after a non-logout close", async () => {
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
});

test("backoff caps at 60 seconds", async () => {
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

test("logged out never reconnects", async () => {
  vi.useFakeTimers();
  const { latest, handle } = await startArranged();
  latest().emit("connection.update", closeEvent(DisconnectReason.loggedOut));
  expect(handle.status).toBe("logged-out");
  await vi.advanceTimersByTimeAsync(120_000);
  expect(mockMakeWASocket).toHaveBeenCalledTimes(1);
});

test("a successful connect resets the backoff attempt counter", async () => {
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

test("close() cancels a pending reconnect", async () => {
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
    await startBridge("/tmp/wa-mcp-test-auth", {});
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
    await startBridge("/tmp/wa-mcp-test-auth", { deviceName: "explicit-name" });
    const call = mockMakeWASocket.mock.calls[0];
    if (!call) throw new Error("makeWASocket was not called");
    expect((call[0] as UserFacingSocketConfig).browser).toEqual(["explicit-name", "chrome", "0.9.0"]);
  } finally {
    delete process.env.WA_DEVICE_NAME;
  }
});

test("startBridge builds auth state from the store dir and sockets with fixed options", async () => {
  const logger = pino({ level: "silent" });
  const sock = fakeSocket();
  mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
  await startBridge("/tmp/wa-mcp-test-auth", { logger });
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
  await startBridge("/tmp/wa-mcp-test-auth", { syncFullHistory: true });
  const call = mockMakeWASocket.mock.calls[0];
  if (!call) throw new Error("makeWASocket was not called");
  expect((call[0] as UserFacingSocketConfig).syncFullHistory).toBe(true);
});

test("browser descriptor passes through from opts", async () => {
  const sock = fakeSocket();
  mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
  await startBridge("/tmp/wa-mcp-test-auth", { browser: ["wa-mcp", "desktop", "1.2.3"] });
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

test("credentials updates persist through saveCreds", async () => {
  const saveCreds = vi.fn();
  mockAuthState.mockResolvedValue({ state: {} as unknown as AuthenticationState, saveCreds });
  const sock = fakeSocket();
  mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
  await startBridge("/tmp/wa-mcp-test-auth", {});
  sock.emit("creds.update", { noiseKey: "rotated" });
  expect(saveCreds).toHaveBeenCalled();
});

test("getLastQr is null before any qr event", async () => {
  const { handle } = await started();
  expect(handle.getLastQr()).toBeNull();
});

test("qr events render stderr, persist png, and expose getLastQr", async () => {
  const dir = await mkdtemp(join(tmpdir(), "wa-mcp-qr-"));
  const pngPath = join(dir, "qr.png");
  const stderrSpy = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
  try {
    const sock = fakeSocket();
    mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
    const handle = await startBridge("/tmp/wa-mcp-test-auth", { qrPngPath: pngPath });
    sock.emit("connection.update", { connection: "connecting", qr: "QRDATA-rotation-1" });
    expect(handle.status).toBe("qr");
    expect(handle.getLastQr()).toBe("QRDATA-rotation-1");
    expect(stderrSpy).toHaveBeenCalled();
    const written = stderrSpy.mock.calls.map((call) => String(call[0])).join("");
    expect(written).toContain("#");
    await vi.waitFor(async () => {
      const bytes = await readFile(pngPath);
      expect(bytes.length).toBeGreaterThan(100);
    });
  } finally {
    stderrSpy.mockRestore();
  }
});

test("qr rotations update getLastQr", async () => {
  const { sock, handle } = await started();
  sock.emit("connection.update", { connection: "connecting", qr: "QRDATA-rotation-1" });
  sock.emit("connection.update", { connection: "connecting", qr: "QRDATA-rotation-2" });
  expect(handle.getLastQr()).toBe("QRDATA-rotation-2");
});
