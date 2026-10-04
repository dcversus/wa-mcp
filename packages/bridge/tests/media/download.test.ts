import { existsSync, mkdtempSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import { createEventBus } from "../../src/events.ts";
import type { BridgeHandle, BridgeStatus } from "../../src/lifecycle.ts";
import { createHttpServer } from "../../src/http.ts";
import { downloadMessageMedia } from "../../src/media/download.ts";
import type { WAMessage, WASocket } from "baileys";
import { storeMessage } from "../../src/store/messages.ts";
import { openStore, type Store } from "../../src/store/schema.ts";

afterEach(async () => {
  for (const handle of created.splice(0)) {
    await handle.close();
  }
});

const POSIX_PERMS = process.platform !== "win32";

const GROUP_A = "120363428874442773@g.us";
const created: Array<{ close(): Promise<void> }> = [];

function stubHandle(
  status: BridgeStatus = "connected",
  _lastQr: string | null = null,
  socket?: WASocket,
): BridgeHandle {
  return {
    status,
    events: createEventBus(),
    close: async () => {},
    getLastQr: () => null,
    socket: (socket ?? {
      sendMessage: vi.fn(async () => ({ key: { id: "X" } })),
    }) as unknown as WASocket,
    hasPairedAccount: () => false,
    pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
    resumePairing: () => {},
    connectionQuality: () => ({ reconnects: 0, lastDisconnectAt: null }),
    contactsWarm: () => false,
    fetchHistory: async () => ({ requested: true, request_id: "" }),
    logout: async () => {},
  };
}

function url(bridge: { port: number }, path: string): string {
  return `http://127.0.0.1:${bridge.port}${path}`;
}

const authHeader = { authorization: "Bearer test-token" };

const PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

const engineLike = async (message: WAMessage): Promise<Buffer> => {
  const content = message.message ?? {};
  const hasMedia =
    content.imageMessage !== undefined ||
    content.videoMessage !== undefined ||
    content.audioMessage !== undefined ||
    content.documentMessage !== undefined ||
    content.stickerMessage !== undefined;
  if (!hasMedia) {
    throw new Error("message is not a media message");
  }
  return PNG;
};

const downloadMock = vi.fn(engineLike);

vi.mock("baileys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("baileys")>();
  return {
    ...actual,
    downloadMediaMessage: (...args: unknown[]) =>
      downloadMock(...(args as Parameters<typeof downloadMock>)),
  };
});

const stores: Store[] = [];
const mediaDirs: string[] = [];

function makeStore(): Store {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-dl-")));
  stores.push(store);
  return store;
}

function mediaDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-dl-media-"));
  mediaDirs.push(dir);
  return dir;
}

function mediaMessage(id: string, overrides: Partial<WAMessage> = {}): WAMessage {
  return {
    key: {
      remoteJid: "120363428874442773@g.us",
      fromMe: false,
      id,
      participant: "358401112222@s.whatsapp.net",
    },
    message: { imageMessage: { caption: "pic", url: "https://mmg.example/1.png" } },
    messageTimestamp: 1727812345,
    pushName: "Vasilisa",
    ...overrides,
  } as unknown as WAMessage;
}

function fakeSocket(): WASocket {
  return { updateMediaMessage: vi.fn(async () => ({}) as never) } as unknown as WASocket;
}

afterEach(() => {
  downloadMock.mockClear();
  for (const store of stores.splice(0)) {
    store.close();
  }
});

test("downloads an image message to the media dir and links the row", async () => {
  const store = makeStore();
  storeMessage(store, mediaMessage("DL1"));
  const result = await downloadMessageMedia(fakeSocket(), mediaMessage("DL1"), {
    store,
    mediaDir: mediaDir(),
    messageId: "DL1",
  });
  expect(result.mime).toBe("image/png");
  expect(result.size).toBe(PNG.length);
  expect(result.path.endsWith("DL1.png")).toBe(true);
  if (POSIX_PERMS) {
    expect(statSync(result.path).mode & 0o777).toBe(0o644);
  }
  const row = store.db
    .prepare("SELECT media_path, media_type FROM messages WHERE id = 'DL1'")
    .get() as {
    media_path: string;
    media_type: string;
  };
  expect(row.media_path).toBe(result.path);
  expect(row.media_type).toBe("image");
});

test("passes the message and reupload context to the engine", async () => {
  const store = makeStore();
  storeMessage(store, mediaMessage("DL2"));
  const socket = fakeSocket();
  const updateSpy = vi.spyOn(socket, "updateMediaMessage");
  await downloadMessageMedia(socket, mediaMessage("DL2"), {
    store,
    mediaDir: mediaDir(),
    messageId: "DL2",
  });
  expect(downloadMock).toHaveBeenCalledTimes(1);
  const call = downloadMock.mock.calls[0] as unknown as [
    WAMessage,
    string,
    Record<string, unknown>,
    { reuploadRequest: (msg: WAMessage) => Promise<WAMessage>; logger: unknown },
  ];
  expect(call[0].key.id).toBe("DL2");
  expect(call[1]).toBe("buffer");
  expect(typeof call[3].reuploadRequest).toBe("function");
  const reuploaded = await call[3].reuploadRequest(mediaMessage("DL2"));
  expect(updateSpy).toHaveBeenCalled();
  expect(reuploaded).toBeDefined();
});

test("sanitizes the message id against traversal", async () => {
  const store = makeStore();
  const socket = fakeSocket();
  for (const bad of ["../evil", "a/b", "a b", "a.b.c"]) {
    await expect(
      downloadMessageMedia(socket, mediaMessage(bad), {
        store,
        mediaDir: mediaDir(),
        messageId: bad,
      }),
    ).rejects.toMatchObject({ code: "PATH_FORBIDDEN" });
  }
  expect(downloadMock).not.toHaveBeenCalled();
});

test("a message without media reports EMPTY", async () => {
  const store = makeStore();
  const textMessage = {
    key: {
      remoteJid: "120363428874442773@g.us",
      fromMe: false,
      id: "TXT1",
      participant: "358401112222@s.whatsapp.net",
    },
    message: { conversation: "just text" },
    messageTimestamp: 1000,
  } as unknown as WAMessage;
  storeMessage(store, textMessage);
  await expect(
    downloadMessageMedia(fakeSocket(), textMessage, {
      store,
      mediaDir: mediaDir(),
      messageId: "TXT1",
    }),
  ).rejects.toMatchObject({ code: "EMPTY" });
});

describe("T90 line141 — forced download returns the local path + updates the DB", () => {
  test("download → file exists, path returned, DB media_path updated", async () => {
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-dl-")));
    const mediaDir = mkdtempSync(join(tmpdir(), "wa-mcp-dl-media-"));
    const socket = {
      downloadMediaMessage: vi.fn(async () => Buffer.from("media-bytes")),
    } as unknown as WASocket;
    storeMessage(store, {
      key: { remoteJid: GROUP_A, fromMe: false, id: "DL1" },
      message: { imageMessage: { mimetype: "image/jpeg" } },
      messageTimestamp: 1000,
    } as never);
    const bridge = await createHttpServer(stubHandle("connected", null, socket), {
      token: "test-token",
      store,
      mediaDir,
    });
    created.push({ close: bridge.close });
    const res = await fetch(url(bridge, "/api/media/DL1/download"), {
      method: "POST",
      headers: { ...authHeader, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path: string };
    expect(existsSync(body.path)).toBe(true);
    const row = store.db.prepare("SELECT media_path FROM messages WHERE id = 'DL1'").get() as {
      media_path: string;
    };
    expect(row.media_path).toBe(body.path);
    // idempotent: second call returns the stored path without re-downloading
    const before = (socket as unknown as { downloadMediaMessage: ReturnType<typeof vi.fn> })
      .downloadMediaMessage.mock.calls.length;
    const again = await fetch(url(bridge, "/api/media/DL1/download"), {
      method: "POST",
      headers: { ...authHeader, "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(again.status).toBe(200);
    expect(
      (socket as unknown as { downloadMediaMessage: ReturnType<typeof vi.fn> }).downloadMediaMessage
        .mock.calls.length,
    ).toBe(before);
  });
});

test("T90 line141 — POST /api/media/:id/download forces download + updates the DB", async () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-dltool-")));
  const mediaDir = mkdtempSync(join(tmpdir(), "wa-mcp-dltool-media-"));
  const socket = {
    downloadMediaMessage: vi.fn(async () => Buffer.from("media-bytes")),
  } as unknown as WASocket;
  storeMessage(store, {
    key: { remoteJid: GROUP_A, fromMe: false, id: "DL1" },
    message: { imageMessage: { mimetype: "image/jpeg" } },
    messageTimestamp: 1000,
  } as never);
  const bridge = await createHttpServer(stubHandle("connected", null, socket), {
    token: "test-token",
    store,
    mediaDir,
  });
  created.push({ close: bridge.close });
  const res = await fetch(url(bridge, "/api/media/DL1/download"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(res.status).toBe(200);
  const body = (await res.json()) as { path: string };
  expect(existsSync(body.path)).toBe(true);
  const row = store.db.prepare("SELECT media_path FROM messages WHERE id = 'DL1'").get() as {
    media_path: string;
  };
  expect(row.media_path).toBe(body.path);
  // idempotent: already-downloaded rows return the stored path, no re-download
  const before = (socket as unknown as { downloadMediaMessage: ReturnType<typeof vi.fn> })
    .downloadMediaMessage.mock.calls.length;
  const again = await fetch(url(bridge, "/api/media/DL1/download"), {
    method: "POST",
    headers: { ...authHeader, "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  expect(again.status).toBe(200);
  expect(
    (socket as unknown as { downloadMediaMessage: ReturnType<typeof vi.fn> }).downloadMediaMessage
      .mock.calls.length,
  ).toBe(before);
});
