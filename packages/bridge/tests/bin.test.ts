import { existsSync, mkdtempSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vite-plus/test";
import type { WASocket } from "baileys";
import {
  buildConfig,
  createScheduledSender,
  ensureMediaDir,
  ensureToken,
  redactPhone,
} from "../src/bin.ts";
import { addSendRule } from "../src/store/send-rules.ts";
import { setAlias } from "../src/store/contacts.ts";
import { openStore } from "../src/store/schema.ts";
import { SendGuard } from "../src/send/safety.ts";

const POSIX_PERMS = process.platform !== "win32";

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
  expect(config.tokenPath).toBe(join("/tmp/wa-data", "token"));
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

test.skipIf(!POSIX_PERMS)("ensureToken generates and persists a 0600 token file", async () => {
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

test("buildConfig reads WA_DAILY_CAP as an integer or falls back to null", () => {
  expect(buildConfig({}).dailyCap).toBeNull();
  expect(buildConfig({ WA_DAILY_CAP: "500" }).dailyCap).toBe(500);
  expect(buildConfig({ WA_DAILY_CAP: "many" }).dailyCap).toBeNull();
  expect(buildConfig({ WA_DAILY_CAP: "0" }).dailyCap).toBeNull();
});

describe("T61 media dir default", () => {
  test("buildConfig defaults mediaDir to <dataDir>/media; WA_MEDIA_DIR overrides", () => {
    const defaults = buildConfig({ WA_DATA_DIR: "/tmp/wa-t61-data" });
    expect(defaults.mediaDir).toBe("/tmp/wa-t61-data/media");
    const overridden = buildConfig({ WA_DATA_DIR: "/tmp/wa-t61-data", WA_MEDIA_DIR: "/mnt/media" });
    expect(overridden.mediaDir).toBe("/mnt/media");
  });

  test("ensureMediaDir creates the dir 0700 and is idempotent", () => {
    const dir = join(mkdtempSync("/tmp/wa-t61-"), "media");
    ensureMediaDir(dir);
    expect(existsSync(dir)).toBe(true);
    ensureMediaDir(dir);
    expect(existsSync(dir)).toBe(true);
  });
});

test("T94-C-H5 — the daemon hands startBridge the mediaDir (auto-download live)", () => {
  // CODEX review H5: mediaDir reached only createHttpServer — startBridge
  // never got it, so T93-D's auto-download + backfill were inert in the real
  // daemon (both early-return when opts.mediaDir === undefined)
  const source = readFileSync(new URL("../src/bin.ts", import.meta.url), "utf8");
  const start = source.indexOf("startBridge(authDir, {");
  expect(start).toBeGreaterThan(-1);
  const block = source.slice(start, source.indexOf("});", start));
  expect(block).toContain("mediaDir: config.mediaDir");
});

describe("T94-D-H3 — the scheduler send gate (CODEX H3)", () => {
  const TARGET = "358400000042@s.whatsapp.net";

  function senderFixture(dailyCap = 100) {
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-schedgate-")));
    const sendMessage = vi.fn(async () => ({ key: { id: "SCHED1", fromMe: true } }));
    const socket = { sendMessage } as unknown as WASocket;
    const sendGuard = new SendGuard(store, { minIntervalMs: 0, dailyCap });
    const sender = createScheduledSender({ store, sendGuard, socket, mediaDir: tmpdir() });
    return { store, sendMessage, sendGuard, sender };
  }

  test("a blocked target refuses with the structured reason", async () => {
    const { store, sendMessage, sender } = senderFixture();
    addSendRule(store, { target: TARGET, mode: "block" });
    // RED today: the scheduler called sendViaSocket directly — no rules
    await expect(sender(TARGET, "hi")).rejects.toThrow("SEND_BLOCKED");
    expect(sendMessage).not.toHaveBeenCalled();
    store.close();
  });

  test("targets canonicalize before the rules run (alias/phone cannot dodge)", async () => {
    const { store, sendMessage, sender } = senderFixture();
    store.db.prepare("INSERT INTO contacts (jid, name) VALUES (?, ?)").run(TARGET, "Mom");
    setAlias(store, TARGET, "mom");
    addSendRule(store, { target: TARGET, mode: "block" });
    // RED today: the raw alias string never matched the rule
    await expect(sender("mom", "hi")).rejects.toThrow("SEND_BLOCKED");
    expect(sendMessage).not.toHaveBeenCalled();
    store.close();
  });

  test("the daily budget is consumed and enforced", async () => {
    const { store, sender } = senderFixture(1);
    await sender(TARGET, "one");
    // RED today: scheduled sends never drew from the budget
    await expect(sender(TARGET, "two")).rejects.toThrow("DAILY_CAP_EXCEEDED");
    store.close();
  });

  test("happy path sends to the canonical jid", async () => {
    const { store, sendMessage, sender } = senderFixture();
    const id = await sender("+358 497 773 518", "hello");
    expect(id).toBe("SCHED1");
    const call = (sendMessage as ReturnType<typeof vi.fn>).mock.calls[0] as [string, unknown];
    expect(call[0]).toBe("358497773518@s.whatsapp.net");
    store.close();
  });
});

describe("T94-F M4 — the daemon survives stray rejections", () => {
  test("installRejectionGuard registers a handler that logs instead of throwing", async () => {
    const { installRejectionGuard } = (await import("../src/bin.ts")) as {
      installRejectionGuard: (
        target: NodeJS.Process,
        logger: { error: (...a: unknown[]) => void },
      ) => void;
    };
    const logged: unknown[] = [];
    const onMock = vi.fn();
    const fakeProcess = { on: onMock } as unknown as NodeJS.Process;
    installRejectionGuard(fakeProcess, { error: (...a: unknown[]) => logged.push(a) });
    expect(onMock).toHaveBeenCalledWith("unhandledRejection", expect.any(Function));
    const handler = onMock.mock.calls[0]?.[1] as (reason: unknown) => void;
    expect(() => handler(new Error("stray"))).not.toThrow();
    expect(logged.length).toBeGreaterThan(0);
  });

  test("the scheduler tick's processDue promise carries a .catch", () => {
    const source = readFileSync(new URL("../src/bin.ts", import.meta.url), "utf8");
    const tick = source.slice(source.indexOf("void processDue("), source.indexOf("}, 30_000)"));
    expect(tick).toContain(".catch(");
  });
});
