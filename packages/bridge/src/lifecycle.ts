import { DisconnectReason, initAuthCreds, makeWASocket, useMultiFileAuthState } from "baileys";
import { proto } from "baileys";
import type { UserFacingSocketConfig, WABrowserDescription, WASocket } from "baileys";
import { homedir } from "node:os";
import { join } from "node:path";
import { EVENT_NAMES, createEventBus } from "./events.ts";
import type { ConnectionUpdate, EventBus, WaEvent } from "./events.ts";
import { renderQrAscii, saveQrPng } from "./qr.ts";
import { canonicalChatJid, sendViaSocket } from "./send/send.ts";
import { upsertResolvedContact } from "./store/contacts.ts";
import { lidResolver } from "./store/contact-backfill.ts";
import { removeGroupParticipants, upsertGroupParticipants } from "./store/groups.ts";
import { storeMessage, upsertChatMeta } from "./store/messages.ts";
import { storePollVotes, type PollVoteUpdate } from "./store/poll-votes.ts";
import { evaluateAutoreply } from "./store/autoreply.ts";
import { evaluateSendRules } from "./store/send-rules.ts";
import { markHistorySynced } from "./store/meta.ts";
import { fetchMessageFromStore } from "./store/queries.ts";
import { autoDownloadRules, shouldAutoDownload } from "./store/autodl.ts";
import { downloadMessageMedia } from "./media/download.ts";
import { decryptInboundPollVote } from "./ingest/poll-vote.ts";
import { createEventRecorder } from "./ingest/event-recorder.ts";
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
  /** when attached with a store, inbound media auto-downloads here (T93-D) */
  mediaDir?: string;
  /** T94-C2(f): the daemon-wide send budget — autoreply consumes it too */
  sendGuard?: import("./send/safety.ts").SendGuard;
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
  /** T86 line110: request on-demand history for a chat (async — messages
   * arrive via the normal ingest). */
  fetchHistory(chatJid: string, count: number): Promise<{ requested: boolean; request_id: string }>;
  /** T89 line128: true once the contacts store holds at least one entry. */
  contactsWarm(): boolean;
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
  let contactsWarmDone = false;
  const resolvePn = lidResolver(storeDir);
  let alertFired = false;

  // T79 line48: the fork surfaces LTHash 409s ONLY through the injected
  // logger ('conflict in processing state'). Watch it; on the first conflict
  // per cooldown drop the stored app-state-sync-version so the next patch
  // runs a FULL resync, and swallow the duplicate spam.
  let stalenessTimer: NodeJS.Timeout | null = null;
  let staleMisses = 0;
  // T93: any ev event is proof of a live wire — the watchdog only probes
  // (and only ever tears down) when the transport has been fully silent
  let lastInboundAt = 0;
  // T93-D: auto-download rules are process-env static — read once per start
  const autodlRules = autoDownloadRules(process.env);
  // T94-D-H4codex(d): message ids already autoreplied — bounded FIFO
  const autoreplySeenIds = new Set<string>();
  const eventRecorder = createEventRecorder(process.env.WA_RECORD_EVENTS);
  let mediaBackfillDone = false;

  /** T93-D: fire-and-forget media download for one stored message. Never
   * blocks ingest; failures log a warning and leave media_path null (the
   * start backfill and POST /api/media/:id/download can retry later). */
  const downloadAndLink = (message: WAMessage, messageId: string): void => {
    if (opts.store === undefined || opts.mediaDir === undefined) {
      return;
    }
    const store = opts.store;
    const mediaDir = opts.mediaDir;
    void downloadMessageMedia(socket, message, { store, mediaDir, messageId })
      .then((downloaded) => {
        store.db
          .prepare("UPDATE messages SET media_path = ? WHERE id = ?")
          .run(downloaded.path, messageId);
      })
      .catch((err: unknown) => {
        opts.logger?.warn({ err, messageId }, "auto-download failed");
      });
  };

  const maybeAutoDownload = (message: WAMessage, chatJid: string | null | undefined): void => {
    if (opts.store === undefined || opts.mediaDir === undefined) {
      return;
    }
    if (chatJid === null || chatJid === undefined) {
      return;
    }
    const content = message.message;
    const mediaPart =
      content?.imageMessage ??
      content?.videoMessage ??
      content?.audioMessage ??
      content?.documentMessage ??
      content?.stickerMessage;
    if (mediaPart == null) {
      return;
    }
    const fileName = (mediaPart as { fileName?: unknown }).fileName;
    const verdict = shouldAutoDownload(
      chatJid,
      opts.mediaDir,
      autodlRules,
      typeof fileName === "string" ? fileName : undefined,
    );
    if (!verdict.ok) {
      return;
    }
    const messageId = message.key.id ?? "";
    if (messageId.length === 0) {
      return;
    }
    downloadAndLink(message, messageId);
  };

  /** T93-D: bounded backfill at daemon start — the latest 50 media messages
   * that still have a null path (ingest races, earlier crashes, downtime). */
  const backfillPendingMedia = (): void => {
    if (mediaBackfillDone || opts.store === undefined || opts.mediaDir === undefined) {
      return;
    }
    mediaBackfillDone = true;
    const store = opts.store;
    const rows = store.db
      .prepare(
        "SELECT id FROM messages WHERE media_type IS NOT NULL AND media_path IS NULL ORDER BY timestamp DESC LIMIT 50",
      )
      .all() as Array<{ id: string }>;
    for (const row of rows) {
      const original = fetchMessageFromStore(store, row.id);
      if (original === null) {
        continue;
      }
      const chatJid = original.key.remoteJid ?? null;
      const content = original.message;
      const mediaPart =
        content?.imageMessage ??
        content?.videoMessage ??
        content?.audioMessage ??
        content?.documentMessage ??
        content?.stickerMessage;
      if (mediaPart === undefined || chatJid === null) {
        continue;
      }
      const fileName = (mediaPart as { fileName?: unknown }).fileName;
      const verdict = shouldAutoDownload(
        chatJid,
        opts.mediaDir,
        autodlRules,
        typeof fileName === "string" ? fileName : undefined,
      );
      if (!verdict.ok) {
        continue;
      }
      downloadAndLink(original, row.id);
    }
  };
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
    contactsWarmDone = false;
    stripPairingPollution();
    // T94-F Runtime-M5: an explicit logout must not auto-connect on the next
    // boot — fresh pairing (or an explicit resume) is required
    if ((state.creds as { waMcpLoggedOut?: boolean }).waMcpLoggedOut === true) {
      status = "logged-out";
      opts.logger?.warn(
        {},
        "logged-out marker present — refusing auto-connect; call resume to pair fresh",
      );
      return;
    }
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
    backfillPendingMedia();
    // T79 line47: staleness watchdog — a query that never resolves means
    // the transport is a silent corpse; after the miss threshold, tear the
    // socket down and reconnect immediately (515-style single-flight).
    if (stalenessTimer !== null) {
      clearInterval(stalenessTimer);
    }
    staleMisses = 0;
    lastInboundAt = Date.now();
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
        // T93 engine-truth fix: inbound traffic IS liveness. The live daemon
        // tore down HEALTHY connections every ~90s because every probe
        // "timed out" — messages were flowing the whole time.
        if (Date.now() - lastInboundAt < stalenessMs) {
          staleMisses = 0;
          return;
        }
        if (staleMisses >= 3) {
          // T93: accounting runs BEFORE the listeners are detached — the
          // close event has no listener left after the forced teardown, and
          // the old order left /health reporting reconnects:0 through a
          // full churn storm.
          staleMisses = 0;
          reconnects += 1;
          lastDisconnectAt = Date.now();
          opts.logger?.warn({}, "STALENESS: keepalive queries unanswered — forcing reconnect");
          for (const name of EVENT_NAMES) {
            current.ev.removeAllListeners(name);
          }
          void current.end(new Error("staleness: queries unanswered"));
          connect();
          return;
        }
        staleMisses += 1;
        // T93: the probe must be the engine's OWN keepalive iq — the fork
        // passes the NODE directly (not {json:...}) with a w:p ping child
        // (Socket/socket.js:530-558); the old wrapper never got answered.
        void (current.query as (q: unknown) => Promise<unknown>)({
          tag: "iq",
          attrs: { to: "@s.whatsapp.net", type: "get", xmlns: "w:p" },
          content: [{ tag: "ping", attrs: {} }],
        })
          .then(() => {
            staleMisses = 0;
          })
          .catch(() => undefined);
      }, stalenessMs);
      stalenessTimer.unref();
    }
    for (const name of EVENT_NAMES) {
      socket.ev.on(name, (payload) => {
        void (async () => {
          eventRecorder.record(name, payload);
          lastInboundAt = Date.now();
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
              // T89-B GAP1: background contact warmup — pull group rosters into
              // the contacts store so lookups never block on a cold table.
              if (opts.store !== undefined && !contactsWarmDone) {
                void (async () => {
                  try {
                    const engine = socket as unknown as {
                      groupFetchAllParticipating?: () => Promise<
                        Record<
                          string,
                          { participants?: Array<{ id?: string; phoneNumber?: string }> }
                        >
                      >;
                    };
                    if (typeof engine.groupFetchAllParticipating !== "function") {
                      contactsWarmDone = true;
                      return;
                    }
                    const groups = await engine.groupFetchAllParticipating();
                    for (const group of Object.values(groups ?? {})) {
                      for (const participant of group.participants ?? []) {
                        if (typeof participant.id === "string" && participant.id.length > 0) {
                          upsertResolvedContact(
                            opts.store!,
                            { jid: participant.id, phone: participant.phoneNumber },
                            resolvePn,
                          );
                        }
                      }
                    }
                    contactsWarmDone = true;
                  } catch (err: unknown) {
                    opts.logger?.warn({ err }, "contact warmup failed");
                    contactsWarmDone = false;
                  }
                })();
              }
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
            const upsert = payload as { messages?: WAMessage[]; type?: string };
            if (opts.store !== undefined) {
              for (const message of upsert.messages ?? []) {
                // T94-D-H4codex(a): everything downstream (rules, autoreply,
                // poll votes, media) keys off the CANONICAL jid — the raw LID
                // leaked before this fix
                let remoteJid: string | null | undefined = message.key.remoteJid;
                if (remoteJid !== undefined && remoteJid !== null && remoteJid.endsWith("@lid")) {
                  remoteJid = await canonicalChatJid(socket, remoteJid);
                  message.key.remoteJid = remoteJid;
                }
                // T94-D-M10 (CODEX): key.participant becomes sender_jid,
                // reaction authors and poll voters — one person must not
                // exist under two identities
                const participant = message.key.participant;
                if (
                  participant !== undefined &&
                  participant !== null &&
                  participant.endsWith("@lid")
                ) {
                  message.key.participant = await canonicalChatJid(socket, participant);
                }
                storeMessage(opts.store, message);
                // T94-C-H1: the pinned fork's poll-vote decrypt block is
                // commented out (process-message.js:576-624) — replicate its
                // orchestration here: fetch the poll creation row, decrypt with
                // the fork's own primitive, persist via poll_votes
                const pollUpdateMessage = message.message?.pollUpdateMessage;
                const creationKey = pollUpdateMessage?.pollCreationMessageKey;
                if (
                  pollUpdateMessage !== undefined &&
                  creationKey !== undefined &&
                  creationKey !== null &&
                  typeof creationKey.id === "string"
                ) {
                  const pollRow = opts.store.db
                    .prepare("SELECT raw FROM messages WHERE id = ?")
                    .get(creationKey.id) as { raw?: string | null } | undefined;
                  let pollMessage: proto.IMessage | undefined;
                  if (pollRow?.raw !== undefined && pollRow.raw !== null) {
                    try {
                      pollMessage = JSON.parse(pollRow.raw) as proto.IMessage;
                    } catch {
                      pollMessage = undefined;
                    }
                  }
                  const voteUpdate = decryptInboundPollVote(
                    message,
                    pollMessage,
                    state.creds.me?.id ?? "",
                  );
                  const pollChatJid = remoteJid ?? "";
                  if (voteUpdate !== null && pollChatJid.length > 0) {
                    storePollVotes(opts.store, pollChatJid, creationKey.id, [voteUpdate]);
                  }
                }
                // T93-D: media rides the auto-download rules — fire-and-forget,
                // never blocks ingest, row linked on success
                maybeAutoDownload(message, remoteJid);
                // T84-B line93: inbound non-own texts may trigger an autoreply —
                // gated by WA_SENDS_DISABLED and the T82 restrict rules, with a
                // per-chat cooldown inside evaluateAutoreply.
                // T94-D-H4codex: live notify traffic only — never status, and
                // never the same message id twice
                const inboundMessageId = message.key.id ?? "";
                if (
                  message.key.fromMe !== true &&
                  upsert.type === "notify" &&
                  remoteJid !== "status@broadcast" &&
                  inboundMessageId.length > 0 &&
                  !autoreplySeenIds.has(inboundMessageId)
                ) {
                  autoreplySeenIds.add(inboundMessageId);
                  if (autoreplySeenIds.size > 500) {
                    const oldest = autoreplySeenIds.values().next().value;
                    if (oldest !== undefined) {
                      autoreplySeenIds.delete(oldest);
                    }
                  }
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
                      // T94-C2(f): the reply burns the same budget as manual
                      // sends — an inbound loop cannot exceed the daily cap
                      const budget = opts.sendGuard?.check(Date.now());
                      const budgetOk = budget === undefined || budget.ok;
                      if (verdict.allowed && budgetOk) {
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
              // T94-F M5codex: chat ids resolve too — not just message jids
              for (const chat of history.chats ?? []) {
                const chatId = chat.id;
                if (typeof chatId === "string" && chatId.endsWith("@lid") && !lidToPn.has(chatId)) {
                  lidToPn.set(chatId, await canonicalChatJid(socket, chatId));
                }
              }
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
                // T94-F M5codex: the synced-mark list canonicalizes TOO — the
                // raw @lid ids re-created phantom chat rows the merge removes
                markHistorySynced(
                  store,
                  (history.chats ?? [])
                    .map((chat) => chat.id)
                    .filter((id): id is string => typeof id === "string")
                    .map((id) => (id.endsWith("@lid") ? (lidToPn.get(id) ?? id) : id)),
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
              username?: string;
              lid?: string;
              phoneNumber?: string;
            }>;
            if (opts.store !== undefined) {
              for (const contact of contacts) {
                if (typeof contact.id !== "string" || contact.id.length === 0) {
                  continue;
                }
                // R2-2B: LID ids land on their PN row; all-NULL rows are skipped
                upsertResolvedContact(
                  opts.store,
                  {
                    jid: contact.id,
                    name: contact.name,
                    pushname: contact.notify,
                    businessName: contact.verifiedName,
                    username: contact.username,
                    lid: contact.lid,
                    phone: contact.phoneNumber,
                  },
                  resolvePn,
                );
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
        })().catch((err: unknown) => {
          opts.logger?.error({ err, event: name }, "event handler failed — contained");
        });
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
      // T94-F Runtime-M5: an explicit resume clears a persisted logout —
      // the operator asked for a fresh pairing
      if ((state.creds as { waMcpLoggedOut?: boolean }).waMcpLoggedOut === true) {
        delete (state.creds as { waMcpLoggedOut?: boolean }).waMcpLoggedOut;
        void queueSave().catch((err: unknown) => {
          opts.logger?.warn({ err }, "failed to clear the logged-out marker");
        });
      }
      if (status === "pairing-blocked" || status === "logged-out") {
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
    contactsWarm: () => contactsWarmDone,
    fetchHistory: async (chatJid: string, count: number) => {
      const current = socket;
      if (current === null || current === undefined) {
        throw new Error("bridge not connected");
      }
      const oldest = opts.store?.db
        .prepare(
          "SELECT id, is_from_me, timestamp FROM messages WHERE chat_jid = ? ORDER BY timestamp ASC LIMIT 1",
        )
        .get(chatJid) as { id: string; is_from_me: number; timestamp: string } | undefined;
      const fetcher = (
        current as unknown as {
          fetchMessageHistory?: (
            count: number,
            key: { remoteJid: string; fromMe: boolean; id: string },
            tsMs: number,
          ) => Promise<string>;
        }
      ).fetchMessageHistory;
      if (typeof fetcher !== "function") {
        throw new Error("engine does not expose fetchMessageHistory");
      }
      if (oldest === undefined) {
        // no local anchor: ask the engine with the chat jid itself as cursor
        const requestId = await fetcher(
          count,
          { remoteJid: chatJid, fromMe: false, id: chatJid },
          0,
        );
        return { requested: true, request_id: String(requestId ?? "") };
      }
      const oldestTs = new Date(oldest.timestamp).getTime();
      const requestId = await fetcher(
        count,
        { remoteJid: chatJid, fromMe: oldest.is_from_me === 1, id: oldest.id },
        oldestTs,
      );
      return { requested: true, request_id: String(requestId ?? "") };
    },
    logout: async () => {
      // T84 line92: creds are KEPT but the session is marked logged-out —
      // closed=true stops every auto-reconnect path from here on.
      closed = true;
      status = "logged-out";
      (state.creds as { waMcpLoggedOut?: boolean }).waMcpLoggedOut = true;
      // T94-F Runtime-M5: the marker MUST survive restart — persist it
      void queueSave().catch((err: unknown) => {
        opts.logger?.warn({ err }, "failed to persist the logged-out marker");
      });
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
      // T94-F M8 (CODEX): shutdown awaits close() then exits — the save
      // chain must drain or a creds write is cut mid-flight
      await saveChain.catch(() => undefined);
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
