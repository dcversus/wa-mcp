import { DisconnectReason, makeWASocket, useMultiFileAuthState } from "@whiskeysockets/baileys";
import type {
  UserFacingSocketConfig,
  WABrowserDescription,
  WASocket,
} from "@whiskeysockets/baileys";
import { homedir } from "node:os";
import { join } from "node:path";
import { EVENT_NAMES, createEventBus } from "./events.ts";
import type { ConnectionUpdate, EventBus, WaEvent } from "./events.ts";
import { renderQrAscii, saveQrPng } from "./qr.ts";

export type BridgeStatus = "connecting" | "qr" | "connected" | "reconnecting" | "logged-out";

export type BridgeLogger = UserFacingSocketConfig["logger"];

export interface StartBridgeOptions {
  syncFullHistory?: boolean;
  browser?: WABrowserDescription;
  deviceName?: string;
  logger?: BridgeLogger;
  qrPngPath?: string;
}

export interface BridgeHandle {
  readonly status: BridgeStatus;
  readonly events: EventBus;
  readonly socket: WASocket;
  getLastQr(): string | null;
  close(): Promise<void>;
}

function deriveStatus(current: BridgeStatus, update: ConnectionUpdate): BridgeStatus {
  if (update.qr !== undefined) {
    return "qr";
  }
  switch (update.connection) {
    case "open":
      return "connected";
    case "connecting":
      return "connecting";
    case "close": {
      const code = (
        update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined
      )?.output?.statusCode;
      return code === DisconnectReason.loggedOut ? "logged-out" : "reconnecting";
    }
    default:
      return current;
  }
}

export async function startBridge(
  storeDir: string,
  opts: StartBridgeOptions = {},
): Promise<BridgeHandle> {
  const { state, saveCreds } = await useMultiFileAuthState(storeDir);
  const bus = createEventBus();
  let status: BridgeStatus = "connecting";
  let lastQr: string | null = null;
  let reconnectAttempt = 0;
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  let socket: WASocket;
  const qrPngPath = opts.qrPngPath ?? join(homedir(), ".wa-mcp", "qr.png");

  const scheduleReconnect = (): void => {
    const delay = Math.min(1000 * 2 ** reconnectAttempt, 60_000);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      connect();
    }, delay);
    reconnectTimer.unref();
  };

  const connect = (): void => {
    const deviceName = opts.deviceName ?? process.env.WA_DEVICE_NAME ?? "wa-mcp";
    socket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      syncFullHistory: opts.syncFullHistory ?? false,
      browser: opts.browser ?? [deviceName, "chrome", "0.9.0"],
      logger: opts.logger,
    });
    for (const name of EVENT_NAMES) {
      socket.ev.on(name, (payload) => {
        if (name === "connection.update") {
          const update = payload as ConnectionUpdate;
          status = deriveStatus(status, update);
          if (status === "connected") {
            reconnectAttempt = 0;
          }
          if (status === "reconnecting") {
            scheduleReconnect();
          }
          const qr = update.qr;
          if (qr !== undefined) {
            lastQr = qr;
            process.stderr.write(renderQrAscii(qr));
            void saveQrPng(qr, qrPngPath).catch((err: unknown) => {
              opts.logger?.warn({ err }, "failed to persist qr png");
            });
          }
        }
        if (name === "creds.update") {
          void saveCreds();
        }
        bus.emit({ type: name, payload } as WaEvent);
      });
    }
  };

  connect();

  return {
    get status() {
      return status;
    },
    events: bus,
    get socket() {
      return socket;
    },
    getLastQr: () => lastQr,
    close: async () => {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      await socket.end(undefined);
    },
  };
}
