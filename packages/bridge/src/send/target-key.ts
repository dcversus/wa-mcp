import type { proto, WASocket } from "baileys";
import type { Store } from "../store/schema.ts";
import { resolveLidJid } from "./send.ts";

/** The key of an existing message, as WhatsApp addressed it — what a
 * reaction (or any action on that message) must carry. In a group the
 * phones attach the action by (chat, id, participant), and in a LID-addressed
 * group the participant is the sender's LID, not the phone jid we store as
 * sender_jid. A message we never saw falls back to a bare key. */
export async function targetMessageKey(
  store: Store | undefined,
  socket: WASocket | undefined,
  chatJid: string,
  messageId: string,
): Promise<proto.IMessageKey> {
  const row =
    store === undefined
      ? undefined
      : (store.db
          .prepare(
            "SELECT sender_jid, is_from_me, key_remote_jid, key_participant FROM messages WHERE chat_jid = ? AND id = ?",
          )
          .get(chatJid, messageId) as
          | {
              sender_jid: string | null;
              is_from_me: number;
              key_remote_jid: string | null;
              key_participant: string | null;
            }
          | undefined);
  if (row === undefined) {
    return { remoteJid: chatJid, id: messageId, fromMe: false };
  }
  const fromMe = row.is_from_me === 1;
  const key: proto.IMessageKey = {
    remoteJid: row.key_remote_jid ?? chatJid,
    id: messageId,
    fromMe,
  };
  if (row.key_participant !== null) {
    key.participant = row.key_participant;
  } else if (!fromMe && chatJid.endsWith("@g.us") && row.sender_jid !== null) {
    // stored before the wire key was kept: groups are LID-addressed in the
    // LID era, so prefer the sender's mapped LID over the phone jid
    key.participant =
      socket === undefined ? row.sender_jid : await resolveLidJid(socket, row.sender_jid);
  }
  return key;
}
