#!/usr/bin/env node
import { randomBytes } from "node:crypto";
import {
  chmodSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  realpathSync,
} from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import pino from "pino";
import { openAuthStore } from "./auth.ts";
import { createHttpServer } from "./http.ts";
import { acquireLock } from "./lock.ts";
import { startBridge } from "./lifecycle.ts";
import { processDue } from "./store/scheduled.ts";
import { runBackup } from "./store/backup.ts";
import { resolveMedia } from "./media/resolve.ts";
import { resolveRecipient, sendViaSocket } from "./send/send.ts";
import { evaluateSendRules } from "./store/send-rules.ts";
import type { AnyMessageContent, WASocket } from "baileys";
import { installShutdownHooks } from "./shutdown.ts";
import { resolveChannel } from "./channels/cloud/config.ts";
import { SendGuard } from "./send/safety.ts";
import { openStore } from "./store/schema.ts";

export interface BridgeConfig {
  dataDir: string;
  host: string;
  port: number;
  deviceName?: string;
  syncFullHistory: boolean;
  token: string | null;
  tokenPath: string;
  dailyCap: number | null;
  uiDir?: string;
  mediaDir: string;
}

export function buildConfig(env: Record<string, string | undefined>): BridgeConfig {
  const dataDir = env.WA_DATA_DIR ?? join(homedir(), ".wa-mcp");
  const rawPort = env.WA_PORT === undefined ? NaN : Number(env.WA_PORT);
  const port = Number.isInteger(rawPort) && rawPort > 0 ? rawPort : 8080;
  const syncFull = env.WA_SYNC_FULL_HISTORY;
  const rawCap = env.WA_DAILY_CAP === undefined ? NaN : Number(env.WA_DAILY_CAP);
  return {
    dataDir,
    host: env.WA_BIND_HOST ?? "127.0.0.1",
    port,
    deviceName: env.WA_DEVICE_NAME,
    syncFullHistory: syncFull === "1" || syncFull === "true",
    token: env.WA_TOKEN ?? null,
    tokenPath: join(dataDir, "token"),
    dailyCap: Number.isInteger(rawCap) && rawCap > 0 ? rawCap : null,
    uiDir: env.WA_UI_DIR,
    mediaDir: env.WA_MEDIA_DIR ?? join(dataDir, "media"),
  };
}

export function redactPhone(phone: string): string {
  return `***${phone.slice(-4)}`;
}

/** T61: the default daemon must be able to SEND media — the media dir is
 * part of the data layout and is created (0700) at boot if absent. */
export function ensureMediaDir(dir: string): void {
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  chmodSync(dir, 0o700);
}

export async function ensureToken(config: BridgeConfig): Promise<string> {
  if (config.token !== null) {
    return config.token;
  }
  if (existsSync(config.tokenPath)) {
    const existing = readFileSync(config.tokenPath, "utf8").trim();
    if (existing.length > 0) {
      return existing;
    }
  }
  const generated = randomBytes(32).toString("hex");
  mkdirSync(config.dataDir, { recursive: true, mode: 0o700 });
  writeFileSync(config.tokenPath, `${generated}\n`, { mode: 0o600 });
  chmodSync(config.tokenPath, 0o600);
  return generated;
}

/** T94-D-H3 (CODEX H3): the scheduler's send callback — the SAME gate as
 * /api/send: recipient canonicalization, restrict rules, the daemon-wide
 * budget. Refusals throw structured errors that processDue persists. */
export function createScheduledSender(deps: {
  store: ReturnType<typeof import("./store/schema.ts").openStore>;
  sendGuard: SendGuard;
  socket: WASocket;
  mediaDir: string;
}): (chatJid: string, payload: string | Record<string, unknown>) => Promise<string> {
  const { store, sendGuard, socket, mediaDir } = deps;
  return async (chatJid, payload) => {
    if (socket === undefined || socket === null) {
      throw new Error("bridge not connected");
    }
    const resolution = resolveRecipient(store, chatJid);
    if (!resolution.ok) {
      throw new Error(`${resolution.code}: ${resolution.message}`);
    }
    const target = resolution.jid;
    const rules = evaluateSendRules(store, target);
    if (!rules.allowed) {
      throw new Error(
        `SEND_BLOCKED: sending to ${target} is blocked by rule #${rules.rule?.id} (${rules.rule?.target})`,
      );
    }
    const budget = sendGuard.check(Date.now());
    if (!budget.ok) {
      throw new Error(
        budget.code === "RATE_LIMITED"
          ? `RATE_LIMITED: sending too fast`
          : `DAILY_CAP_EXCEEDED: daily send cap of ${budget.cap} reached`,
      );
    }
    let result: { messageId: string };
    if (typeof payload === "string") {
      result = await sendViaSocket(socket, target, { text: payload } as AnyMessageContent);
    } else {
      // T84-B line98: media payloads route through resolveMedia like /api/send
      const kind = String(payload.kind ?? "image");
      const resolved = await resolveMedia(
        typeof payload.url === "string"
          ? { url: payload.url }
          : { base64: String(payload.base64 ?? "") },
        { mediaDir, fetchFn: undefined },
      );
      result = await sendViaSocket(socket, target, {
        [kind]: resolved.buffer,
        mimetype: resolved.mimeType,
      } as unknown as AnyMessageContent);
    }
    return result.messageId;
  };
}

/** T94-F Runtime-M4 (RUNTIME review): Node >= 15 TERMINATES on an
 * unhandled rejection — one stray promise must never kill the daemon.
 * Log loudly, keep serving. */
export function installRejectionGuard(
  target: NodeJS.Process,
  logger: { error: (...args: unknown[]) => void },
): void {
  target.on("unhandledRejection", (reason) => {
    logger.error(
      { err: reason instanceof Error ? { message: reason.message, stack: reason.stack } : reason },
      "unhandled rejection contained — daemon continues",
    );
  });
}

export async function main(
  cli: { dataDir?: string; port?: string; uiDir?: string } = {},
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const config = buildConfig(env);
  if (cli.dataDir !== undefined) {
    config.dataDir = cli.dataDir;
    config.tokenPath = join(cli.dataDir, "token");
  }
  if (cli.port !== undefined) {
    config.port = Number(cli.port);
  }
  if (cli.uiDir !== undefined) {
    config.uiDir = cli.uiDir;
  }
  const logger = pino({ level: env.WA_LOG_LEVEL ?? "info" }, pino.destination({ fd: 2 }));
  installRejectionGuard(process, logger);
  // T94-G: the STABLE ui-bootstrap credential — the pairing token rotates
  // per boot, so this file (0600) is what a fresh browser bootstraps from
  // on a PAIRED daemon. Owner rule: zero user actions.
  const uiBootstrapPath = join(config.dataDir, "ui-bootstrap-token");
  let uiBootstrapToken: string;
  if (existsSync(uiBootstrapPath)) {
    uiBootstrapToken = readFileSync(uiBootstrapPath, "utf8").trim();
  } else {
    uiBootstrapToken = randomBytes(24).toString("hex");
    writeFileSync(uiBootstrapPath, uiBootstrapToken, { mode: 0o600 });
  }
  // T94-F Runtime-M9: runBackup existed since T80 but was NEVER called
  const backupsRoot = join(config.dataDir, "backups");
  const runNightlyBackup = (): void => {
    try {
      const dir = runBackup(config.dataDir, backupsRoot, 1);
      logger.info({ dir }, "store backup written");
    } catch (err) {
      logger.warn({ err }, "store backup failed");
    }
  };
  runNightlyBackup();
  const backupTimer = setInterval(runNightlyBackup, 24 * 60 * 60 * 1000);
  backupTimer.unref();
  let lock;
  try {
    lock = acquireLock(config.dataDir);
  } catch (err) {
    logger.error(
      { err: err instanceof Error ? err.message : String(err) },
      "bridge startup failed",
    );
    process.exitCode = 1;
    return;
  }
  ensureMediaDir(config.mediaDir);
  const token = await ensureToken(config);
  const authDir = join(config.dataDir, "auth");
  void openAuthStore(authDir);
  const store = openStore(join(config.dataDir, "store"));
  const qrPngPath = join(config.dataDir, "qr.png");
  // T94-C2(f): ONE daemon-wide budget — the bridge (autoreply), the HTTP
  // surface and the scheduler all draw from the same SendGuard
  const sendGuard = new SendGuard(
    store,
    config.dailyCap === null ? {} : { dailyCap: config.dailyCap },
  );
  const handle = await startBridge(authDir, {
    syncFullHistory: config.syncFullHistory,
    deviceName: config.deviceName,
    logger,
    qrPngPath,
    store,
    // CODEX H5: inbound media auto-download + the startup backfill are
    // no-ops without it (lifecycle early-returns on mediaDir === undefined)
    mediaDir: config.mediaDir,
    sendGuard,
  });
  // T82 line88: daemon scheduler — every 30s, due scheduled texts are sent
  // through the live socket and marked sent/failed.
  let schedulerBusy = false;
  const schedulerTimer = setInterval(() => {
    if (schedulerBusy) {
      return;
    }
    schedulerBusy = true;
    void processDue(
      store,
      new Date(),
      createScheduledSender({
        store,
        sendGuard,
        socket: handle.socket,
        mediaDir: config.mediaDir,
      }),
    )
      .catch((err: unknown) => {
        logger.error(
          { err: err instanceof Error ? err.message : String(err) },
          "scheduler tick failed",
        );
      })
      .finally(() => {
        schedulerBusy = false;
      });
  }, 30_000);
  schedulerTimer.unref();

  const selection = resolveChannel(env);
  let cloud: Parameters<typeof createHttpServer>[1]["cloud"];
  if (selection.channel === "cloud" && "errors" in selection) {
    logger.error(
      { errors: selection.errors },
      "cloud channel configuration invalid — daemon not started",
    );
    process.exitCode = 1;
    return;
  }
  if (selection.channel === "cloud") {
    const { CloudApiAdapter } = await import("./channels/cloud/adapter.ts");
    cloud = {
      adapter: new CloudApiAdapter(selection.config),
      config: selection.config,
    };
    logger.info({ phoneNumberId: selection.config.phoneNumberId }, "cloud channel surface enabled");
  }
  // ephemeral per-boot token for the PUBLIC pairing surface (health already
  // exposes it); scoped to /api/qr + /api/pairing-code + /api/pair/resume
  const pairingToken = randomBytes(24).toString("hex");
  const server = await createHttpServer(handle, {
    dataDir: config.dataDir,
    token,
    pairingToken,
    host: config.host,
    port: config.port,
    qrPngPath,
    qrDir: config.dataDir,
    subscriptionsDir: config.dataDir,
    store,
    version: "0.9.0",
    sendGuard,
    uiBootstrapToken,
    uiDir: config.uiDir ?? fileURLToPath(new URL("./web", import.meta.url)),
    mediaDir: config.mediaDir,
    cloud,
    logger,
  });
  logger.info(
    { host: config.host, port: server.port, dataDir: config.dataDir },
    "wa-mcp bridge listening",
  );
  installShutdownHooks({ http: server, bridge: handle, store, lock, logger });
}

if (
  process.argv[1] !== undefined &&
  import.meta.url === pathToFileURL(realpathSync(process.argv[1])).href
) {
  const cli: { dataDir?: string; port?: string; uiDir?: string } = {};
  const argv = process.argv.slice(2);
  const flagToKey: Record<string, "dataDir" | "port" | "uiDir"> = {
    "--data-dir": "dataDir",
    "--port": "port",
    "--ui-dir": "uiDir",
  };
  for (let index = 0; index < argv.length; index += 1) {
    const key = flagToKey[argv[index] ?? ""];
    if (key !== undefined) {
      const value = argv[index + 1];
      if (value !== undefined) {
        cli[key] = value;
        index += 1;
      }
    }
  }
  void main(cli);
}
