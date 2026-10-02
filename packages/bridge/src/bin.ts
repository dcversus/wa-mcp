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
import { installShutdownHooks } from "./shutdown.ts";
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
  };
}

export function redactPhone(phone: string): string {
  return `***${phone.slice(-4)}`;
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
  });
  const server = await createHttpServer(handle, {
    token,
    host: config.host,
    port: config.port,
    qrPngPath,
    qrDir: config.dataDir,
    store,
    version: "0.9.0",
    sendGuard: new SendGuard(store, config.dailyCap === null ? {} : { dailyCap: config.dailyCap }),
    uiDir: config.uiDir ?? fileURLToPath(new URL("./web", import.meta.url)),
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
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--data-dir" || arg === "--port" || arg === "--ui-dir") {
      const value = argv[index + 1];
      if (value !== undefined) {
        cli[arg.slice(2) as "dataDir" | "port" | "uiDir"] = value;
        index += 1;
      }
    }
  }
  void main(cli);
}
