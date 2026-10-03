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
import { dueScheduled, markScheduled } from "./store/scheduled.ts";
import { sendViaSocket } from "./send/send.ts";
import type { AnyMessageContent } from "baileys";
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
  const handle = await startBridge(authDir, {
    syncFullHistory: config.syncFullHistory,
    deviceName: config.deviceName,
    logger,
    qrPngPath,
    store,
  });
  // T82 line88: daemon scheduler — every 30s, due scheduled texts are sent
  // through the live socket and marked sent/failed.
  let schedulerBusy = false;
  const schedulerTimer = setInterval(() => {
    if (schedulerBusy) {
      return;
    }
    schedulerBusy = true;
    void (async () => {
      const due = dueScheduled(store, new Date());
      for (const row of due) {
        const socket = handle.socket;
        if (socket === undefined || socket === null) {
          return;
        }
        try {
          const result = await sendViaSocket(socket, row.chat_jid, {
            text: row.payload,
          } as AnyMessageContent);
          markScheduled(store, row.id, "sent", result.messageId);
        } catch (err: unknown) {
          markScheduled(store, row.id, "failed");
          logger.warn({ err, id: row.id }, "scheduled send failed");
        }
      }
    })().finally(() => {
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
    token,
    pairingToken,
    host: config.host,
    port: config.port,
    qrPngPath,
    qrDir: config.dataDir,
    store,
    version: "0.9.0",
    sendGuard: new SendGuard(store, config.dailyCap === null ? {} : { dailyCap: config.dailyCap }),
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
