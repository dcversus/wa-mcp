import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openStore, type Store } from "../../src/store/schema.ts";
import {
  deleteContact,
  getAlias,
  getContact,
  listContactViews,
  setAlias,
  upsertContact,
} from "../../src/store/contacts.ts";

function makeStore(): Store {
  return openStore(mkdtempSync(join(tmpdir(), "wa-mcp-contacts-")));
}

test("upsertContact inserts and getContact reads it back", () => {
  const store = makeStore();
  try {
    upsertContact(store, {
      jid: "358497773518@s.whatsapp.net",
      name: "Vasilisa",
      pushname: "vasi",
    });
    const contact = getContact(store, "358497773518@s.whatsapp.net");
    expect(contact).toEqual({
      jid: "358497773518@s.whatsapp.net",
      name: "Vasilisa",
      pushname: "vasi",
      businessName: null,
      phone: null,
      username: null,
      lid: null,
    });
  } finally {
    store.close();
  }
});

test("merge semantics: a new null keeps the existing field, a new non-null overwrites", () => {
  const store = makeStore();
  try {
    const jid = "358497773518@s.whatsapp.net";
    upsertContact(store, { jid, name: "Saved Name", pushname: "old-push" });
    upsertContact(store, { jid, name: null, pushname: "new-push" });
    const contact = getContact(store, jid);
    if (!contact) throw new Error("contact missing");
    expect(contact.name).toBe("Saved Name");
    expect(contact.pushname).toBe("new-push");
  } finally {
    store.close();
  }
});

test("phone is stored when provided (rc14 Contact.phoneNumber)", () => {
  const store = makeStore();
  try {
    upsertContact(store, {
      jid: "55600000009854@lid",
      name: "LID contact",
      phone: "+55600000009854",
    });
    const contact = getContact(store, "55600000009854@lid");
    expect(contact?.phone).toBe("+55600000009854");
  } finally {
    store.close();
  }
});

test("listContactViews searches name, pushname and jid case-insensitively", () => {
  const store = makeStore();
  try {
    upsertContact(store, { jid: "358461111111@s.whatsapp.net", name: "John Doe" });
    upsertContact(store, { jid: "358462222222@s.whatsapp.net", pushname: "Johnny" });
    upsertContact(store, { jid: "358463333333@s.whatsapp.net", name: "Someone Else" });
    const hits = listContactViews(store, { query: "john" }).contacts;
    expect(hits).toHaveLength(2);
    const byJid = listContactViews(store, { query: "358463333333" }).contacts;
    expect(byJid).toHaveLength(1);
    expect(byJid[0]?.jid).toBe("358463333333@s.whatsapp.net");
    expect(listContactViews(store, {}).contacts).toHaveLength(3);
    expect(listContactViews(store, { limit: 1 }).contacts).toHaveLength(1);
  } finally {
    store.close();
  }
});

test("deleteContact removes the row", () => {
  const store = makeStore();
  try {
    const jid = "358497773518@s.whatsapp.net";
    upsertContact(store, { jid, name: "Vasilisa" });
    deleteContact(store, jid);
    expect(getContact(store, jid)).toBeNull();
  } finally {
    store.close();
  }
});

test("aliases remember jids and replace on re-set", () => {
  const store = makeStore();
  try {
    setAlias(store, "358497773518@s.whatsapp.net", "me");
    expect(getAlias(store, "me")).toEqual({ jid: "358497773518@s.whatsapp.net" });
    setAlias(store, "358400000000@s.whatsapp.net", "me");
    expect(getAlias(store, "me")).toEqual({ jid: "358400000000@s.whatsapp.net" });
    expect(getAlias(store, "unknown")).toBeNull();
  } finally {
    store.close();
  }
});
