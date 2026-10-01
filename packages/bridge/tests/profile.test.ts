import { expect, test, vi } from "vite-plus/test";
import type { WASocket } from "@whiskeysockets/baileys";
import {
  ValidationError,
  blockUnblock,
  getBlocklist,
  setProfilePicture,
  updatePrivacy,
  updateProfile,
} from "../src/profile.ts";

function fakeSocket() {
  const fns = {
    updateProfileName: vi.fn(async () => {}),
    updateProfileStatus: vi.fn(async () => {}),
    updateProfilePicture: vi.fn(async () => {}),
    updateReadReceiptsPrivacy: vi.fn(async () => {}),
    updateOnlinePrivacy: vi.fn(async () => {}),
    updateLastSeenPrivacy: vi.fn(async () => {}),
    updateProfilePicturePrivacy: vi.fn(async () => {}),
    updateStatusPrivacy: vi.fn(async () => {}),
    updateGroupsAddPrivacy: vi.fn(async () => {}),
    updateCallPrivacy: vi.fn(async () => {}),
    updateMessagesPrivacy: vi.fn(async () => {}),
    updateBlockStatus: vi.fn(async () => {}),
    fetchBlocklist: vi.fn(async () => ["999@s.whatsapp.net"]),
  };
  return {
    sock: { ...fns, user: { jid: "358497773518@s.whatsapp.net" } } as unknown as WASocket,
    fns,
  };
}

test("updateProfile applies name and status through the engine fns", async () => {
  const { sock, fns } = fakeSocket();
  await updateProfile(sock, { name: "New Name", status: "new about" });
  expect(fns.updateProfileName).toHaveBeenCalledWith("New Name");
  expect(fns.updateProfileStatus).toHaveBeenCalledWith("new about");
});

test("updateProfile skips unset fields", async () => {
  const { sock, fns } = fakeSocket();
  await updateProfile(sock, { name: "Only Name" });
  expect(fns.updateProfileName).toHaveBeenCalledTimes(1);
  expect(fns.updateProfileStatus).not.toHaveBeenCalled();
});

test("setProfilePicture uploads the buffer for the own jid", async () => {
  const { sock, fns } = fakeSocket();
  const buffer = Buffer.from("89504e47", "hex");
  await setProfilePicture(sock, buffer);
  expect(fns.updateProfilePicture).toHaveBeenCalledWith("358497773518@s.whatsapp.net", buffer);
});

test("updatePrivacy maps each key to its engine setter", async () => {
  const { sock, fns } = fakeSocket();
  await updatePrivacy(sock, {
    readReceipts: "none",
    online: "match_last_seen",
    lastSeen: "contacts",
    groups: "contacts",
    calls: "known",
    messages: "contacts",
  });
  expect(fns.updateReadReceiptsPrivacy).toHaveBeenCalledWith("none");
  expect(fns.updateOnlinePrivacy).toHaveBeenCalledWith("match_last_seen");
  expect(fns.updateLastSeenPrivacy).toHaveBeenCalledWith("contacts");
  expect(fns.updateGroupsAddPrivacy).toHaveBeenCalledWith("contacts");
  expect(fns.updateCallPrivacy).toHaveBeenCalledWith("known");
  expect(fns.updateMessagesPrivacy).toHaveBeenCalledWith("contacts");
});

test("updatePrivacy maps the remaining keys", async () => {
  const { sock, fns } = fakeSocket();
  await updatePrivacy(sock, { profilePic: "all", status: "none" });
  expect(fns.updateProfilePicturePrivacy).toHaveBeenCalledWith("all");
  expect(fns.updateStatusPrivacy).toHaveBeenCalledWith("none");
});

test("updatePrivacy rejects unsupported keys with the supported list", async () => {
  const { sock } = fakeSocket();
  await expect(updatePrivacy(sock, { visibility: "all" } as never)).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
  });
  await expect(updatePrivacy(sock, { visibility: "all" } as never)).rejects.toThrow(/visibility/);
});

test("updatePrivacy rejects values outside a key's allowed set", async () => {
  const { sock } = fakeSocket();
  await expect(updatePrivacy(sock, { readReceipts: "contacts" })).rejects.toThrow(/all, none/);
});

test("ValidationError carries the validation code", () => {
  const err = new ValidationError("bad");
  expect(err.code).toBe("VALIDATION_ERROR");
});

test("blockUnblock maps the boolean to the engine action", async () => {
  const { sock, fns } = fakeSocket();
  await blockUnblock(sock, "999@s.whatsapp.net", true);
  expect(fns.updateBlockStatus).toHaveBeenCalledWith("999@s.whatsapp.net", "block");
  await blockUnblock(sock, "999@s.whatsapp.net", false);
  expect(fns.updateBlockStatus).toHaveBeenCalledWith("999@s.whatsapp.net", "unblock");
});

test("getBlocklist returns the jids", async () => {
  const { sock } = fakeSocket();
  expect(await getBlocklist(sock)).toEqual(["999@s.whatsapp.net"]);
});
