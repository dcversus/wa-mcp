import { expect, test } from "vite-plus/test";
import {
  formatPhone,
  isGroupJid,
  isLidJid,
  isPhoneJid,
  isValidRecipientJid,
  jidType,
  normalizeJid,
  phoneDigits,
} from "../src/jid.ts";

test("T178 formatPhone renders WhatsApp-style grouping from digits, +prefix or a PN jid", () => {
  expect(formatPhone("358497773518")).toBe("+358 49 777 3518");
  expect(formatPhone("+358 49 777 3518")).toBe("+358 49 777 3518");
  expect(formatPhone("358400000001@s.whatsapp.net")).toBe("+358 40 000 0001");
  expect(formatPhone("358400000001:12@s.whatsapp.net")).toBe("+358 40 000 0001");
  expect(formatPhone("4915112345678")).toBe("+4915 1123 4567 8");
  expect(formatPhone("120363428874442773@g.us")).toBeNull();
  expect(formatPhone("55600000009854@lid")).toBeNull();
  expect(formatPhone("12345")).toBeNull();
});

test("T178 phoneDigits strips separators and rejects non-phone input", () => {
  expect(phoneDigits("+358 (49) 777-3518")).toBe("358497773518");
  expect(phoneDigits("358497773518@s.whatsapp.net")).toBe("358497773518");
  expect(phoneDigits("1234567")).toBeNull();
  expect(phoneDigits("1234567890123456")).toBeNull();
  expect(phoneDigits("+358abc")).toBeNull();
  expect(phoneDigits("55600000009854@lid")).toBeNull();
});

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

test("isValidRecipientJid accepts real WhatsApp recipients only", () => {
  expect(isValidRecipientJid("358497773518")).toBe(true);
  expect(isValidRecipientJid("+358 497 773 518")).toBe(true);
  expect(isValidRecipientJid("358497773518@s.whatsapp.net")).toBe(true);
  expect(isValidRecipientJid("120363428874442773@g.us")).toBe(true);
  expect(isValidRecipientJid("55600000009854@lid")).toBe(true);
  expect(isValidRecipientJid("status@broadcast")).toBe(true);
  expect(isValidRecipientJid("358497773518:5@s.whatsapp.net")).toBe(true);
  expect(isValidRecipientJid("garbage@@@")).toBe(false);
  expect(isValidRecipientJid("not-a-jid")).toBe(false);
  expect(isValidRecipientJid("weird@elsewhere")).toBe(false);
  expect(isValidRecipientJid("")).toBe(false);
});
