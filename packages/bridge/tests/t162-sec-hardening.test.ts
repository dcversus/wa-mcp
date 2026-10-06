import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";
import { expect, test, vi } from "vite-plus/test";
const httpRequest = http.request;
import { openStore } from "../src/store/schema.ts";
import { storeMessage } from "../src/store/messages.ts";
import { createEventBus } from "../src/events.ts";
import { createRateLimiter, createHttpServer, type BridgeHttp } from "../src/http.ts";
import type { BridgeHandle } from "../src/lifecycle.ts";

function stubHandle(events: ReturnType<typeof createEventBus>): BridgeHandle {
  return {
    status: "connected",
    events,
    close: async () => {},
    getLastQr: () => null,
    hasPairedAccount: () => true,
    pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
    resumePairing: () => {},
    connectionQuality: () => ({ reconnects: 0, lastDisconnectAt: null }),
    logout: async () => {},
    fetchHistory: async () => ({ requested: false, request_id: "" }),
    contactsWarm: () => true,
    socket: {},
  } as unknown as BridgeHandle;
}

function url(bridge: BridgeHttp, path: string): string {
  return `http://127.0.0.1:${bridge.port}${path}`;
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}` };
}

function rawGet(
  bridge: BridgeHttp,
  path: string,
  headers: Record<string, string>,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ host: "127.0.0.1", port: bridge.port, path, headers }, (res) => {
      res.resume();
      res.on("end", () => resolve(res.statusCode ?? 0));
    });
    req.on("error", reject);
    req.end();
  });
}

const MEDIA_PNG = Buffer.from("89504e470d0a1a0a0000000d49484452", "hex");

vi.mock("baileys", async (importOriginal) => {
  const actual = await importOriginal<typeof import("baileys")>();
  const downloadMediaMessage = async (message: {
    message?: Record<string, unknown>;
  }): Promise<Buffer> => {
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
    return MEDIA_PNG;
  };
  return { ...actual, downloadMediaMessage };
});

const FOREIGN_HOST = { host: "evil.example.com" };

test("T162 S1 — /health no longer publishes uiBootstrapToken", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t162-"));
  try {
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t162-token",
      uiDir: dataDir,
    });
    writeFileSync(join(dataDir, "index.html"), "<html></html>");
    const health = (await (await fetch(url(bridge, "/health"))).json()) as Record<string, unknown>;
    expect(health.uiBootstrapToken).toBeUndefined();
    await bridge.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T162 S1 — GET / sets the bootstrap cookie for loopback same-origin clients", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t162-"));
  try {
    writeFileSync(join(dataDir, "index.html"), "<html></html>");
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t162-token",
      uiDir: dataDir,
    });
    const res = await fetch(url(bridge, "/"));
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("wa-mcp-bootstrap=");
    expect(setCookie.toLowerCase()).toContain("httponly");
    expect(setCookie.toLowerCase()).toContain("samesite=strict");
    await bridge.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T162 S1 — the exchange accepts the cookie without any bearer", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t162-"));
  try {
    writeFileSync(join(dataDir, "index.html"), "<html></html>");
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t162-token",
      uiDir: dataDir,
    });
    const shell = await fetch(url(bridge, "/"));
    const cookie = (shell.headers.get("set-cookie") ?? "").split(";")[0] as string;
    expect(cookie.startsWith("wa-mcp-bootstrap=")).toBe(true);
    const exchanged = await fetch(url(bridge, "/api/ui-token"), {
      headers: { cookie },
    });
    expect(exchanged.status).toBe(200);
    const body = (await exchanged.json()) as { token?: string };
    expect(typeof body.token).toBe("string");
    await bridge.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T162 S1 — the bearer exchange path still works (compat)", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t162-"));
  try {
    writeFileSync(join(dataDir, "index.html"), "<html></html>");
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t162-token",
      uiDir: dataDir,
    });
    const shell = await fetch(url(bridge, "/"));
    const raw = (shell.headers.get("set-cookie") ?? "").split(";")[0] as string;
    const bootstrapToken = raw.slice("wa-mcp-bootstrap=".length);
    const exchanged = await fetch(url(bridge, "/api/ui-token"), {
      headers: auth(bootstrapToken),
    });
    expect(exchanged.status).toBe(200);
    await bridge.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T162 S2 — a foreign Host is 403'd on /, /assets, /health too", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t162-"));
  try {
    writeFileSync(join(dataDir, "index.html"), "<html></html>");
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t162-token",
      uiDir: dataDir,
    });
    for (const path of ["/", "/assets/index.js", "/health"]) {
      const status = await rawGet(bridge, path, FOREIGN_HOST);
      expect(status, path).toBe(403);
    }
    await bridge.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T162 S2 — foreign requests burn no bucket: the owner's /health keeps answering", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t162-"));
  try {
    writeFileSync(join(dataDir, "index.html"), "<html></html>");
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t162-token",
      uiDir: dataDir,
    });
    for (let index = 0; index < 200; index += 1) {
      await rawGet(bridge, "/health", FOREIGN_HOST);
    }
    const good = await fetch(url(bridge, "/health"));
    expect(good.status).toBe(200);
    await bridge.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T162 S4 — every surface carries frame-ancestors 'none' and no-referrer", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t162-"));
  try {
    writeFileSync(join(dataDir, "index.html"), "<html></html>");
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t162-token",
      uiDir: dataDir,
    });
    for (const path of ["/", "/health"]) {
      const res = await fetch(url(bridge, path));
      const csp = (res.headers.get("content-security-policy") ?? "").toLowerCase();
      expect(csp, path).toContain("frame-ancestors 'none'");
      expect(res.headers.get("referrer-policy"), path).toBe("no-referrer");
    }
    await bridge.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T162 S4 — media GET answers with nosniff, a sandbox CSP and an inline disposition", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t162-"));
  const store = openStore(dataDir);
  const mediaDir = mkdtempSync(join(tmpdir(), "t162-media-"));
  try {
    store.db
      .prepare(
        "INSERT INTO messages (id, chat_jid, sender_jid, timestamp, content, media_path) VALUES (?, ?, ?, ?, ?, ?)",
      )
      .run(
        "PIC1",
        "g@g.us",
        "u@s.whatsapp.net",
        "2026-10-06T00:00:00.000Z",
        null,
        join(mediaDir, "PIC1.png"),
      );
    writeFileSync(join(mediaDir, "PIC1.png"), Buffer.from([0x89, 0x50, 0x4e, 0x47]));
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t162-token",
      store,
      mediaDir,
    });
    const res = await fetch(url(bridge, "/api/media/PIC1"), { headers: auth("t162-token") });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("content-disposition")).toContain('inline; filename="PIC1.png"');
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(mediaDir, { recursive: true, force: true });
  }
});

test("T162 S4 — export answers with nosniff, a sandbox CSP and a disposition", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t162-"));
  const store = openStore(dataDir);
  try {
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t162-token",
      store,
    });
    const res = await fetch(url(bridge, "/api/export?format=md"), { headers: auth("t162-token") });
    expect(res.status).toBe(200);
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("content-disposition")).toContain('filename="export.md"');
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T162 S5 — random bearers share the anon bucket and never grow the limiter map", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t162-"));
  try {
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t162-token",
    });
    const before = bridge.limiterSizes();
    for (let index = 0; index < 30; index += 1) {
      await fetch(url(bridge, "/api/chats"), {
        headers: auth(`random-${index}-${Math.random()}`),
      });
    }
    const after = bridge.limiterSizes();
    expect(after.api).toBeLessThanOrEqual(before.api + 1);
    await bridge.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T162 S5 — anon spam cannot touch the owner's token bucket", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t162-"));
  try {
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t162-token",
    });
    for (let index = 0; index < 65; index += 1) {
      await fetch(url(bridge, "/api/chats"), {
        headers: auth(`spam-${Math.random()}-${index}`),
      });
    }
    const owner = await fetch(url(bridge, "/api/chats"), { headers: auth("t162-token") });
    expect(owner.status).not.toBe(429);
    await bridge.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
  }
});

test("T162 S5 — idle limiter entries are evicted after the TTL", () => {
  const limiter = createRateLimiter(10, 10);
  const t0 = 1_000_000;
  limiter.hit("a", t0);
  limiter.hit("b", t0);
  expect(limiter.size()).toBe(2);
  limiter.hit("c", t0 + 601_000);
  expect(limiter.size()).toBe(1);
});

test("T162 S6 — the media download response leaks no absolute path", async () => {
  const dataDir = mkdtempSync(join(tmpdir(), "t162-"));
  const store = openStore(dataDir);
  const mediaDir = mkdtempSync(join(tmpdir(), "t162-media-"));
  try {
    storeMessage(store, {
      key: { remoteJid: "g@g.us", fromMe: false, id: "PIC1", participant: "u@s.whatsapp.net" },
      message: { imageMessage: { caption: "shot", url: "https://x/1.png" } },
      messageTimestamp: 1000,
      pushName: "V",
    } as never);
    const bridge = await createHttpServer(stubHandle(createEventBus()), {
      token: "t162-token",
      store,
      mediaDir,
    });
    const res = await fetch(url(bridge, "/api/media/PIC1"), {
      method: "POST",
      headers: auth("t162-token"),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { path?: string; name?: string };
    expect(body.path).toBeUndefined();
    expect(body.name).toBe("PIC1.png");
    expect(JSON.stringify(body)).not.toContain(tmpdir());
    await bridge.close();
    store.close();
  } finally {
    rmSync(dataDir, { recursive: true, force: true });
    rmSync(mediaDir, { recursive: true, force: true });
  }
});
