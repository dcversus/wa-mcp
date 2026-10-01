import { expect, test, vi } from "vite-plus/test";
import type { WASocket } from "@whiskeysockets/baileys";
import {
  createGroup,
  getGroupInviteCode,
  groupSettingUpdate,
  joinGroupByInvite,
  leaveGroup,
  revokeGroupInvite,
  updateGroupDescription,
  updateGroupParticipants,
  updateGroupSubject,
} from "../src/groups.ts";

function fakeSocket() {
  const metadata = { id: "120363999999999999@g.us", subject: "New Group", participants: [] };
  const fns = {
    groupCreate: vi.fn(async () => metadata),
    groupLeave: vi.fn(async () => {}),
    groupUpdateSubject: vi.fn(async () => {}),
    groupUpdateDescription: vi.fn(async () => {}),
    groupParticipantsUpdate: vi.fn(async () => [
      { status: "200", jid: "358401111111@s.whatsapp.net" },
    ]),
    groupSettingUpdate: vi.fn(async () => {}),
    groupInviteCode: vi.fn(async () => "INVITECODE123"),
    groupRevokeInvite: vi.fn(async () => "NEWCODE456"),
    groupAcceptInvite: vi.fn(async () => "120363888888888888@g.us"),
    groupFetchAllParticipating: vi.fn(async () => ({
      "120363428874442773@g.us": { id: "120363428874442773@g.us" },
    })),
  };
  return { sock: fns as unknown as WASocket, fns, metadata };
}

test("createGroup calls the engine and returns the metadata", async () => {
  const { sock, fns, metadata } = fakeSocket();
  const result = await createGroup(sock, "New Group", [
    "358401111111@s.whatsapp.net",
    "358402222222@s.whatsapp.net",
  ]);
  expect(fns.groupCreate).toHaveBeenCalledWith("New Group", [
    "358401111111@s.whatsapp.net",
    "358402222222@s.whatsapp.net",
  ]);
  expect(result).toEqual(metadata);
});

test("leaveGroup and updateGroupSubject pass through", async () => {
  const { sock, fns } = fakeSocket();
  await leaveGroup(sock, "120363999999999999@g.us");
  await updateGroupSubject(sock, "120363999999999999@g.us", "Renamed");
  expect(fns.groupLeave).toHaveBeenCalledWith("120363999999999999@g.us");
  expect(fns.groupUpdateSubject).toHaveBeenCalledWith("120363999999999999@g.us", "Renamed");
});

test("updateGroupDescription allows undefined to clear", async () => {
  const { sock, fns } = fakeSocket();
  await updateGroupDescription(sock, "120363999999999999@g.us", "desc");
  await updateGroupDescription(sock, "120363999999999999@g.us");
  expect(fns.groupUpdateDescription).toHaveBeenNthCalledWith(1, "120363999999999999@g.us", "desc");
  expect(fns.groupUpdateDescription).toHaveBeenNthCalledWith(
    2,
    "120363999999999999@g.us",
    undefined,
  );
});

test("updateGroupParticipants validates and forwards the action", async () => {
  const { sock, fns } = fakeSocket();
  const result = await updateGroupParticipants(
    sock,
    "120363999999999999@g.us",
    ["358401111111@s.whatsapp.net"],
    "promote",
  );
  expect(fns.groupParticipantsUpdate).toHaveBeenCalledWith(
    "120363999999999999@g.us",
    ["358401111111@s.whatsapp.net"],
    "promote",
  );
  expect(result).toEqual([{ status: "200", jid: "358401111111@s.whatsapp.net" }]);
  await expect(
    updateGroupParticipants(
      sock,
      "120363999999999999@g.us",
      ["358401111111@s.whatsapp.net"],
      "teleport" as never,
    ),
  ).rejects.toMatchObject({ code: "VALIDATION_ERROR" });
});

test("groupSettingUpdate validates the setting", async () => {
  const { sock, fns } = fakeSocket();
  await groupSettingUpdate(sock, "120363999999999999@g.us", "announcement");
  await groupSettingUpdate(sock, "120363999999999999@g.us", "unlocked");
  expect(fns.groupSettingUpdate).toHaveBeenNthCalledWith(
    1,
    "120363999999999999@g.us",
    "announcement",
  );
  expect(fns.groupSettingUpdate).toHaveBeenNthCalledWith(2, "120363999999999999@g.us", "unlocked");
  await expect(
    groupSettingUpdate(sock, "120363999999999999@g.us", "louder" as never),
  ).rejects.toMatchObject({
    code: "VALIDATION_ERROR",
  });
});

test("invite code helpers round-trip", async () => {
  const { sock, fns } = fakeSocket();
  expect(await getGroupInviteCode(sock, "120363999999999999@g.us")).toBe("INVITECODE123");
  expect(await revokeGroupInvite(sock, "120363999999999999@g.us")).toBe("NEWCODE456");
  expect(await joinGroupByInvite(sock, "SOMECODE")).toBe("120363888888888888@g.us");
  expect(fns.groupInviteCode).toHaveBeenCalledWith("120363999999999999@g.us");
  expect(fns.groupRevokeInvite).toHaveBeenCalledWith("120363999999999999@g.us");
  expect(fns.groupAcceptInvite).toHaveBeenCalledWith("SOMECODE");
});
