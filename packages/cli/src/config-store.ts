import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";

export const CONFIG_KEYS = [
  "transcription.engine",
  "transcription.api_key",
  "transcription.base_url",
  "transcription.model",
] as const;

export type ConfigKey = (typeof CONFIG_KEYS)[number];

export interface TranscriptionConfig {
  engine?: string;
  api_key?: string;
  base_url?: string;
  model?: string;
}

export interface BridgeConfig {
  transcription?: TranscriptionConfig;
}

export function maskSecret(value: string): string {
  if (value.length <= 8) {
    return `${value.slice(0, 1)}…${value.slice(-1)}`;
  }
  return `${value.slice(0, 3)}…${value.slice(-4)}`;
}

export function configPath(dataDir: string): string {
  return join(dataDir, "config.json");
}

export function loadConfig(dataDir: string): BridgeConfig {
  const path = configPath(dataDir);
  if (!existsSync(path)) {
    return {};
  }
  const mode = statSync(path).mode & 0o077;
  if ((mode & 0o044) !== 0) {
    throw new Error(
      `config.json permissions too open (${mode.toString(8)}) — expected 0600; run: chmod 600 ${path}`,
    );
  }
  return JSON.parse(readFileSync(path, "utf8")) as BridgeConfig;
}

export function saveConfig(dataDir: string, config: BridgeConfig): void {
  const path = configPath(dataDir);
  writeFileSync(path, JSON.stringify(config, null, 2) + "\n", { mode: 0o600 });
}

export function setConfigValue(dataDir: string, key: ConfigKey, value: string): BridgeConfig {
  const config = loadConfig(dataDir);
  const [section, field] = key.split(".") as [keyof BridgeConfig, string];
  const target = (config[section] ?? {}) as Record<string, string>;
  target[field] = value;
  (config as Record<string, unknown>)[section as string] = target;
  saveConfig(dataDir, config);
  return config;
}

export function unsetConfigValue(dataDir: string, key: ConfigKey): BridgeConfig {
  const config = loadConfig(dataDir);
  const [section, field] = key.split(".") as [keyof BridgeConfig, string];
  const target = (config[section] ?? {}) as Record<string, string | undefined>;
  delete target[field];
  (config as Record<string, unknown>)[section as string] = target;
  saveConfig(dataDir, config);
  return config;
}
