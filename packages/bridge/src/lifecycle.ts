import { DisconnectReason, initAuthCreds, makeWASocket, useMultiFileAuthState } from "baileys";
import type { UserFacingSocketConfig, WABrowserDescription, WASocket } from "baileys";
import { homedir } from "node:os";
import { join } from "node:path";
import { EVENT_NAMES, createEventBus } from "./events.ts";
import type { ConnectionUpdate, EventBus, WaEvent } from "./events.ts";
import { renderQrAscii, saveQrPng } from "./qr.ts";
import { storeMessage, upsertChatMeta } from "./store/messages.ts";
import { withTransaction } from "./store/schema.ts";
import type { Store } from "./store/schema.ts";
import type { WAMessage } from "baileys";

export type BridgeStatus =
  | "connecting"
  | "qr"
  | "connected"
  | "reconnecting"
  | "logged-out"
  | "pairing-blocked";

export type BridgeLogger = UserFacingSocketConfig["logger"];

export interface StartBridgeOptions {
  syncFullHistory?: boolean;
  browser?: WABrowserDescription;
  deviceName?: string;
  logger?: BridgeLogger;
  qrPngPath?: string;
  /** when attached, live messages + history sync persist (GOAL §3 ingest) */
  store?: Store;
  /** consecutive registrations without a completed pairing before the daemon
   * stops minting new ones (WhatsApp anti-abuse: every attempt resets the
   * server-side cooldown, so endless retries deepen the lockout). */
  pairingAttemptLimit?: number;
}

export interface PairingBudget {
  blocked: boolean;
  used: number;
  limit: number;
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
  /** registration-attempt accounting: WhatsApp's anti-abuse cooldown resets on
   * every link attempt, so the daemon stops minting registrations at the limit. */
  pairingBudget(): PairingBudget;
  /** explicit user action: reset the budget and re-enter the pairing cycle. */
  resumePairing(): void;
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
  /** a reconnect is scheduled or chained; closes arriving in a burst (real 401s
   * come as stream-error close + ws close) must not stack multiple sockets */
  let reconnectPending = false;
  let closed = false;
  let socket: WASocket;
  const pairingLimit = opts.pairingAttemptLimit ?? 3;
  let pairingUsed = 0;
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

  /** pairing-time pollution: requestPairingCode sets me+pairingCode and nothing
   * in the engine ever clears them (Object.assign only adds). With me present
   * the handshake takes the login branch (fork socket.js) instead of
   * registration, and companion_reg_refresh skips adv rotation (its !creds.me
   * gate) — the QR then advertises retired material forever. Strip ONLY the
   * pairing fields when no completed pairing exists (creds.account is the
   * pollution-safe marker): noise/identity keys SURVIVE, so this is the same
   * device identity re-registering, not a new one — the anti-abuse cooldown is
   * not burned by a wipe, and a genuinely paired session keeps me (its 515
   * continuation NEEDS the login branch). */
  const stripPairingPollution = (): void => {
    if (state.creds.account !== undefined) {
      return;
    }
    if (state.creds.me === undefined && state.creds.pairingCode === undefined) {
      return;
    }
    delete state.creds.me;
    delete state.creds.pairingCode;
    void queueSave();
    opts.logger?.info(
      {},
      "stripped stale pairing fields (me, pairingCode) — next handshake is a fresh registration",
    );
  };

  const scheduleReconnect = (): void => {
    if (reconnectPending) {
      return;
    }
    reconnectPending = true;
    const delay = Math.min(1000 * 2 ** reconnectAttempt, 60_000);
    reconnectAttempt += 1;
    reconnectTimer = setTimeout(() => {
      reconnectPending = false;
      connect();
    }, delay);
    reconnectTimer.unref();
  };

  const connect = (): void => {
    stripPairingPollution();
    if (state.creds.account !== undefined) {
      // a completed pairing resets the budget; these connects are handshake
      // continuations (515 restart step), never fresh registrations
      pairingUsed = 0;
    } else if (pairingUsed >= pairingLimit) {
      status = "pairing-blocked";
      opts.logger?.warn(
        { used: pairingUsed, limit: pairingLimit },
        `pairing attempts exhausted — ${pairingLimit} registrations without pairing; refusing to re-register (WhatsApp anti-abuse cooldown); restart daemon or call /api/pair/resume to retry`,
      );
      return;
    } else {
      pairingUsed += 1;
    }
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
              if (!reconnectPending && !closed) {
                reconnectPending = true;
                reconnectAttempt = 0;
                void queueSave().then(() => {
                  if (closed) {
                    return;
                  }
                  reconnectPending = false;
                  connect();
                });
              }
            } else if (status === "logged-out") {
              if (!reconnectPending && !closed) {
                reconnectPending = true;
                wipeCreds();
                reconnectAttempt = 0;
                void queueSave().then(() => {
                  if (closed) {
                    return;
                  }
                  reconnectPending = false;
                  scheduleReconnect();
                });
              }
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
        if (name === "messages.upsert") {
          // live inbound traffic: notify (real-time) and append (post-reconnect
          // backlog) both persist; media_path stays null until download
          const upsert = payload as { messages?: WAMessage[] };
          if (opts.store !== undefined) {
            for (const message of upsert.messages ?? []) {
              storeMessage(opts.store, message);
            }
          }
        }
        if (name === "messaging-history.set") {
          // the initial history sync: potentially thousands of rows — one
          // transaction, never partially persisted
          const history = payload as {
            chats?: Array<{ id: string; name?: string }>;
            messages?: WAMessage[];
          };
          if (opts.store !== undefined) {
            const store = opts.store;
            const count = withTransaction(store, () => {
              for (const chat of history.chats ?? []) {
                if (typeof chat.id === "string" && chat.id.length > 0) {
                  upsertChatMeta(store, chat);
                }
              }
              let stored = 0;
              for (const message of history.messages ?? []) {
                if (storeMessage(store, message)) {
                  stored += 1;
                }
              }
              return stored;
            });
            opts.logger?.info({ messages: count }, "history sync persisted");
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
    pairingBudget: () => ({
      blocked: status === "pairing-blocked",
      used: pairingUsed,
      limit: pairingLimit,
    }),
    resumePairing: () => {
      pairingUsed = 0;
      if (status === "pairing-blocked") {
        status = "connecting";
      }
      connect();
    },
    close: async () => {
      closed = true;
      reconnectPending = false;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      await socket.end(undefined);
    },
  };
}
