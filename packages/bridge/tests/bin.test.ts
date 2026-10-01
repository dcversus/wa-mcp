import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { buildConfig, ensureToken, redactPhone } from "../src/bin.ts";

test("buildConfig applies all defaults from an empty env", () => {
  const config = buildConfig({});
  expect(config.dataDir).toBe(join(homedir(), ".wa-mcp"));
  expect(config.host).toBe("127.0.0.1");
  expect(config.port).toBe(8080);
  expect(config.deviceName).toBeUndefined();
  expect(config.syncFullHistory).toBe(false);
  expect(config.token).toBeNull();
  expect(config.tokenPath).toBe(join(homedir(), ".wa-mcp", "token"));
});

test("buildConfig reads every override from env", () => {
  const config = buildConfig({
    WA_DATA_DIR: "/tmp/wa-data",
    WA_BIND_HOST: "0.0.0.0",
    WA_PORT: "9090",
    WA_DEVICE_NAME: "dc-bridge",
    WA_SYNC_FULL_HISTORY: "1",
    WA_TOKEN: "env-secret",
  });
  expect(config.dataDir).toBe("/tmp/wa-data");
  expect(config.host).toBe("0.0.0.0");
  expect(config.port).toBe(9090);
  expect(config.deviceName).toBe("dc-bridge");
  expect(config.syncFullHistory).toBe(true);
  expect(config.token).toBe("env-secret");
  expect(config.tokenPath).toBe("/tmp/wa-data/token");
});

test("buildConfig accepts true and rejects other values for WA_SYNC_FULL_HISTORY", () => {
  expect(buildConfig({ WA_SYNC_FULL_HISTORY: "true" }).syncFullHistory).toBe(true);
  expect(buildConfig({ WA_SYNC_FULL_HISTORY: "0" }).syncFullHistory).toBe(false);
  expect(buildConfig({ WA_SYNC_FULL_HISTORY: "yes" }).syncFullHistory).toBe(false);
});

test("buildConfig falls back to the default port on a non-numeric WA_PORT", () => {
  expect(buildConfig({ WA_PORT: "not-a-number" }).port).toBe(8080);
  expect(buildConfig({ WA_PORT: "0" }).port).toBe(8080);
  expect(buildConfig({ WA_PORT: "-5" }).port).toBe(8080);
});

test("redactPhone keeps only the last four digits", () => {
  expect(redactPhone("+358497773518")).toBe("***3518");
  expect(redactPhone("358497773518")).toBe("***3518");
});

test("ensureToken generates and persists a 0600 token file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-bin-"));
  const config = buildConfig({ WA_DATA_DIR: dir });
  const token = await ensureToken(config);
  expect(token).toMatch(/^[0-9a-f]{64}$/);
  const file = join(dir, "token");
  expect(readFileSync(file, "utf8").trim()).toBe(token);
  expect(statSync(file).mode & 0o777).toBe(0o600);
});

test("ensureToken reuses an existing token file", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-bin-"));
  writeFileSync(join(dir, "token"), "existing-token\n", { mode: 0o600 });
  const token = await ensureToken(buildConfig({ WA_DATA_DIR: dir }));
  expect(token).toBe("existing-token");
});

test("ensureToken prefers an env token and never writes it", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-bin-"));
  const token = await ensureToken(buildConfig({ WA_DATA_DIR: dir, WA_TOKEN: "env-secret" }));
  expect(token).toBe("env-secret");
  expect(existsSync(join(dir, "token"))).toBe(false);
});
