import { DisconnectReason, initAuthCreds, makeWASocket, useMultiFileAuthState } from "baileys";
import { proto } from "baileys";
import type { UserFacingSocketConfig, WABrowserDescription, WASocket } from "baileys";
import { homedir } from "node:os";
import { join } from "node:path";
import { EVENT_NAMES, createEventBus } from "./events.ts";
import type { ConnectionUpdate, EventBus, WaEvent } from "./events.ts";
import { renderQrAscii, saveQrPng } from "./qr.ts";
import { canonicalChatJid, sendViaSocket } from "./send/send.ts";
import { upsertContact } from "./store/contacts.ts";
import { removeGroupParticipants, upsertGroupParticipants } from "./store/groups.ts";
import { storeMessage, upsertChatMeta } from "./store/messages.ts";
import { storePollVotes, type PollVoteUpdate } from "./store/poll-votes.ts";
import { evaluateAutoreply } from "./store/autoreply.ts";
import { evaluateSendRules } from "./store/send-rules.ts";
import { markHistorySynced } from "./store/meta.ts";
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
  /** T79 line49: connection-quality counters for /health. */
  connectionQuality(): { reconnects: number; lastDisconnectAt: number | null };
  /** T84 line92: explicit logout — teardown + logged-out marker, no reconnection. */
  logout(): Promise<void>;
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
  // T79 line49/50: connection-quality counters + consecutive-failure streak
  let reconnects = 0;
  let lastDisconnectAt: number | null = null;
  let failureStreak = 0;
  let alertFired = false;

  // T79 line48: the fork surfaces LTHash 409s ONLY through the injected
  // logger ('conflict in processing state'). Watch it; on the first conflict
  // per cooldown drop the stored app-state-sync-version so the next patch
  // runs a FULL resync, and swallow the duplicate spam.
  let stalenessTimer: NodeJS.Timeout | null = null;
  let staleMisses = 0;
  let appStateRecoveryAt = 0;
  const baseLogger = opts.logger;
  const conflictAwareLogger: BridgeLogger | undefined =
    baseLogger === undefined
      ? undefined
      : Object.assign(Object.create(baseLogger), {
          warn: (obj: unknown, msg?: unknown) => {
            const text = String(msg ?? obj);
            if (/conflict/i.test(text) && /app.?state|sendappstate|processing state/i.test(text)) {
              const now = Date.now();
              if (now - appStateRecoveryAt > 30_000) {
                appStateRecoveryAt = now;
                baseLogger.warn(
                  {},
                  "APP-STATE-RECOVERY: LTHash conflict — clearing app-state-sync-version for a full resync on the next patch",
                );
                const keys = (
                  state as {
                    keys?: { set?: (type: string, ids: string[]) => void };
                  }
                ).keys;
                keys?.set?.("app-state-sync-version", [
                  "regular",
                  "critical_block",
                  "critical_unblock_low",
                  "sent",
                  "secret",
                ]);
              }
              return;
            }
            baseLogger.warn(obj, msg as string | undefined);
          },
        });
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
      // T80 line44: full history belongs to PAIRING — a fresh account only.
      // Reconnecting a paired session must never re-trigger the full sync.
      syncFullHistory: opts.syncFullHistory === true && state.creds.account === undefined,
      browser: opts.browser ?? [deviceName, "chrome", "0.9.0"],
      logger: conflictAwareLogger,
      // T76 H4: the fork's process-message fetches the ORIGINAL poll message
      // through this callback to get its messageContextInfo.messageSecret —
      // the pollEncKey it needs to decrypt incoming votes. The raw column
      // (full proto JSON, written at ingest) is the source of truth.
      getMessage: async (key) => {
        const store = opts.store;
        if (store === undefined || typeof key.id !== "string") {
          return undefined;
        }
        const row = store.db.prepare("SELECT raw FROM messages WHERE id = ?").get(key.id) as
          | { raw?: string | null }
          | undefined;
        if (row?.raw === undefined || row.raw === null) {
          return undefined;
        }
        try {
          return JSON.parse(row.raw) as proto.IMessage;
        } catch {
          return undefined;
        }
      },
    });
    // T79 line47: staleness watchdog — a query that never resolves means
    // the transport is a silent corpse; after the miss threshold, tear the
    // socket down and reconnect immediately (515-style single-flight).
    if (stalenessTimer !== null) {
      clearInterval(stalenessTimer);
    }
    staleMisses = 0;
    const stalenessMs = Number(process.env.WA_STALENESS_MS ?? 30_000);
    if (stalenessMs > 0) {
      stalenessTimer = setInterval(() => {
        const current = socket;
        if (closed || current === null || current === undefined) {
          return;
        }
        if (typeof current.query !== "function") {
          return;
        }
        if (staleMisses >= 3) {
          staleMisses = 0;
          opts.logger?.warn({}, "STALENESS: keepalive queries unanswered — forcing reconnect");
          for (const name of EVENT_NAMES) {
            current.ev.removeAllListeners(name);
          }
          void current.end(new Error("staleness: queries unanswered"));
          connect();
          return;
        }
        staleMisses += 1;
        void (current.query as (q: unknown) => Promise<unknown>)({
          json: { tag: "iq", attrs: { type: "get", xmlns: "w:p", to: "@s.whatsapp.net" } },
        })
          .then(() => {
            staleMisses = 0;
          })
          .catch(() => undefined);
      }, stalenessMs);
      stalenessTimer.unref();
    }
    for (const name of EVENT_NAMES) {
      socket.ev.on(name, async (payload) => {
        if (name === "connection.update") {
          const update = payload as ConnectionUpdate;
          status = deriveStatus(status, update);
          // T79 line49/50: quality counters + consecutive-failure streak
          if (update.connection === "close" && !closed) {
            reconnects += 1;
            lastDisconnectAt = Date.now();
            failureStreak += 1;
            const threshold = Number(process.env.WA_RECONNECT_ALERT_N ?? 5);
            if (failureStreak >= threshold && !alertFired) {
              alertFired = true;
              opts.logger?.warn(
                { streak: failureStreak, threshold },
                `RECONNECT-ALERT: ${failureStreak} consecutive disconnects without a successful open`,
              );
            }
          }
          if (update.connection === "open") {
            failureStreak = 0;
            alertFired = false;
          }
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
              const remoteJid: string | null | undefined = message.key.remoteJid;
              if (remoteJid !== undefined && remoteJid !== null && remoteJid.endsWith("@lid")) {
                message.key.remoteJid = await canonicalChatJid(socket, remoteJid);
              }
              storeMessage(opts.store, message);
              // T84-B line93: inbound non-own texts may trigger an autoreply —
              // gated by WA_SENDS_DISABLED and the T82 restrict rules, with a
              // per-chat cooldown inside evaluateAutoreply
              if (message.key.fromMe !== true) {
                const inboundText =
                  (message.message?.conversation as string | undefined) ??
                  (message.message?.extendedTextMessage?.text as string | undefined);
                if (typeof inboundText === "string" && inboundText.length > 0) {
                  const reply = evaluateAutoreply(
                    opts.store,
                    remoteJid as string,
                    inboundText,
                    Date.now(),
                  );
                  if (reply !== null && process.env.WA_SENDS_DISABLED !== "1") {
                    const verdict = evaluateSendRules(opts.store, remoteJid as string);
                    if (verdict.allowed) {
                      void sendViaSocket(socket, remoteJid as string, { text: reply }).catch(
                        (err: unknown) => {
                          opts.logger?.warn({ err }, "autoreply send failed");
                        },
                      );
                    }
                  }
                }
              }
            }
          }
        }
        if (name === "messages.update") {
          // T76 H4: the fork emits DECRYPTED poll votes here (it fetched the
          // poll's encKey through getMessage) — persist them against
          // poll_options; voter comes from the vote's own message key
          const updates = payload as Array<{
            key?: { remoteJid?: string | null; id?: string | null };
            update?: { pollUpdates?: PollVoteUpdate[] };
          }>;
          if (opts.store !== undefined) {
            for (const update of updates) {
              const chatJid = update.key?.remoteJid;
              const pollId = update.key?.id;
              if (typeof chatJid === "string" && typeof pollId === "string") {
                storePollVotes(opts.store, chatJid, pollId, update.update?.pollUpdates ?? []);
              }
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
            // pre-resolve LID→PN remotes (async) BEFORE the sync transaction
            const lidToPn = new Map<string, string>();
            for (const message of history.messages ?? []) {
              const remoteJid = message.key.remoteJid;
              if (
                remoteJid !== null &&
                remoteJid !== undefined &&
                remoteJid.endsWith("@lid") &&
                !lidToPn.has(remoteJid)
              ) {
                lidToPn.set(remoteJid, await canonicalChatJid(socket, remoteJid));
              }
            }
            const count = withTransaction(store, () => {
              for (const chat of history.chats ?? []) {
                if (typeof chat.id !== "string" || chat.id.length === 0) {
                  continue;
                }
                const canonical = chat.id.endsWith("@lid")
                  ? (lidToPn.get(chat.id) ?? chat.id)
                  : chat.id;
                upsertChatMeta(store, { id: canonical, name: chat.name });
              }
              markHistorySynced(
                store,
                (history.chats ?? [])
                  .map((chat) => chat.id)
                  .filter((id): id is string => typeof id === "string"),
              );
              let stored = 0;
              for (const message of history.messages ?? []) {
                const remoteJid = message.key.remoteJid;
                if (remoteJid !== undefined && remoteJid !== null && lidToPn.has(remoteJid)) {
                  message.key.remoteJid = lidToPn.get(remoteJid);
                }
                if (storeMessage(store, message)) {
                  stored += 1;
                }
              }
              return stored;
            });
            opts.logger?.info({ messages: count }, "history sync persisted");
          }
        }
        if (name === "groups.upsert") {
          // group metadata push: subject lands in chats.name, roster in
          // group_participants (T62/I)
          const groups = payload as Array<{
            id: string;
            subject?: string;
            participants?: Array<{ id: string; admin?: string | null }>;
          }>;
          if (opts.store !== undefined) {
            for (const group of groups) {
              upsertChatMeta(opts.store, { id: group.id, name: group.subject });
              upsertGroupParticipants(
                opts.store,
                group.id,
                (group.participants ?? []).map((p) => ({ id: p.id, admin: p.admin ?? null })),
              );
            }
          }
        }
        if (name === "contacts.upsert") {
          // T76 H7: the roster push lands in the contacts table (merge keeps
          // stored aliases — upsertContact only fills blanks)
          const contacts = payload as Array<{
            id?: string;
            name?: string;
            notify?: string;
            verifiedName?: string;
          }>;
          if (opts.store !== undefined) {
            for (const contact of contacts) {
              if (typeof contact.id !== "string" || contact.id.length === 0) {
                continue;
              }
              upsertContact(opts.store, {
                jid: contact.id,
                name: contact.name ?? contact.verifiedName,
                pushname: contact.notify,
              });
            }
          }
        }
        if (name === "group-participants.update") {
          // T76 H7: roster deltas apply to the T64 participants table
          const update = payload as {
            id?: string;
            participants?: Array<{ id?: string; admin?: string | null }>;
            action?: string;
          };
          if (opts.store !== undefined && typeof update.id === "string") {
            const ids = (update.participants ?? [])
              .map((participant) => participant.id)
              .filter((id): id is string => typeof id === "string" && id.length > 0);
            if (update.action === "remove") {
              removeGroupParticipants(opts.store, update.id, ids);
            } else if (update.action === "promote") {
              upsertGroupParticipants(
                opts.store,
                update.id,
                ids.map((id) => ({ id, admin: "admin" })),
              );
            } else if (update.action === "demote") {
              upsertGroupParticipants(
                opts.store,
                update.id,
                ids.map((id) => ({ id, admin: null })),
              );
            } else {
              upsertGroupParticipants(
                opts.store,
                update.id,
                ids.map((id) => ({ id, admin: null })),
              );
            }
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
      // T76 H1: same single-flight discipline as the reconnect path — end
      // the live socket and detach its listeners BEFORE minting a fresh
      // registration, never stack two sockets on the same creds.
      if (socket !== null && socket !== undefined) {
        for (const name of EVENT_NAMES) {
          socket.ev.removeAllListeners(name);
        }
        void socket.end(new Error("resume: restarting pairing"));
      }
      connect();
    },
    connectionQuality: () => ({
      reconnects,
      lastDisconnectAt,
    }),
    logout: async () => {
      // T84 line92: creds are KEPT but the session is marked logged-out —
      // closed=true stops every auto-reconnect path from here on.
      closed = true;
      status = "logged-out";
      (state.creds as { waMcpLoggedOut?: boolean }).waMcpLoggedOut = true;
      const current = socket;
      if (current !== null && current !== undefined) {
        for (const name of EVENT_NAMES) {
          current.ev.removeAllListeners(name);
        }
        try {
          await current.logout?.();
        } catch (err: unknown) {
          opts.logger?.warn({ err }, "engine logout failed — session still torn down");
        }
        void current.end(new Error("logout"));
      }
    },
    close: async () => {
      closed = true;
      reconnectPending = false;
      if (reconnectTimer !== null) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      if (stalenessTimer !== null) {
        clearInterval(stalenessTimer);
        stalenessTimer = null;
      }
      await socket.end(undefined);
    },
  };
}
