import { expect, test, vi } from "vite-plus/test";
import pino from "pino";

vi.mock("@whiskeysockets/baileys", () => ({
  makeWASocket: vi.fn(),
  useMultiFileAuthState: vi.fn(),
  DisconnectReason: { loggedOut: 401 },
}));

import { DisconnectReason, makeWASocket, useMultiFileAuthState } from "@whiskeysockets/baileys";
import type {
  AuthenticationCreds,
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
    state: {} as AuthenticationCreds as AuthenticationState,
    saveCreds: async () => {},
  });
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
  expect(config.auth).toEqual(await mockAuthState.mock.results[0]?.value.then((r) => r.state));
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
  mockAuthState.mockResolvedValue({ state: {} as AuthenticationState, saveCreds });
  const sock = fakeSocket();
  mockMakeWASocket.mockReturnValue(sock as unknown as WASocket);
  await startBridge("/tmp/wa-mcp-test-auth", {});
  sock.emit("creds.update", { noiseKey: "rotated" });
  expect(saveCreds).toHaveBeenCalled();
});
