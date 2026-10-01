import { expect, test } from "vite-plus/test";
import { isGroupJid, isLidJid, isPhoneJid, jidType, normalizeJid } from "../src/jid.ts";

test("normalizeJid appends default domain to a bare phone number", () => {
  expect(normalizeJid("358497773518")).toBe("358497773518@s.whatsapp.net");
});

test("normalizeJid strips plus, spaces, and dashes", () => {
  expect(normalizeJid("+358 497 773 518")).toBe("358497773518@s.whatsapp.net");
  expect(normalizeJid("+358-497-773-518")).toBe("358497773518@s.whatsapp.net");
});

test("normalizeJid keeps an explicit user domain", () => {
  expect(normalizeJid("358497773518@s.whatsapp.net")).toBe("358497773518@s.whatsapp.net");
});

test("normalizeJid strips a device suffix", () => {
  expect(normalizeJid("358497773518:5@s.whatsapp.net")).toBe("358497773518@s.whatsapp.net");
});

test("normalizeJid keeps lid domain", () => {
  expect(normalizeJid("55600000009854@lid")).toBe("55600000009854@lid");
});

test("normalizeJid lowercases and keeps group domain", () => {
  expect(normalizeJid("120363428874442773@G.US")).toBe("120363428874442773@g.us");
});

test("normalizeJid returns null for empty or non-jid input", () => {
  expect(normalizeJid("")).toBeNull();
  expect(normalizeJid("   ")).toBeNull();
  expect(normalizeJid("not-a-jid")).toBeNull();
});

test("jidType classifies canonical and bare jids", () => {
  expect(jidType("358497773518")).toBe("user");
  expect(jidType("358497773518@s.whatsapp.net")).toBe("user");
  expect(jidType("120363428874442773@g.us")).toBe("group");
  expect(jidType("55600000009854@lid")).toBe("lid");
  expect(jidType("1234567890@newsletter")).toBe("newsletter");
  expect(jidType("1234567890@broadcast")).toBe("broadcast");
  expect(jidType("weird@elsewhere")).toBe("unknown");
  expect(jidType("")).toBe("unknown");
});

test("type predicates match their jid kinds", () => {
  expect(isPhoneJid("358497773518@s.whatsapp.net")).toBe(true);
  expect(isPhoneJid("120363428874442773@g.us")).toBe(false);
  expect(isGroupJid("120363428874442773@g.us")).toBe(true);
  expect(isGroupJid("358497773518")).toBe(false);
  expect(isLidJid("55600000009854@lid")).toBe(true);
  expect(isLidJid("358497773518@s.whatsapp.net")).toBe(false);
});
