import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { SAVED_CONTACTS, validateSubscriptionConfigInput } from "@wa-mcp/shared";
import { openStore } from "../src/store/schema.ts";
import { isSavedContactDm, upsertContact } from "../src/store/contacts.ts";
import { matchesConfig, type InboundMessage } from "../src/subs-dispatch.ts";

const fresh = () => openStore(mkdtempSync(join(tmpdir(), "wa-mcp-t201-")));

function store() {
  const s = fresh();
  upsertContact(s, { jid: "358401112222@s.whatsapp.net", name: "Anna", phone: "358401112222" });
  // keyed by PN; the chat arrives under the LID recorded in the lid column
  upsertContact(s, { jid: "358409990000@s.whatsapp.net", name: "Bo", lid: "99887766@lid" });
  // a contact row that is NOT saved (pushname only)
  upsertContact(s, { jid: "447700900123@s.whatsapp.net", pushname: "Stranger" });
  return s;
}

const message = (chatJid: string, rawChatJid = chatJid): InboundMessage => ({
  chatJid,
  rawChatJid,
  fromJid: chatJid,
  chatName: null,
  fromName: null,
  id: "M1",
  text: "hello",
  media: false,
  mentionedJids: [],
  backlogTsMs: null,
});

const config = (chats: string[]) => ({
  id: "s1",
  created: "2026-01-01T00:00:00Z",
  name: "contacts",
  chats,
  filter: {},
  delivery: { mode: "inbox" as const },
  enabled: true,
});

test("saved contacts match by PN jid, device jid, LID and phone digits; unsaved and groups don't", () => {
  const s = store();
  expect(isSavedContactDm(s, ["358401112222@s.whatsapp.net"])).toBe(true);
  expect(isSavedContactDm(s, ["358401112222:3@s.whatsapp.net"])).toBe(true);
  expect(isSavedContactDm(s, ["99887766@lid"])).toBe(true);
  expect(isSavedContactDm(s, ["447700900123@s.whatsapp.net"])).toBe(false);
  expect(isSavedContactDm(s, ["120363000000000000@g.us"])).toBe(false);
});

test("a LID-addressed chat whose canonical PN is saved still matches", () => {
  const s = store();
  // the dispatcher passes [canonical PN, raw LID]
  expect(isSavedContactDm(s, ["358401112222@s.whatsapp.net", "55554444@lid"])).toBe(true);
});

test("a row saved with a formatted phone still matches the PN chat", () => {
  const s = fresh();
  upsertContact(s, { jid: "77777@lid", name: "Cy", phone: "+358 40-111 3333" });
  expect(isSavedContactDm(s, ["358401113333@s.whatsapp.net"])).toBe(true);
});

test("the @contacts selector passes the chat gate only for saved-contact DMs", () => {
  const sub = config([SAVED_CONTACTS]);
  expect(matchesConfig(sub, message("358401112222@s.whatsapp.net"), [], () => true)).toBe(true);
  expect(matchesConfig(sub, message("447700900123@s.whatsapp.net"), [], () => false)).toBe(false);
});

test("@contacts combines with explicit chats (a group plus every saved contact)", () => {
  const sub = config([SAVED_CONTACTS, "120363000000000000@g.us"]);
  expect(matchesConfig(sub, message("120363000000000000@g.us"), [], () => false)).toBe(true);
});

test("validation accepts @contacts, alone or with chats, and still refuses it next to *", () => {
  const base = { name: "c", filter: {}, delivery: { mode: "inbox" }, enabled: true };
  expect(validateSubscriptionConfigInput({ ...base, chats: [SAVED_CONTACTS] }).ok).toBe(true);
  expect(
    validateSubscriptionConfigInput({ ...base, chats: [SAVED_CONTACTS, "120363000000000000@g.us"] })
      .ok,
  ).toBe(true);
  expect(validateSubscriptionConfigInput({ ...base, chats: ["*", SAVED_CONTACTS] }).ok).toBe(false);
});
