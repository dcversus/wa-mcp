import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const fixture = readFileSync("scripts/fixtures/engine-events/recorded/messages.upsert.jsonl", "utf8").trim().split("\n")[0];
const ev = JSON.parse(fixture);
const { openStore } = await import("../packages/bridge/dist/store/schema.mjs");
const { createEventBus } = await import("../packages/bridge/dist/events.mjs");
const { createHttpServer } = await import("../packages/bridge/dist/http.mjs");

const dir = mkdtempSync(join(tmpdir(), "live-probe-"));
try {
  const store = openStore(dir);
  const bus = createEventBus();
  const handle = {
    status: "connected",
    events: bus,
    close: async () => {},
    getLastQr: () => null,
    socket: {},
    hasPairedAccount: () => true,
    pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
    resumePairing: () => {},
    connectionQuality: () => ({ reconnects: 0, lastDisconnectAt: null }),
    logout: async () => {},
    fetchHistory: async () => ({ requested: false, request_id: "" }),
    contactsWarm: () => true,
  };
  const bridge = await createHttpServer(handle, { token: "probe", store, subscriptionsDir: dir });
  const r = await fetch(`http://127.0.0.1:${bridge.port}/api/subscriptions`, {
    method: "POST",
    headers: { authorization: "Bearer probe", "content-type": "application/json" },
    body: JSON.stringify({ chat_jid: "120363428874442773@g.us" }),
  });
  const { inboxPath } = await r.json();
  bus.emit(ev);
  await new Promise((r2) => setTimeout(r2, 300));
  const content = readFileSync(inboxPath, "utf8").trim();
  console.log("inbox:", content.slice(0, 200) || "EMPTY");
  await bridge.close();
  store.close();
} finally {
  rmSync(dir, { recursive: true, force: true });
}
