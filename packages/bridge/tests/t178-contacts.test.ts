import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { WASocket } from "baileys";
import { openStore, type Store } from "../src/store/schema.ts";
import {
  clearSavedName,
  getContact,
  listContactViews,
  setAlias,
  upsertContact,
} from "../src/store/contacts.ts";
import { createEventBus } from "../src/events.ts";
import { createHttpServer, type BridgeHttp } from "../src/http.ts";
import type { BridgeHandle } from "../src/lifecycle.ts";

const TOKEN = "t178-token";
const DANA = "358400000001@s.whatsapp.net";
const ERIK = "358400000002@s.whatsapp.net";
const LID_ONLY = "55600000009854@lid";
const GROUP = "120363428874442773@g.us";

const cleanups: Array<() => Promise<void> | void> = [];
afterEach(async () => {
  for (const fn of cleanups.splice(0).reverse()) {
    await fn();
  }
});

function makeStore(): Store {
  const dir = mkdtempSync(join(tmpdir(), "t178-"));
  const store = openStore(dir);
  cleanups.push(() => {
    store.close();
    rmSync(dir, { recursive: true, force: true });
  });
  return store;
}

function seed(store: Store): void {
  upsertContact(store, {
    jid: DANA,
    name: "Dana Scully",
    pushname: "dana.s",
    phone: "358400000001",
  });
  upsertContact(store, { jid: ERIK, pushname: "Erik", username: "erik_w" });
  upsertContact(store, {
    jid: LID_ONLY,
    name: "Lid Person",
    lid: LID_ONLY,
    phone: "358497773518",
  });
  upsertContact(store, { jid: GROUP, name: "Dana's group" });
  setAlias(store, ERIK, "Landlord");
}

interface EngineMock {
  addOrEditContact: ReturnType<typeof vi.fn>;
  removeContact: ReturnType<typeof vi.fn>;
  onWhatsApp: ReturnType<typeof vi.fn>;
}

function engineMock(): EngineMock {
  return {
    addOrEditContact: vi.fn(async () => {}),
    removeContact: vi.fn(async () => {}),
    onWhatsApp: vi.fn(async (jid: string) => [{ jid, exists: true }]),
  };
}

function handleWith(socket: unknown): BridgeHandle {
  return {
    status: "connected",
    events: createEventBus(),
    close: async () => {},
    getLastQr: () => null,
    socket: socket as WASocket | undefined,
    hasPairedAccount: () => true,
    pairingBudget: () => ({ blocked: false, used: 0, limit: 3 }),
    resumePairing: () => {},
    connectionQuality: () => ({ reconnects: 0, lastDisconnectAt: null }),
    logout: async () => {},
    fetchHistory: async () => ({ requested: false, request_id: "" }),
    contactsWarm: () => true,
  } as unknown as BridgeHandle;
}

async function boot(
  socket: unknown = engineMock(),
  store: Store | undefined = makeStore(),
): Promise<{ bridge: BridgeHttp; store: Store | undefined }> {
  const bridge = await createHttpServer(handleWith(socket), { token: TOKEN, store });
  cleanups.push(() => bridge.close());
  return { bridge, store };
}

async function call(
  bridge: BridgeHttp,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(`http://127.0.0.1:${bridge.port}${path}`, {
    method,
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: body === undefined ? undefined : typeof body === "string" ? body : JSON.stringify(body),
  });
  return { status: res.status, body: (await res.json()) as Record<string, unknown> };
}

type View = Record<string, unknown>;

test("T178 A1 store — username, lid and phone persist and merge like the other fields", () => {
  const store = makeStore();
  upsertContact(store, {
    jid: DANA,
    name: "Dana",
    username: "dana_s",
    lid: "111222333444555@lid",
    phone: "358400000001",
  });
  upsertContact(store, { jid: DANA, pushname: "dana.s" });
  expect(getContact(store, DANA)).toEqual({
    jid: DANA,
    name: "Dana",
    pushname: "dana.s",
    businessName: null,
    phone: "358400000001",
    username: "dana_s",
    lid: "111222333444555@lid",
  });
});

test("T178 B2 store — clearSavedName drops the address-book name + username, keeps pushname", () => {
  const store = makeStore();
  upsertContact(store, { jid: DANA, name: "Dana", pushname: "dana.s", username: "dana_s" });
  clearSavedName(store, DANA);
  expect(getContact(store, DANA)).toMatchObject({
    name: null,
    username: null,
    pushname: "dana.s",
  });
});

test("T178 A2 views — displayName/phone/alias/source; groups excluded; sorted by displayName", () => {
  const store = makeStore();
  seed(store);
  const views = listContactViews(store, {});
  expect(views.contacts.map((view) => view.jid)).toEqual([DANA, ERIK, LID_ONLY]);
  expect(views.total).toBe(3);
  expect(views.contacts[0]).toEqual({
    jid: DANA,
    displayName: "Dana Scully",
    phone: "+358 40 000 0001",
    name: "Dana Scully",
    pushname: "dana.s",
    username: null,
    lid: null,
    businessName: null,
    alias: null,
    source: "whatsapp",
  });
  expect(views.contacts[1]).toMatchObject({
    displayName: "Landlord",
    phone: "+358 40 000 0002",
    pushname: "Erik",
    username: "erik_w",
    alias: "Landlord",
    source: "alias",
  });
  expect(views.contacts[2]).toMatchObject({ displayName: "Lid Person", phone: "+358 49 777 3518" });
});

test("T178 A2 views — unsaved rows fall back to pushname, then username, then formatted phone", () => {
  const store = makeStore();
  upsertContact(store, { jid: "358400000003@s.whatsapp.net", pushname: "Pushy" });
  upsertContact(store, { jid: "358400000004@s.whatsapp.net", username: "only_user" });
  upsertContact(store, { jid: "358400000005@s.whatsapp.net" });
  const names = listContactViews(store, {}).contacts.map((view) => view.displayName);
  expect(names).toEqual(["+358 40 000 0005", "only_user", "Pushy"]);
});

test("T178 A2 views — saved=true keeps only address-book names (WhatsApp Web contact list)", () => {
  const store = makeStore();
  seed(store);
  const views = listContactViews(store, { saved: true });
  expect(views.contacts.map((view) => view.jid)).toEqual([DANA, LID_ONLY]);
  expect(views.total).toBe(2);
});

test("T178 A2 search — name, pushname, username, alias, partial number (with separators)", () => {
  const store = makeStore();
  seed(store);
  const jids = (query: string): string[] =>
    listContactViews(store, { query }).contacts.map((view) => view.jid);
  expect(jids("scully")).toEqual([DANA]);
  expect(jids("DANA.S")).toEqual([DANA]);
  expect(jids("erik_")).toEqual([ERIK]);
  expect(jids("landl")).toEqual([ERIK]);
  expect(jids("0000002")).toEqual([ERIK]);
  expect(jids("+358 49 777")).toEqual([LID_ONLY]);
  expect(jids("dana's")).toEqual([]);
  expect(jids("nobody")).toEqual([]);
});

test("T178 A2 search — limit caps the page while total counts every match", () => {
  const store = makeStore();
  seed(store);
  const views = listContactViews(store, { limit: 1 });
  expect(views.contacts).toHaveLength(1);
  expect(views.total).toBe(3);
});

test("T178 A2 GET /api/contacts — q filter, saved flag, total, legacy query param", async () => {
  const store = makeStore();
  seed(store);
  const { bridge } = await boot(engineMock(), store);
  const all = await call(bridge, "GET", "/api/contacts");
  expect(all.status).toBe(200);
  expect((all.body.contacts as View[]).map((view) => view.jid)).toEqual([DANA, ERIK, LID_ONLY]);
  expect(all.body.total).toBe(3);
  const byQ = await call(bridge, "GET", "/api/contacts?q=erik");
  expect((byQ.body.contacts as View[])[0]).toMatchObject({ jid: ERIK, displayName: "Landlord" });
  const legacy = await call(bridge, "GET", "/api/contacts?query=scully");
  expect((legacy.body.contacts as View[]).map((view) => view.jid)).toEqual([DANA]);
  const saved = await call(bridge, "GET", "/api/contacts?saved=true");
  expect(saved.body.total).toBe(2);
});

test("T178 GET /api/contacts/:jid — unknown jid is a structured 404", async () => {
  const { bridge } = await boot();
  const res = await call(bridge, "GET", `/api/contacts/${encodeURIComponent(DANA)}`);
  expect(res.status).toBe(404);
  expect(res.body).toEqual({ error: { code: "NOT_FOUND", message: "contact not found" } });
});

test("T178 B1 POST /api/contacts — phone resolves via onWhatsApp, syncs, stores, returns view", async () => {
  const engine = engineMock();
  engine.onWhatsApp.mockResolvedValue([{ jid: DANA, exists: true }]);
  const { bridge, store } = await boot(engine);
  const res = await call(bridge, "POST", "/api/contacts", {
    phone: "+358 40 000 0001",
    name: "Dana Scully",
    username: "dana_s",
  });
  expect(res.status).toBe(201);
  expect(engine.onWhatsApp).toHaveBeenCalledWith("358400000001@s.whatsapp.net");
  expect(engine.addOrEditContact).toHaveBeenCalledWith(DANA, {
    fullName: "Dana Scully",
    firstName: "Dana",
    username: "dana_s",
    saveOnPrimaryAddressbook: true,
  });
  expect(res.body.contact).toMatchObject({
    jid: DANA,
    displayName: "Dana Scully",
    phone: "+358 40 000 0001",
    username: "dana_s",
    source: "whatsapp",
  });
  expect(getContact(store as Store, DANA)).toMatchObject({
    name: "Dana Scully",
    phone: "358400000001",
  });
});

test("T178 B1 POST /api/contacts — explicit jid skips the lookup; username omitted when absent", async () => {
  const engine = engineMock();
  const { bridge } = await boot(engine);
  const res = await call(bridge, "POST", "/api/contacts", { jid: LID_ONLY, name: "Lid Person" });
  expect(res.status).toBe(201);
  expect(engine.onWhatsApp).not.toHaveBeenCalled();
  expect(engine.addOrEditContact).toHaveBeenCalledWith(LID_ONLY, {
    fullName: "Lid Person",
    firstName: "Lid",
    saveOnPrimaryAddressbook: true,
  });
});

test("T178 B1 POST /api/contacts — validation 400s never touch the engine", async () => {
  const engine = engineMock();
  const { bridge } = await boot(engine);
  const cases: Array<[unknown, string]> = [
    ["{nope", "body must be valid JSON"],
    [{ phone: "+358400000001" }, "name is required"],
    [{ phone: "+358400000001", name: "   " }, "name is required"],
    [{ name: "Dana" }, "phone or jid is required"],
    [{ name: "Dana", phone: "12ab" }, "phone must be 8-15 digits with country code"],
    [{ name: "Dana", jid: GROUP }, "jid must be a person (…@s.whatsapp.net or …@lid)"],
    [{ name: "Dana", phone: "+358400000001", username: 5 }, "username must be a string"],
  ];
  for (const [body, message] of cases) {
    const res = await call(bridge, "POST", "/api/contacts", body);
    expect(res.status, JSON.stringify(body)).toBe(400);
    expect(res.body).toEqual({ error: { code: "VALIDATION_ERROR", message } });
  }
  expect(engine.addOrEditContact).not.toHaveBeenCalled();
  expect(engine.onWhatsApp).not.toHaveBeenCalled();
});

test("T178 B1 POST /api/contacts — number not on WhatsApp is 422", async () => {
  const engine = engineMock();
  engine.onWhatsApp.mockResolvedValue([]);
  const { bridge } = await boot(engine);
  const res = await call(bridge, "POST", "/api/contacts", {
    phone: "+358400000009",
    name: "Ghost",
  });
  expect(res.status).toBe(422);
  expect((res.body.error as { code: string }).code).toBe("NOT_ON_WHATSAPP");
  expect(engine.addOrEditContact).not.toHaveBeenCalled();
});

test("T178 B1 engine failures map to 502 CONTACT_SYNC_FAILED and leave the store untouched", async () => {
  const engine = engineMock();
  engine.addOrEditContact.mockRejectedValue(new Error("app state key not found"));
  const { bridge, store } = await boot(engine);
  const res = await call(bridge, "POST", "/api/contacts", { jid: DANA, name: "Dana" });
  expect(res.status).toBe(502);
  expect(res.body).toEqual({
    error: { code: "CONTACT_SYNC_FAILED", message: "app state key not found" },
  });
  expect(getContact(store as Store, DANA)).toBeNull();
  engine.onWhatsApp.mockRejectedValue(new Error("usync timeout"));
  const lookup = await call(bridge, "POST", "/api/contacts", { phone: "358400000001", name: "D" });
  expect(lookup.status).toBe(502);
  expect((lookup.body.error as { code: string }).code).toBe("CONTACT_LOOKUP_FAILED");
});

test("T178 B1 writes without a live socket are 503 NOT_CONNECTED; no store is 501", async () => {
  const { bridge } = await boot(null);
  const res = await call(bridge, "POST", "/api/contacts", { jid: DANA, name: "Dana" });
  expect(res.status).toBe(503);
  expect((res.body.error as { code: string }).code).toBe("NOT_CONNECTED");
  const storeless = await createHttpServer(handleWith(engineMock()), { token: TOKEN });
  cleanups.push(() => storeless.close());
  const noStore = await call(storeless, "DELETE", `/api/contacts/${DANA}`);
  expect(noStore.status).toBe(501);
});

test("T178 B1 PATCH /api/contacts/:jid — renames via addOrEditContact; phone path segment accepted", async () => {
  const engine = engineMock();
  const store = makeStore();
  upsertContact(store, { jid: DANA, name: "Dana", pushname: "dana.s" });
  const { bridge } = await boot(engine, store);
  const res = await call(bridge, "PATCH", `/api/contacts/${encodeURIComponent(DANA)}`, {
    name: "Agent Scully",
  });
  expect(res.status).toBe(200);
  expect(engine.addOrEditContact).toHaveBeenCalledWith(DANA, {
    fullName: "Agent Scully",
    firstName: "Agent",
    saveOnPrimaryAddressbook: true,
  });
  expect(res.body.contact).toMatchObject({ jid: DANA, displayName: "Agent Scully" });
  const byPhone = await call(bridge, "PATCH", "/api/contacts/358400000001", { name: "D" });
  expect(byPhone.status).toBe(200);
  expect(engine.addOrEditContact).toHaveBeenLastCalledWith(DANA, expect.anything());
  const missing = await call(bridge, "PATCH", `/api/contacts/${DANA}`, {});
  expect(missing.status).toBe(400);
  const group = await call(bridge, "PATCH", `/api/contacts/${GROUP}`, { name: "x" });
  expect(group.status).toBe(400);
});

test("T178 B1 DELETE /api/contacts/:jid — removeContact, saved name cleared, pushname kept", async () => {
  const engine = engineMock();
  const store = makeStore();
  upsertContact(store, { jid: DANA, name: "Dana", pushname: "dana.s" });
  const { bridge } = await boot(engine, store);
  const res = await call(bridge, "DELETE", `/api/contacts/${encodeURIComponent(DANA)}`);
  expect(res.status).toBe(200);
  expect(res.body).toEqual({ ok: true, removed: DANA });
  expect(engine.removeContact).toHaveBeenCalledWith(DANA);
  expect(getContact(store, DANA)).toMatchObject({ name: null, pushname: "dana.s" });
  engine.removeContact.mockRejectedValue(new Error("boom"));
  const failed = await call(bridge, "DELETE", `/api/contacts/${DANA}`);
  expect(failed.status).toBe(502);
  const bad = await call(bridge, "DELETE", "/api/contacts/not-a-jid");
  expect(bad.status).toBe(400);
});

test("T178 B1 an engine without the contact actions is 501 NOT_IMPLEMENTED", async () => {
  const { bridge } = await boot({ onWhatsApp: vi.fn() });
  const res = await call(bridge, "POST", "/api/contacts", { jid: DANA, name: "Dana" });
  expect(res.status).toBe(501);
  expect((res.body.error as { code: string }).code).toBe("NOT_IMPLEMENTED");
});
