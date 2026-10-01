import type { WASocket } from "@whiskeysockets/baileys";

export class ValidationError extends Error {
  readonly code = "VALIDATION_ERROR";
}

interface PrivacyKeySpec {
  values: string[];
  apply: (socket: WASocket, value: string) => Promise<void>;
}

const WAPRIVACY_ALL: string[] = ["all", "contacts", "contact_blacklist", "none"];

export const PRIVACY_KEYS: Record<string, PrivacyKeySpec> = {
  readReceipts: {
    values: ["all", "none"],
    apply: (socket, value) => socket.updateReadReceiptsPrivacy(value as "all" | "none"),
  },
  online: {
    values: ["all", "match_last_seen"],
    apply: (socket, value) => socket.updateOnlinePrivacy(value as "all" | "match_last_seen"),
  },
  lastSeen: {
    values: WAPRIVACY_ALL,
    apply: (socket, value) => socket.updateLastSeenPrivacy(value as "contacts"),
  },
  profilePic: {
    values: WAPRIVACY_ALL,
    apply: (socket, value) => socket.updateProfilePicturePrivacy(value as "all"),
  },
  status: {
    values: WAPRIVACY_ALL,
    apply: (socket, value) => socket.updateStatusPrivacy(value as "none"),
  },
  groups: {
    values: WAPRIVACY_ALL,
    apply: (socket, value) => socket.updateGroupsAddPrivacy(value as "contacts"),
  },
  calls: {
    values: ["all", "known"],
    apply: (socket, value) => socket.updateCallPrivacy(value as "known"),
  },
  messages: {
    values: ["all", "contacts"],
    apply: (socket, value) => socket.updateMessagesPrivacy(value as "contacts"),
  },
};

export interface ProfileUpdate {
  name?: string;
  status?: string;
}

export async function updateProfile(socket: WASocket, update: ProfileUpdate): Promise<void> {
  if (update.name !== undefined) {
    await socket.updateProfileName(update.name);
  }
  if (update.status !== undefined) {
    await socket.updateProfileStatus(update.status);
  }
}

export async function setProfilePicture(socket: WASocket, buffer: Buffer): Promise<void> {
  const user = (socket as { user?: { jid?: string } }).user;
  const jid = user?.jid;
  if (jid === undefined || jid.length === 0) {
    throw new ValidationError("own jid unknown - cannot set profile picture before connect");
  }
  await socket.updateProfilePicture(jid, buffer);
}

export async function updatePrivacy(
  socket: WASocket,
  patch: Record<string, string>,
): Promise<Array<{ key: string; value: string }>> {
  const applied: Array<{ key: string; value: string }> = [];
  for (const [key, value] of Object.entries(patch)) {
    const spec = PRIVACY_KEYS[key];
    if (spec === undefined) {
      throw new ValidationError(
        `unsupported privacy key: ${key} (supported: ${Object.keys(PRIVACY_KEYS).join(", ")})`,
      );
    }
    if (!spec.values.includes(value)) {
      throw new ValidationError(
        `invalid value for ${key}: ${value} (allowed: ${spec.values.join(", ")})`,
      );
    }
    await spec.apply(socket, value);
    applied.push({ key, value });
  }
  return applied;
}

export async function blockUnblock(socket: WASocket, jid: string, block: boolean): Promise<void> {
  await socket.updateBlockStatus(jid, block ? "block" : "unblock");
}

export async function getBlocklist(socket: WASocket): Promise<string[]> {
  const list = await socket.fetchBlocklist();
  return list.filter((jid): jid is string => jid !== undefined);
}
