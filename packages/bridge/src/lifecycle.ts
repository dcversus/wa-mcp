import { DisconnectReason, initAuthCreds, makeWASocket, useMultiFileAuthState } from "baileys";
import type { UserFacingSocketConfig, WABrowserDescription, WASocket } from "baileys";
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
  /** true only once a real pair-success configured the account (creds.account set by
   * configureSuccessfulPairing — never by requestPairingCode, so pairing-code
   * attempts cannot fake it). */
  hasPairedAccount(): boolean;
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

  // serialized credential writes: never fire-and-forget, never interleaved
  let saveChain: Promise<void> = Promise.resolve();
  const queueSave = (): Promise<void> => {
    saveChain = saveChain.then(saveCreds).catch((err: unknown) => {
      opts.logger?.error({ err }, "saveCreds failed");
    });
    return saveChain;
  };

  const closeCode = (update: ConnectionUpdate): number | undefined => {
    return (update.lastDisconnect?.error as { output?: { statusCode?: number } } | undefined)
      ?.output?.statusCode;
  };

  /** 401-class close: the server has invalidated this identity (device_removed,
   * loggedOut). Wipe local material so the next socket is a FRESH registration,
   * never a retry of dead creds. */
  const wipeCreds = (): void => {
    const fresh = initAuthCreds();
    for (const key of Object.keys(state.creds)) {
      delete (state.creds as Record<string, unknown>)[key];
    }
    Object.assign(state.creds, fresh);
    opts.logger?.warn(
      { reason: "401" },
      "device removed by server, re-pairing required (local credentials wiped)",
    );
  };

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
          if (status === "reconnecting" || status === "logged-out") {
            const code = closeCode(update);
            if (code === DisconnectReason.restartRequired) {
              // 515 is the paired handshake step after pair-success, not a
              // failure: reconnect IMMEDIATELY with the same creds or WhatsApp
              // removes the brand-new device (401 device_removed).
              reconnectAttempt = 0;
              void queueSave().then(() => {
                connect();
              });
            } else if (status === "logged-out") {
              wipeCreds();
              reconnectAttempt = 0;
              void queueSave().then(() => {
                scheduleReconnect();
              });
            } else {
              scheduleReconnect();
            }
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
          void queueSave();
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
    hasPairedAccount: () => state.creds.account !== undefined,
    close: async () => {
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      await socket.end(undefined);
    },
  };
}
