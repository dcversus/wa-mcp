import { expect, test } from "vite-plus/test";
import { PRIVACY_READ_TO_WRITE, buildPrivacyPatch, privacyOptionsFor } from "../src/state.ts";

test("read-to-write privacy key mapping covers every write key the bridge accepts", () => {
  const writeKeys = [
    "readReceipts",
    "online",
    "lastSeen",
    "profilePic",
    "status",
    "groups",
    "calls",
    "messages",
  ];
  const mapped = Object.values(PRIVACY_READ_TO_WRITE);
  for (const key of writeKeys) {
    expect(mapped).toContain(key);
  }
});

test("buildPrivacyPatch maps a read key to the bridge patch shape", () => {
  expect(buildPrivacyPatch("last", "contacts")).toEqual({ lastSeen: "contacts" });
  expect(buildPrivacyPatch("profile", "none")).toEqual({ profilePic: "none" });
  expect(buildPrivacyPatch("status", "contacts")).toEqual({ status: "contacts" });
  expect(buildPrivacyPatch("groupadd", "all")).toEqual({ groups: "all" });
  expect(buildPrivacyPatch("calladd", "known")).toEqual({ calls: "known" });
  expect(buildPrivacyPatch("readreceipts", "none")).toEqual({ readReceipts: "none" });
});

test("buildPrivacyPatch rejects unknown read keys", () => {
  expect(() => buildPrivacyPatch("bogus", "all")).toThrow();
});

test("privacyOptionsFor lists the values the bridge allows per key", () => {
  expect(privacyOptionsFor("last")).toEqual(["all", "contacts", "contact_blacklist", "none"]);
  expect(privacyOptionsFor("online")).toEqual(["all", "match_last_seen"]);
  expect(privacyOptionsFor("calladd")).toEqual(["all", "known"]);
  expect(privacyOptionsFor("readreceipts")).toEqual(["all", "none"]);
});
