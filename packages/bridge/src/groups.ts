import type { GroupMetadata, ParticipantAction, WASocket } from "@whiskeysockets/baileys";

export class GroupValidationError extends Error {
  readonly code = "VALIDATION_ERROR";
}

export type GroupSetting = "announcement" | "not_announcement" | "locked" | "unlocked";
export type GroupParticipantAction = Extract<
  ParticipantAction,
  "add" | "remove" | "promote" | "demote"
>;

const SETTINGS: readonly GroupSetting[] = [
  "announcement",
  "not_announcement",
  "locked",
  "unlocked",
];
const ACTIONS: readonly GroupParticipantAction[] = ["add", "remove", "promote", "demote"];

function assertSetting(setting: GroupSetting): void {
  if (!SETTINGS.includes(setting)) {
    throw new GroupValidationError(
      `invalid group setting: ${String(setting)} (allowed: ${SETTINGS.join(", ")})`,
    );
  }
}

function assertAction(action: GroupParticipantAction): void {
  if (!ACTIONS.includes(action)) {
    throw new GroupValidationError(
      `invalid participant action: ${String(action)} (allowed: ${ACTIONS.join(", ")})`,
    );
  }
}

export async function createGroup(
  socket: WASocket,
  subject: string,
  participants: string[],
): Promise<GroupMetadata> {
  return socket.groupCreate(subject, participants);
}

export async function leaveGroup(socket: WASocket, jid: string): Promise<void> {
  await socket.groupLeave(jid);
}

export async function updateGroupSubject(
  socket: WASocket,
  jid: string,
  subject: string,
): Promise<void> {
  await socket.groupUpdateSubject(jid, subject);
}

export async function updateGroupDescription(
  socket: WASocket,
  jid: string,
  description?: string,
): Promise<void> {
  await socket.groupUpdateDescription(jid, description);
}

export async function updateGroupParticipants(
  socket: WASocket,
  jid: string,
  participants: string[],
  action: GroupParticipantAction,
): Promise<Array<{ status: string; jid: string | undefined }>> {
  assertAction(action);
  return socket.groupParticipantsUpdate(jid, participants, action);
}

export async function groupSettingUpdate(
  socket: WASocket,
  jid: string,
  setting: GroupSetting,
): Promise<void> {
  assertSetting(setting);
  await socket.groupSettingUpdate(jid, setting);
}

export async function getGroupInviteCode(
  socket: WASocket,
  jid: string,
): Promise<string | undefined> {
  return socket.groupInviteCode(jid);
}

export async function revokeGroupInvite(
  socket: WASocket,
  jid: string,
): Promise<string | undefined> {
  return socket.groupRevokeInvite(jid);
}

export async function joinGroupByInvite(
  socket: WASocket,
  code: string,
): Promise<string | undefined> {
  return socket.groupAcceptInvite(code);
}

export async function fetchAllGroups(socket: WASocket): Promise<Record<string, GroupMetadata>> {
  return socket.groupFetchAllParticipating();
}
