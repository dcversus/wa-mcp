import { mkdtempSync } from "node:fs";
import http from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import type { WASocket } from "baileys";
import { createEventBus } from "../src/events.ts";
import type { BridgeHandle, BridgeStatus } from "../src/lifecycle.ts";
import { createHttpServer } from "../src/http.ts";
import { openStore, type Store } from "../src/store/schema.ts";

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
    contactsWarm: () => false,
    fetchHistory: async () => ({ requested: true, request_id: "" }),
    logout: async () => {},
  };
}

interface PostResult {
  status: number;
  body: string;
}

// T93-E: a REAL node:http client — the dispatch/consumer stream semantics of a
// genuine socket are what exposed the double-read hang live (HTTP 000, 0 bytes)
function postJson(port: number, path: string, payload: unknown): Promise<PostResult> {
  return new Promise((resolve, reject) => {
    const data = Buffer.from(JSON.stringify(payload));
    const req = http.request(
      {
        host: "127.0.0.1",
        port,
        path,
        method: "POST",
        headers: {
          authorization: "Bearer test-token",
          "content-type": "application/json",
          "content-length": String(data.length),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on("data", (chunk: Buffer) => chunks.push(chunk));
        res.on("end", () =>
          resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString("utf8") }),
        );
      },
    );
    req.setTimeout(2000, () => {
      req.destroy(new Error("T93-E: request hung — no response within 2s (double body read)"));
    });
    req.on("error", reject);
    req.end(data);
  });
}

const servers: Array<{ close(): Promise<void> }> = [];
const stores: Store[] = [];

async function startBridge(): Promise<number> {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-t93e-")));
  stores.push(store);
  const bridge = await createHttpServer(stubHandle(), { token: "test-token", store });
  servers.push({ close: bridge.close });
  return bridge.port;
}

test.afterEach(async () => {
  for (const server of servers.splice(0)) {
    await server.close();
  }
  for (const store of stores.splice(0)) {
    store.close();
  }
});

test(
  "T93-E — POST /api/templates answers a real socket client",
  { timeout: 15_000 },
  async () => {
    const port = await startBridge();
    const res = await postJson(port, "/api/templates", { name: "greet", body: "hi {{name}}" });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toEqual({ ok: true });
  },
);

test(
  "T93-E — POST /api/send-rules answers a real socket client",
  { timeout: 15_000 },
  async () => {
    const port = await startBridge();
    const res = await postJson(port, "/api/send-rules", { target: "+358497773518", mode: "block" });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty("id");
  },
);

test(
  "T93-E — POST /api/scheduled answers a real socket client",
  { timeout: 15_000 },
  async () => {
    const port = await startBridge();
    const res = await postJson(port, "/api/scheduled", {
      chat_jid: "358497773518@s.whatsapp.net",
      text: "later",
      send_at: "2026-12-01T09:00:00Z",
    });
    expect(res.status).toBe(200);
    expect(JSON.parse(res.body)).toHaveProperty("id");
  },
);
