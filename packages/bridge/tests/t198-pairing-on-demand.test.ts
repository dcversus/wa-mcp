import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import pino from "pino";

vi.mock("baileys", async (importActual) => {
  const actual = await importActual<typeof import("baileys")>();
  return {
    decryptPollVote: actual.decryptPollVote,
    getKeyAuthor: actual.getKeyAuthor,
    jidNormalizedUser: actual.jidNormalizedUser,
    makeWASocket: vi.fn(),
    useMultiFileAuthState: vi.fn(),
    initAuthCreds: vi.fn(() => ({ advSecretKey: "fresh", registrationId: 1 })),
    jidDecode: (jid: string) => {
      const [userPart = "", server = ""] = jid.split("@");
      const [user, device] = userPart.split(":");
      return { user, server, device };
    },
    jidEncode: (user: string, server: string) => `${user}@${server}`,
    proto: { Message: { ProtocolMessage: { Type: {} } } },
    DisconnectReason: {
      loggedOut: 401,
      restartRequired: 515,
      connectionClosed: 428,
      timedOut: 408,
    },
  };
});

import { makeWASocket, useMultiFileAuthState } from "baileys";
import type { AuthenticationState, WASocket } from "baileys";
import { startBridge, type StartBridgeOptions } from "../src/lifecycle.ts";

type Listener = (payload: unknown) => void;

function fakeSocket() {
  const listeners = new Map<string, Listener[]>();
  const ev = {
    on: (name: string, listener: Listener) => {
      listeners.set(name, [...(listeners.get(name) ?? []), listener]);
    },
    emit: (name: string, payload: unknown) => {
      for (const listener of listeners.get(name) ?? []) listener(payload);
    },
    removeAllListeners: (name?: string) => {
      if (name === undefined) listeners.clear();
      else listeners.delete(name);
    },
  };
  return { ev, end: vi.fn(), emit: ev.emit };
}

const mockMakeWASocket = vi.mocked(makeWASocket);
const mockAuthState = vi.mocked(useMultiFileAuthState);
let creds: Record<string, unknown>;
const sockets: ReturnType<typeof fakeSocket>[] = [];
const handles: Array<{ close(): Promise<void> }> = [];

beforeEach(() => {
  vi.clearAllMocks();
  sockets.length = 0;
  creds = {};
  mockAuthState.mockResolvedValue({
    state: { creds } as unknown as AuthenticationState,
    saveCreds: vi.fn(async () => {}),
  });
  mockMakeWASocket.mockImplementation(() => {
    const sock = fakeSocket();
    sockets.push(sock);
    return sock as unknown as WASocket;
  });
});

afterEach(() => {
  vi.useRealTimers();
  for (const handle of handles.splice(0)) void handle.close();
});

async function boot(extra: StartBridgeOptions = {}) {
  const handle = await startBridge("/tmp/wa-mcp-t198-auth", {
    logger: pino({ level: "silent" }),
    qrPngPath: "/tmp/wa-mcp-t198-qr.png",
    pairingOnDemand: true,
    ...extra,
  });
  handles.push(handle);
  return handle;
}

const latest = () => sockets[sockets.length - 1]!;
const close = (code: number) => ({
  connection: "close",
  lastDisconnect: {
    error: Object.assign(new Error(`boom ${code}`), { output: { statusCode: code } }),
    date: new Date(),
  },
});

test("an unpaired daemon boots idle: no socket, no registration, nothing spent", async () => {
  const handle = await boot();
  expect(handle.status).toBe("unpaired");
  expect(mockMakeWASocket).not.toHaveBeenCalled();
  expect(handle.pairingBudget().used).toBe(0);
});

test("a paired daemon still connects on boot", async () => {
  creds.account = { details: new Uint8Array() };
  const handle = await boot();
  expect(mockMakeWASocket).toHaveBeenCalledTimes(1);
  expect(handle.status).not.toBe("unpaired");
});

test("legacy mode (pairingOnDemand off) still registers on boot", async () => {
  const handle = await boot({ pairingOnDemand: false });
  expect(mockMakeWASocket).toHaveBeenCalledTimes(1);
  expect(handle.pairingBudget().used).toBe(1);
});

test("startPairing opens exactly one registration; a second call while it's live is a no-op", async () => {
  const handle = await boot();
  expect(handle.startPairing!()).toEqual({ started: true });
  expect(mockMakeWASocket).toHaveBeenCalledTimes(1);
  expect(handle.pairingBudget().used).toBe(1);
  latest().emit("connection.update", { qr: "ref-1" });
  expect(handle.startPairing!()).toEqual({ started: false, reason: "active" });
  expect(mockMakeWASocket).toHaveBeenCalledTimes(1);
});

test("QR rotation is tracked like WhatsApp Web: the first code lives 60 s, the next ones 20 s", async () => {
  vi.useFakeTimers({ now: new Date("2026-10-29T10:00:00Z") });
  const handle = await boot();
  handle.startPairing!();
  latest().emit("connection.update", { qr: "ref-1" });
  expect(handle.getQrInfo!()).toMatchObject({
    qr: "ref-1",
    index: 1,
    issuedAt: "2026-10-29T10:00:00.000Z",
    expiresAt: "2026-10-29T10:01:00.000Z",
    expired: false,
  });
  vi.setSystemTime(new Date("2026-10-29T10:01:00Z"));
  latest().emit("connection.update", { qr: "ref-2" });
  expect(handle.getQrInfo!()).toMatchObject({
    qr: "ref-2",
    index: 2,
    expiresAt: "2026-10-29T10:01:20.000Z",
  });
});

test("when the QR codes run out unscanned the daemon stops: no new registration, QR marked expired", async () => {
  vi.useFakeTimers();
  const handle = await boot();
  handle.startPairing!();
  latest().emit("connection.update", { qr: "ref-1" });
  latest().emit("connection.update", close(408));
  await vi.advanceTimersByTimeAsync(120_000);
  expect(handle.status).toBe("unpaired");
  expect(mockMakeWASocket).toHaveBeenCalledTimes(1);
  expect(handle.getQrInfo!()).toMatchObject({ qr: null, expired: true });
  expect(handle.getLastQr()).toBeNull();
});

test("any close during an unpaired registration ends it instead of re-registering", async () => {
  vi.useFakeTimers();
  const handle = await boot();
  handle.startPairing!();
  latest().emit("connection.update", close(428));
  await vi.advanceTimersByTimeAsync(120_000);
  expect(handle.status).toBe("unpaired");
  expect(mockMakeWASocket).toHaveBeenCalledTimes(1);
});

test("a paired session that drops still reconnects on its own", async () => {
  vi.useFakeTimers();
  creds.account = { details: new Uint8Array() };
  const handle = await boot();
  latest().emit("connection.update", close(428));
  await vi.advanceTimersByTimeAsync(5_000);
  expect(mockMakeWASocket).toHaveBeenCalledTimes(2);
  expect(handle.status).not.toBe("unpaired");
});

test("when WhatsApp removes the device the daemon wipes creds and stays logged out — no re-registration", async () => {
  vi.useFakeTimers();
  creds.account = { details: new Uint8Array() };
  const handle = await boot();
  latest().emit("connection.update", close(401));
  await vi.advanceTimersByTimeAsync(120_000);
  expect(handle.status).toBe("logged-out");
  expect(mockMakeWASocket).toHaveBeenCalledTimes(1);
  expect(creds.account).toBeUndefined();
});

test("startPairing after a logout clears the logged-out marker and registers", async () => {
  creds.waMcpLoggedOut = true;
  const handle = await boot();
  expect(handle.status).toBe("logged-out");
  expect(mockMakeWASocket).not.toHaveBeenCalled();
  expect(handle.startPairing!()).toEqual({ started: true });
  expect(creds.waMcpLoggedOut).toBeUndefined();
  expect(mockMakeWASocket).toHaveBeenCalledTimes(1);
});

test("startPairing refuses once the budget is spent and never opens a socket", async () => {
  vi.useFakeTimers();
  const handle = await boot({ pairingAttemptLimit: 1 });
  handle.startPairing!();
  latest().emit("connection.update", close(408));
  await vi.advanceTimersByTimeAsync(1_000);
  expect(handle.startPairing!()).toEqual({ started: false, reason: "pairing-blocked" });
  expect(mockMakeWASocket).toHaveBeenCalledTimes(1);
  expect(handle.status).toBe("pairing-blocked");
});

test("startPairing is a no-op for a paired daemon", async () => {
  creds.account = { details: new Uint8Array() };
  const handle = await boot();
  expect(handle.startPairing!()).toEqual({ started: false, reason: "paired" });
  expect(mockMakeWASocket).toHaveBeenCalledTimes(1);
});
