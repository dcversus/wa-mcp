import type { WAPresence, WASocket } from "@whiskeysockets/baileys";

export const PRESENCE_TYPES = [
  "available",
  "unavailable",
  "composing",
  "recording",
  "paused",
] as const satisfies readonly WAPresence[];

export type PresenceType = WAPresence;

export async function sendReadReceipt(
  socket: WASocket,
  chatJid: string,
  messageIds: string[],
): Promise<void> {
  const keys = messageIds.map((id) => ({ remoteJid: chatJid, id }));
  await socket.readMessages(keys);
}

export async function sendPresenceUpdate(
  socket: WASocket,
  chatJid: string,
  presence: PresenceType,
): Promise<void> {
  await socket.sendPresenceUpdate(presence, chatJid);
}

export async function sendTyping(socket: WASocket, chatJid: string): Promise<void> {
  await sendPresenceUpdate(socket, chatJid, "composing");
}
