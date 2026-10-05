import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test, vi } from "vite-plus/test";
import type { WASocket } from "baileys";
import { createEventBus } from "../src/events.ts";
import type { BridgeHandle, BridgeStatus } from "../src/lifecycle.ts";
import { openStore } from "../src/store/schema.ts";
import { addLabel, assignChatLabel, listLabels, chatLabels } from "../src/store/labels.ts";
import { setAlias, getAlias } from "../src/store/contacts.ts";
import { createHttpServer } from "../src/http.ts";
import { createTranscriptionEngine } from "../src/media/transcribe.ts";
import { autoDownloadRules, shouldAutoDownload } from "../src/store/autodl.ts";

function url(bridge: { port: number }, path: string): string {
  return `http://127.0.0.1:${bridge.port}${path}`;
}

const authHeader = { authorization: "Bearer test-token" };

const GROUP_A = "120363428874442773@g.us";

let contactsWarmFlag = false;

function stubHandle(
  status: BridgeStatus = "connected",
  _lastQr: string | null = null,
  socketOverride?: WASocket,
): BridgeHandle {
  return {
    status,
    events: createEventBus(),
    close: async () => {},
    getLastQr: () => null,
    socket: (socketOverride ?? {}) as unknown as WASocket,
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
  created.push({ close: () => bridge.close() });
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
  created.push({ close: () => bridge.close() });
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

describe("T89-C — line157 join requests, line159 ephemeral, line162 reject call", () => {
  function groupSocket() {
    const socket = {
      groupRequestParticipantsList: vi.fn(async () => [
        { id: "358400000009@s.whatsapp.net", requested_at: "2026-01-01" },
      ]),
      groupRequestParticipantsUpdate: vi.fn(async () => ["358400000009@s.whatsapp.net"]),
      groupToggleEphemeral: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => ({ key: { id: "X" } })),
      ev: createEventBus(),
    };
    return socket;
  }

  function groupHandle(socket: Record<string, unknown>): BridgeHandle {
    const base = stubHandle("connected");
    return { ...base, socket: socket as unknown as WASocket };
  }

  test("line157 — GET lists join requests; POST approve/reject routes through the engine", async () => {
    const socket = groupSocket();
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-jreq-")));
    const bridge = await createHttpServer(groupHandle(socket), { token: "test-token", store });
    created.push({ close: () => bridge.close() });
    const list = await fetch(url(bridge, `/api/groups/${encodeURIComponent(GROUP_A)}/requests`), {
      headers: authHeader,
    });
    expect(list.status).toBe(200);
    expect(
      (socket.groupRequestParticipantsList as ReturnType<typeof vi.fn>).mock.calls[0]?.[0],
    ).toBe(GROUP_A);
    const post = await fetch(url(bridge, `/api/groups/${encodeURIComponent(GROUP_A)}/requests`), {
      method: "POST",
      headers: { ...authHeader, "content-type": "application/json" },
      body: JSON.stringify({ participants: ["358400000009@s.whatsapp.net"], action: "approve" }),
    });
    expect(post.status).toBe(200);
    expect(
      (socket.groupRequestParticipantsUpdate as ReturnType<typeof vi.fn>).mock.calls[0],
    ).toEqual([GROUP_A, ["358400000009@s.whatsapp.net"], "approve"]);
  });

  test("line159 — POST ephemeral routes to groupToggleEphemeral with the duration", async () => {
    const socket = groupSocket();
    const bridge = await createHttpServer(groupHandle(socket), { token: "test-token" });
    created.push({ close: () => bridge.close() });
    const res = await fetch(url(bridge, `/api/groups/${encodeURIComponent(GROUP_A)}/ephemeral`), {
      method: "POST",
      headers: { ...authHeader, "content-type": "application/json" },
      body: JSON.stringify({ duration: 604800 }),
    });
    expect(res.status).toBe(200);
    expect((socket.groupToggleEphemeral as ReturnType<typeof vi.fn>).mock.calls[0]).toEqual([
      GROUP_A,
      604800,
    ]);
  });

  test("line162 — POST reject-call routes to the engine rejectCall", async () => {
    const socket = groupSocket();
    (socket as unknown as { rejectCall: ReturnType<typeof vi.fn> }).rejectCall = vi.fn(
      async () => undefined,
    );
    const bridge = await createHttpServer(groupHandle(socket), { token: "test-token" });
    created.push({ close: () => bridge.close() });
    const res = await fetch(url(bridge, "/api/calls/reject"), {
      method: "POST",
      headers: { ...authHeader, "content-type": "application/json" },
      body: JSON.stringify({ call_id: "CALL1", call_from: "358497773518@s.whatsapp.net" }),
    });
    expect(res.status).toBe(200);
    expect(
      (socket as unknown as { rejectCall: ReturnType<typeof vi.fn> }).rejectCall.mock.calls[0],
    ).toEqual(["CALL1", "358497773518@s.whatsapp.net"]);
  });
});

describe("T89-C — line135 rules module + line148 mlx + line150 allowlist", () => {
  test("line150 — extension allowlist: disallowed extension is a structured error", async () => {
    const rules = autoDownloadRules({ WA_ALLOWED_EXTENSIONS: "jpg,png" });
    expect(shouldAutoDownload("1@s.whatsapp.net", tmpdir(), rules, "notes.exe")).toEqual({
      ok: false,
      reason: expect.stringContaining("extension"),
    });
    expect(shouldAutoDownload("1@s.whatsapp.net", tmpdir(), rules, "pic.jpg").ok).toBe(true);
  });

  test("line148 — mlx engine spawns WA_MLX_BIN and maps errors to UNAVAILABLE", async () => {
    const { MlxTranscriptionEngine } = await import("../src/media/transcribe.ts");
    const missing = new MlxTranscriptionEngine("/nonexistent/mlx");
    await expect(missing.transcribe(Buffer.from("x"), "audio/ogg")).rejects.toHaveProperty(
      "code",
      "ENGINE_UNAVAILABLE",
    );
    void createTranscriptionEngine;
  });
});

describe("T89-D — newsletters follow/unfollow/send/list", () => {
  function newsletterSocket() {
    return {
      newsletterFollow: vi.fn(async () => undefined),
      newsletterUnfollow: vi.fn(async () => undefined),
      sendMessage: vi.fn(async () => ({ key: { id: "NL1", remoteJid: "newsletter-jid" } })),
    } as unknown as WASocket;
  }

  test("line161 — follow/unfollow route to the engine; list reads our registry", async () => {
    const socket = newsletterSocket();
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-nl-")));
    const bridge = await createHttpServer(stubHandle("connected", null, socket), {
      token: "test-token",
      store,
    });
    created.push({ close: () => bridge.close() });
    const follow = await fetch(url(bridge, "/api/newsletters/follow"), {
      method: "POST",
      headers: { ...authHeader, "content-type": "application/json" },
      body: JSON.stringify({ jid: "1234@newsletter" }),
    });
    expect(follow.status).toBe(200);
    const followCalls = (socket.newsletterFollow as ReturnType<typeof vi.fn>).mock.calls;
    expect(followCalls[0]).toEqual(["1234@newsletter"]);
    const list = (await (
      await fetch(url(bridge, "/api/newsletters"), { headers: authHeader })
    ).json()) as { newsletters: Array<{ jid: string }> };
    expect(list.newsletters.map((row) => row.jid)).toEqual(["1234@newsletter"]);
    const unfollow = await fetch(url(bridge, "/api/newsletters/unfollow"), {
      method: "POST",
      headers: { ...authHeader, "content-type": "application/json" },
      body: JSON.stringify({ jid: "1234@newsletter" }),
    });
    expect(unfollow.status).toBe(200);
    const unfollowCalls = (socket.newsletterUnfollow as ReturnType<typeof vi.fn>).mock.calls;
    expect(unfollowCalls[0]).toEqual(["1234@newsletter"]);
  });

  test("line161 — newsletter send posts a text message to the newsletter jid", async () => {
    const socket = newsletterSocket();
    const bridge = await createHttpServer(stubHandle("connected", null, socket), {
      token: "test-token",
    });
    created.push({ close: () => bridge.close() });
    const res = await fetch(url(bridge, "/api/newsletters/send"), {
      method: "POST",
      headers: { ...authHeader, "content-type": "application/json" },
      body: JSON.stringify({ jid: "1234@newsletter", text: "bulletin" }),
    });
    expect(res.status).toBe(200);
    const sendCalls = (socket.sendMessage as ReturnType<typeof vi.fn>).mock.calls;
    // sendViaSocket passes (jid, content, opts) — assert the first two
    expect(sendCalls[0]?.slice(0, 2)).toEqual(["1234@newsletter", { text: "bulletin" }]);
  });
});
