import { expect, test } from "vite-plus/test";
import { createEventBus } from "../src/events.ts";
import { createHttpServer, type BridgeHttp } from "../src/http.ts";
import type { BridgeHandle, BridgeStatus } from "../src/lifecycle.ts";

function stubHandle(status: BridgeStatus, paired: boolean, blocked = false): BridgeHandle {
  return {
    status,
    events: createEventBus(),
    close: async () => {},
    getLastQr: () => null,
    socket: null,
    hasPairedAccount: () => paired,
    pairingBudget: () => ({ blocked, used: blocked ? 3 : 0, limit: 3 }),
    connectionQuality: () => ({ reconnects: 0, lastDisconnectAt: null }),
    fetchHistory: async () => ({ requested: false, request_id: "" }),
    contactsWarm: () => true,
    logout: async () => {},
    resumePairing: () => {},
  } as unknown as BridgeHandle;
}

async function probe(
  status: BridgeStatus,
  paired: boolean,
  path: string,
  blocked = false,
): Promise<{ code: number; body: Record<string, unknown> }> {
  const bridge: BridgeHttp = await createHttpServer(stubHandle(status, paired, blocked), {
    token: "t197-token",
  });
  try {
    const res = await fetch(`http://127.0.0.1:${bridge.port}${path}`);
    return { code: res.status, body: (await res.json()) as Record<string, unknown> };
  } finally {
    await bridge.close();
  }
}

test("liveness answers 200 in every connection state, without a token", async () => {
  for (const [status, paired] of [
    ["connected", true],
    ["reconnecting", true],
    ["qr", false],
    ["logged-out", true],
    ["pairing-blocked", false],
  ] as Array<[BridgeStatus, boolean]>) {
    const { code, body } = await probe(status, paired, "/health/live");
    expect(code, status).toBe(200);
    expect(body).toMatchObject({ live: true, status });
  }
});

test("readiness is 200 only when connected", async () => {
  const { code, body } = await probe("connected", true, "/health/ready");
  expect(code).toBe(200);
  expect(body).toMatchObject({ ready: true, status: "connected" });
});

test("readiness is 503 with a machine-readable reason in every other state", async () => {
  const cases: Array<[BridgeStatus, boolean, boolean, string]> = [
    ["reconnecting", true, false, "reconnecting"],
    ["connecting", true, false, "connecting"],
    ["qr", false, false, "pairing-required"],
    ["connecting", false, false, "pairing-required"],
    ["logged-out", true, false, "logged-out"],
    ["pairing-blocked", false, true, "pairing-blocked"],
  ];
  for (const [status, paired, blocked, reason] of cases) {
    const { code, body } = await probe(status, paired, "/health/ready", blocked);
    expect(code, `${status}/${String(paired)}`).toBe(503);
    expect(body).toMatchObject({ ready: false, status, reason });
  }
});

test("probes never expose the pairing token", async () => {
  for (const path of ["/health/live", "/health/ready"]) {
    const { body } = await probe("qr", false, path);
    expect(JSON.stringify(body)).not.toContain("pairingToken");
  }
});
