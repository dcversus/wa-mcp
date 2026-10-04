import { decryptPollVote, getKeyAuthor, jidNormalizedUser, proto } from "baileys";
import type { WAMessage } from "baileys";
import type { PollVoteUpdate } from "../store/poll-votes.ts";

/** T94-C-H1: the pinned fork's poll-vote decrypt-and-emit block is commented
 * out (process-message.js:576-624), so `messages.update` never carries
 * pollUpdates and poll_votes stayed empty in production. This reproduces the
 * commented orchestration on top of the fork's OWN crypto primitive
 * (decryptPollVote) — no crypto reimplemented, only the wiring. */
export function decryptInboundPollVote(
  message: WAMessage,
  pollMessage: proto.IMessage | undefined,
  meId: string,
): PollVoteUpdate | null {
  const update = message.message?.pollUpdateMessage;
  const creationKey = update?.pollCreationMessageKey;
  const secret = pollMessage?.messageContextInfo?.messageSecret;
  if (
    update === undefined ||
    update === null ||
    update.vote === undefined ||
    update.vote === null ||
    creationKey === undefined ||
    creationKey === null ||
    typeof creationKey.id !== "string" ||
    creationKey.id.length === 0 ||
    secret === undefined ||
    secret === null
  ) {
    return null;
  }
  const pollEncKey = toBytes(secret);
  if (pollEncKey === null) {
    return null;
  }
  const meIdNormalised = jidNormalizedUser(meId);
  const pollCreatorJid = getKeyAuthor(creationKey, meIdNormalised);
  const voterJid = getKeyAuthor(message.key, meIdNormalised);
  try {
    const vote = decryptPollVote(update.vote, {
      pollEncKey,
      pollCreatorJid,
      pollMsgId: creationKey.id,
      voterJid,
    });
    return {
      pollUpdateMessageKey: {
        participant: message.key.participant ?? null,
        remoteJid: message.key.remoteJid ?? null,
        fromMe: message.key.fromMe === true,
      },
      vote: { selectedOptions: vote.selectedOptions ?? [] },
      senderTimestampMs:
        update.senderTimestampMs === undefined || update.senderTimestampMs === null
          ? undefined
          : Number(update.senderTimestampMs),
    };
  } catch {
    // a malformed vote must never break ingest — drop it (the fork logs and
    // continues in its commented block as well)
    return null;
  }
}

/** the raw column is JSON — binary fields survive as arrays or {idx: byte}
 * maps depending on the writer; normalize both to bytes. */
function toBytes(value: unknown): Uint8Array | null {
  if (value instanceof Uint8Array) {
    return value;
  }
  if (Array.isArray(value)) {
    return Uint8Array.from(value as number[]);
  }
  if (value !== null && typeof value === "object") {
    return Uint8Array.from(Object.values(value as Record<string, number>).map((byte) => byte));
  }
  return null;
}
