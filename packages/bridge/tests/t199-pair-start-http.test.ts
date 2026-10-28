import { expect, test } from "vite-plus/test";
import { createEventBus } from "../src/events.ts";
import { createHttpServer, type BridgeHttp } from "../src/http.ts";
import type { BridgeHandle, BridgeStatus, QrInfo } from "../src/lifecycle.ts";

const TOKEN = "t199-token";
const auth = { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" };

interface Stub {
  handle: BridgeHandle;
  starts: number;
  setQr(info: Partial<QrInfo>): void;
}

function stub(initial: BridgeStatus, opts: { paired?: boolean; blocked?: boolean } = {}): Stub {
  let status: BridgeStatus = initial;
  let qr: QrInfo = { qr: null, index: 0, issuedAt: null, expiresAt: null, expired: false };
  const state = { starts: 0 };
  const socket = { requestPairingCode: async () => "ABCD1234" };
  const handle = {
    get status() {
      return status;
    },
    events: createEventBus(),
    close: async () => {},
    getLastQr: () => qr.qr,
    getQrInfo: () => qr,
    get socket() {
      return status === "unpaired" ? undefined : socket;
    },
    hasPairedAccount: () => opts.paired === true,
    pairingBudget: () => ({ blocked: opts.blocked === true, used: state.starts, limit: 3 }),
    connectionQuality: () => ({ reconnects: 0, lastDisconnectAt: null }),
    fetchHistory: async () => ({ requested: false, request_id: "" }),
    contactsWarm: () => false,
    logout: async () => {},
    resumePairing: () => {},
    startPairing: () => {
      if (opts.paired === true) return { started: false, reason: "paired" as const };
      if (opts.blocked === true) return { started: false, reason: "pairing-blocked" as const };
      if (status === "qr") return { started: false, reason: "active" as const };
      state.starts += 1;
      status = "connecting";
      // the engine sends its first ref shortly after the socket opens
      setTimeout(() => {
        status = "qr";
        qr = {
          qr: "ref-1",
          index: 1,
          issuedAt: "2026-10-29T10:00:00.000Z",
          expiresAt: "2026-10-29T10:01:00.000Z",
          expired: false,
        };
      }, 30);
      return { started: true };
    },
  } as unknown as BridgeHandle;
  return {
    handle,
    get starts() {
      return state.starts;
    },
    setQr(info) {
      qr = { ...qr, ...info };
    },
  };
}

async function serve(s: Stub): Promise<BridgeHttp> {
  return createHttpServer(s.handle, { token: TOKEN });
}

const url = (bridge: BridgeHttp, path: string) => `http://127.0.0.1:${bridge.port}${path}`;

test("POST /api/pair/start opens one registration and reports it", async () => {
  const s = stub("unpaired");
  const bridge = await serve(s);
  try {
    const res = await fetch(url(bridge, "/api/pair/start"), { method: "POST", headers: auth });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ started: true, status: "connecting" });
    expect(s.starts).toBe(1);
  } finally {
    await bridge.close();
  }
});

test("POST /api/pair/start is reachable with the public pairing token", async () => {
  const s = stub("unpaired");
  const bridge = await serve(s);
  try {
    const health = (await (await fetch(url(bridge, "/health"))).json()) as { pairingToken: string };
    expect(typeof health.pairingToken).toBe("string");
    const res = await fetch(url(bridge, "/api/pair/start"), {
      method: "POST",
      headers: { authorization: `Bearer ${health.pairingToken}` },
    });
    expect(res.status).toBe(200);
  } finally {
    await bridge.close();
  }
});

test("POST /api/pair/start refuses with 409 when paired or already registering, 429 when blocked", async () => {
  for (const [s, code, reason] of [
    [stub("connected", { paired: true }), 409, "paired"],
    [stub("qr"), 409, "active"],
    [stub("pairing-blocked", { blocked: true }), 429, "pairing-blocked"],
  ] as Array<[Stub, number, string]>) {
    const bridge = await serve(s);
    try {
      const res = await fetch(url(bridge, "/api/pair/start"), { method: "POST", headers: auth });
      expect(res.status, reason).toBe(code);
      const body = (await res.json()) as { started: boolean; reason: string };
      expect(body).toMatchObject({ started: false, reason });
    } finally {
      await bridge.close();
    }
  }
});

test("GET /api/qr carries the code's position and lifetime", async () => {
  const s = stub("qr");
  s.setQr({
    qr: "ref-2",
    index: 2,
    issuedAt: "2026-10-29T10:01:00.000Z",
    expiresAt: "2026-10-29T10:01:20.000Z",
  });
  const bridge = await serve(s);
  try {
    const body = (await (await fetch(url(bridge, "/api/qr"), { headers: auth })).json()) as Record<
      string,
      unknown
    >;
    expect(body).toMatchObject({
      qr: "ref-2",
      index: 2,
      issuedAt: "2026-10-29T10:01:00.000Z",
      expiresAt: "2026-10-29T10:01:20.000Z",
    });
  } finally {
    await bridge.close();
  }
});

test("GET /api/qr says 410 QR_EXPIRED once the codes ran out, 404 with a hint before any start", async () => {
  const expired = stub("unpaired");
  expired.setQr({ expired: true });
  const idle = stub("unpaired");
  for (const [s, code, error] of [
    [expired, 410, "QR_EXPIRED"],
    [idle, 404, "NO_QR"],
  ] as Array<[Stub, number, string]>) {
    const bridge = await serve(s);
    try {
      const res = await fetch(url(bridge, "/api/qr"), { headers: auth });
      expect(res.status).toBe(code);
      const body = (await res.json()) as { error: { code: string; message: string } };
      expect(body.error.code).toBe(error);
      expect(body.error.message).toContain("/api/pair/start");
    } finally {
      await bridge.close();
    }
  }
});

test("POST /api/pairing-code from an unpaired daemon starts a registration, waits for it, then returns the code", async () => {
  const s = stub("unpaired");
  const bridge = await serve(s);
  try {
    const res = await fetch(url(bridge, "/api/pairing-code"), {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ phone: "+358 49 7773518" }),
    });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ code: "ABCD-1234" });
    expect(s.starts).toBe(1);
  } finally {
    await bridge.close();
  }
});

test("/health/ready reports pairing-required for an idle unpaired daemon", async () => {
  const bridge = await serve(stub("unpaired"));
  try {
    const res = await fetch(url(bridge, "/health/ready"));
    expect(res.status).toBe(503);
    expect(await res.json()).toMatchObject({ status: "unpaired", reason: "pairing-required" });
  } finally {
    await bridge.close();
  }
});
