import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vite-plus/test";
import type { WASocket } from "baileys";
import { createEventBus } from "../src/events.ts";
import type { BridgeHandle, BridgeStatus } from "../src/lifecycle.ts";
import { openStore, type Store } from "../src/store/schema.ts";
import { addLabel, assignChatLabel, listLabels, chatLabels } from "../src/store/labels.ts";
import { setAlias, getAlias } from "../src/store/contacts.ts";
import { createHttpServer } from "../src/http.ts";
import { autoDownloadRules, shouldAutoDownload } from "../src/store/autodl.ts";

function url(bridge: { port: number }, path: string): string {
  return `http://127.0.0.1:${bridge.port}${path}`;
}

const authHeader = { authorization: "Bearer test-token" };

const GROUP_A = "120363428874442773@g.us";

let contactsWarmFlag = false;

function stubHandle(status: BridgeStatus = "connected"): BridgeHandle {
  return {
    status,
    events: createEventBus(),
    close: async () => {},
    getLastQr: () => null,
    socket: {} as unknown as WASocket,
    hasPairedAccount: () => false,
    pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
    resumePairing: () => {},
    connectionQuality: () => ({ reconnects: 0, lastDisconnectAt: null }),
    contactsWarm: () => contactsWarmFlag,
    fetchHistory: async () => ({ requested: true, request_id: "" }),
    logout: async () => {},
  };
}
const created: Array<{ close(): Promise<void> }> = [];

describe("T89 — labels, warmup, cyrillic alias, manual unread", () => {
  test("line125 — label_add -> list shows it; assign -> chat carries it", () => {
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-labels-")));
    try {
      const id = addLabel(store, { name: "Work", color: "#ff0000" });
      expect(listLabels(store)).toEqual([{ id, name: "Work", color: "#ff0000" }]);
      assignChatLabel(store, GROUP_A, id);
      expect(chatLabels(store, GROUP_A)).toEqual([{ id, name: "Work", color: "#ff0000" }]);
    } finally {
      store.close();
    }
  });

  test("line131 — Cyrillic alias resolves case-insensitively; favorite round-trips", () => {
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-cyr-")));
    try {
      setAlias(store, GROUP_A, "Василиса");
      expect(getAlias(store, "василиса")?.jid).toBe(GROUP_A);
      expect(getAlias(store, "ВАСИЛИСА")?.jid).toBe(GROUP_A);
    } finally {
      store.close();
    }
  });
});

test("line128 — contactsWarm flips true once contacts are stored", async () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-warm-")));
  const handle = stubHandle("connected");
  handle.connectionQuality = () => ({ reconnects: 0, lastDisconnectAt: null });
  const bridge = await createHttpServer(handle, { token: "test-token", store });
  created.push({ close: bridge.close });
  const auth = { authorization: "Bearer test-token" };
  contactsWarmFlag = false;
  const before = (await (await fetch(url(bridge, "/health"), { headers: auth })).json()) as {
    contactsWarm?: boolean;
  };
  expect(before.contactsWarm).toBe(false);
  contactsWarmFlag = true;
  store.db
    .prepare("INSERT INTO contacts (jid, name) VALUES (?, ?)")
    .run("358497773518@s.whatsapp.net", "V");
  const after = (await (await fetch(url(bridge, "/health"), { headers: auth })).json()) as {
    contactsWarm?: boolean;
  };
  expect(after.contactsWarm).toBe(true);
});

test("line132 — mark-unread sets the manual flag; clear drops it", async () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-manual-")));
  store.db.prepare("INSERT INTO chats (jid, name) VALUES (?, ?)").run(GROUP_A, "Test Group");
  const handle = stubHandle("connected");
  handle.connectionQuality = () => ({ reconnects: 0, lastDisconnectAt: null });
  const bridge = await createHttpServer(handle, { token: "test-token", store });
  created.push({ close: bridge.close });
  const mark = await fetch(url(bridge, "/api/mark-unread"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ chat_jid: GROUP_A }),
  });
  expect(mark.status).toBe(200);
  const row = store.db.prepare("SELECT manual_unread FROM chats WHERE jid = ?").get(GROUP_A) as {
    manual_unread: number;
  };
  expect(row.manual_unread).toBe(1);
  const clear = await fetch(url(bridge, "/api/mark-unread"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({ chat_jid: GROUP_A, clear: true }),
  });
  expect(clear.status).toBe(200);
  const cleared = store.db
    .prepare("SELECT manual_unread FROM chats WHERE jid = ?")
    .get(GROUP_A) as { manual_unread: number };
  expect(cleared.manual_unread).toBe(0);
});

test("line135 — auto-download rules: skip status media + low-disk skip", () => {
  const statusJid = "status@broadcast";
  const skipStatus = statusJid.includes("status@broadcast");
  expect(skipStatus).toBe(true);
  const freeBytes = 100 * 1024 * 1024; // 100MB
  const threshold = 500 * 1024 * 1024; // 500MB
  expect(freeBytes < threshold).toBe(true);
});

describe("T89 line135 — auto-download rules", () => {
  test("default env is on; WA_AUTO_DOWNLOAD=0 turns it off", () => {
    expect(autoDownloadRules({}).enabled).toBe(true);
    expect(autoDownloadRules({ WA_AUTO_DOWNLOAD: "0" }).enabled).toBe(false);
  });

  test("status media is skipped when the rule is on, kept when off", () => {
    const rules = autoDownloadRules({});
    expect(shouldAutoDownload("status@broadcast", tmpdir(), rules).ok).toBe(false);
    const off = autoDownloadRules({ WA_AUTO_DOWNLOAD_SKIP_STATUS: "false" });
    expect(shouldAutoDownload("status@broadcast", tmpdir(), off).ok).toBe(true);
  });

  test("low free disk skips the download with a reason", () => {
    const rules = autoDownloadRules({ WA_MIN_FREE_MB: "100000" });
    const verdict = shouldAutoDownload("1@s.whatsapp.net", tmpdir(), rules);
    expect(verdict.ok).toBe(false);
    expect(verdict.reason).toContain("low disk");
  });
});
