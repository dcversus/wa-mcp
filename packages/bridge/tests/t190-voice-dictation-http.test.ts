import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { EventEmitter } from "node:events";
import { spawn } from "node:child_process";
import { expect, test } from "vite-plus/test";
import { openStore, type Store } from "../src/store/schema.ts";
import { createHttpServer, type BridgeHttp } from "../src/http.ts";
import { createEventBus } from "../src/events.ts";
import type { BridgeHandle, BridgeStatus } from "../src/lifecycle.ts";
import type { WASocket } from "baileys";

const authHeader = { authorization: "Bearer test-token" };

function stubHandle(status: BridgeStatus = "connected"): BridgeHandle {
  return {
    status,
    events: createEventBus(),
    close: async () => {},
    getLastQr: () => null,
    socket: {} as unknown as WASocket,
    hasPairedAccount: () => false,
    pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
    connectionQuality: () => ({ reconnects: 0, lastDisconnectAt: null }),
    fetchHistory: async () => ({ requested: true, request_id: "" }),
    contactsWarm: () => false,
    logout: async () => {},
    resumePairing: () => undefined,
  };
}

function url(bridge: BridgeHttp, path: string): string {
  return `http://127.0.0.1:${bridge.port}${path}`;
}

interface StubProc extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  stdin: { end(chunk?: Buffer): void; on(event: string, cb: () => void): void };
}

function fakeSpawnOnce(bytes: Buffer, exitCode = 0): typeof spawn {
  return ((_file: string, _args: string[]) => {
    const proc = new EventEmitter() as StubProc;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { end: () => undefined, on: () => undefined };
    queueMicrotask(() => {
      proc.stdout.emit("data", bytes);
      proc.emit("close", exitCode);
    });
    return proc;
  }) as unknown as typeof spawn;
}

function voiceStore(): Store {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-voice-http-"));
  const store = openStore(dir);
  writeFileSync(join(dir, "m1.ogg"), Buffer.from("OggS-one"));
  writeFileSync(join(dir, "m3.ogg"), Buffer.from("OggS-three"));
  const insert = store.db.prepare(
    "INSERT INTO messages (id, chat_jid, sender_name, timestamp, media_type, media_path, is_from_me) VALUES (?, ?, ?, ?, ?, ?, ?)",
  );
  insert.run(
    "M1",
    "chat@s.whatsapp.net",
    "Alice",
    "2026-10-25T01:00:00+02:00",
    "audio",
    join(dir, "m1.ogg"),
    0,
  );
  insert.run(
    "M3",
    "chat@s.whatsapp.net",
    "Bob",
    "2026-10-25T01:02:00+02:00",
    "audio",
    join(dir, "m3.ogg"),
    0,
  );
  return store;
}

test("R2-14 — /api/voice/next.pcm requires the bearer token", async () => {
  const bridge = await createHttpServer(stubHandle(), {
    token: "test-token",
    store: voiceStore(),
  });
  const res = await fetch(url(bridge, "/api/voice/next.pcm"));
  expect(res.status).toBe(401);
  await bridge.close();
});

test("R2-14 — /api/voice/next peeks without consuming, /api/voice/next.pcm serves FIFO and advances", async () => {
  const PCM1 = Buffer.from([10, 0, 11, 0]);
  const PCM3 = Buffer.from([20, 0, 21, 0]);
  let served = 0;
  const dynamicSpawn = ((file: string, args: string[]) => {
    served += 1;
    return served === 1 ? fakeSpawnOnce(PCM1)(file, args) : fakeSpawnOnce(PCM3)(file, args);
  }) as unknown as typeof spawn;
  const bridge = await createHttpServer(stubHandle(), {
    token: "test-token",
    store: voiceStore(),
    spawnFn: dynamicSpawn,
  });

  const peek = (await (
    await fetch(url(bridge, "/api/voice/next"), { headers: authHeader })
  ).json()) as { pending: number; next: { id: string } | null };
  expect(peek.pending).toBe(2);
  expect(peek.next?.id).toBe("M1");

  const first = await fetch(url(bridge, "/api/voice/next.pcm"), { headers: authHeader });
  expect(first.status).toBe(200);
  expect(first.headers.get("content-type")).toBe("audio/L16;rate=16000;channels=1");
  expect(first.headers.get("x-wa-mcp-voice-rowid")).toBeTruthy();
  expect(Buffer.from(await first.arrayBuffer())).toEqual(PCM1);

  const peekAfter = (await (
    await fetch(url(bridge, "/api/voice/next"), { headers: authHeader })
  ).json()) as { pending: number; next: { id: string } | null };
  expect(peekAfter.pending).toBe(1);
  expect(peekAfter.next?.id).toBe("M3");

  const second = await fetch(url(bridge, "/api/voice/next.pcm"), { headers: authHeader });
  expect(Buffer.from(await second.arrayBuffer())).toEqual(PCM3);

  const empty = await fetch(url(bridge, "/api/voice/next.pcm"), { headers: authHeader });
  expect(empty.status).toBe(204);
  const peekEmpty = (await (
    await fetch(url(bridge, "/api/voice/next"), { headers: authHeader })
  ).json()) as { pending: number; next: unknown };
  expect(peekEmpty.pending).toBe(0);
  expect(peekEmpty.next).toBeNull();
  await bridge.close();
});

test("R2-14 — missing ffmpeg answers 422 ENGINE_UNAVAILABLE naming the install", async () => {
  const failing = ((_file: string) => {
    const proc = new EventEmitter() as StubProc;
    proc.stdout = new EventEmitter();
    proc.stderr = new EventEmitter();
    proc.stdin = { end: () => undefined, on: () => undefined };
    queueMicrotask(() => {
      proc.emit("error", Object.assign(new Error("spawn ffmpeg ENOENT"), { code: "ENOENT" }));
    });
    return proc;
  }) as unknown as typeof spawn;
  const bridge = await createHttpServer(stubHandle(), {
    token: "test-token",
    store: voiceStore(),
    spawnFn: failing,
  });
  const res = await fetch(url(bridge, "/api/voice/next.pcm"), { headers: authHeader });
  expect(res.status).toBe(422);
  const body = (await res.json()) as { error: { code: string; message: string } };
  expect(body.error.code).toBe("ENGINE_UNAVAILABLE");
  expect(body.error.message).toContain("ffmpeg");
  await bridge.close();
});

test("R2-14 — a voice note whose media file vanished answers 404 and is skipped (queue not blocked)", async () => {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-voice-http-"));
  const store = openStore(dir);
  store.db
    .prepare(
      "INSERT INTO messages (id, chat_jid, sender_name, timestamp, media_type, media_path, is_from_me) VALUES (?, ?, ?, ?, ?, ?, ?)",
    )
    .run(
      "MX",
      "chat@s.whatsapp.net",
      "Bob",
      "2026-10-25T01:00:00+02:00",
      "audio",
      join(dir, "gone.ogg"),
      0,
    );
  const bridge = await createHttpServer(stubHandle(), {
    token: "test-token",
    store,
    spawnFn: fakeSpawnOnce(Buffer.from([1, 0])),
  });
  const res = await fetch(url(bridge, "/api/voice/next.pcm"), { headers: authHeader });
  expect(res.status).toBe(404);
  const peek = (await (
    await fetch(url(bridge, "/api/voice/next"), { headers: authHeader })
  ).json()) as { pending: number; next: unknown };
  expect(peek.pending).toBe(0);
  expect(peek.next).toBeNull();
  await bridge.close();
});
