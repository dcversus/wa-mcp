import { DisconnectReason, makeWASocket, useMultiFileAuthState } from "@whiskeysockets/baileys";
import type {
  UserFacingSocketConfig,
  WABrowserDescription,
  WASocket,
} from "@whiskeysockets/baileys";
import { EVENT_NAMES, createEventBus } from "./events.ts";
import type { ConnectionUpdate, EventBus, WaEvent } from "./events.ts";

export type BridgeStatus = "connecting" | "qr" | "connected" | "reconnecting" | "logged-out";

export type BridgeLogger = UserFacingSocketConfig["logger"];

export interface StartBridgeOptions {
  syncFullHistory?: boolean;
  browser?: WABrowserDescription;
  logger?: BridgeLogger;
}

export interface BridgeHandle {
  readonly status: BridgeStatus;
  readonly events: EventBus;
  close(): Promise<void>;
}

const DEFAULT_BROWSER: WABrowserDescription = ["wa-mcp", "chrome", "0.9.0"];

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
  const socket: WASocket = makeWASocket({
    auth: state,
    printQRInTerminal: false,
    syncFullHistory: opts.syncFullHistory ?? false,
    browser: opts.browser ?? DEFAULT_BROWSER,
    logger: opts.logger,
  });
  for (const name of EVENT_NAMES) {
    socket.ev.on(name, (payload) => {
      if (name === "connection.update") {
        status = deriveStatus(status, payload as ConnectionUpdate);
      }
      if (name === "creds.update") {
        void saveCreds();
      }
      bus.emit({ type: name, payload } as WaEvent);
    });
  }
  return {
    get status() {
      return status;
    },
    events: bus,
    close: () => socket.end(undefined),
  };
}
