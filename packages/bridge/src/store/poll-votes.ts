import { createHash } from "node:crypto";
import type { Store } from "./schema.ts";

/** One entry of `update.pollUpdates` exactly as the fork emits it after
 * decrypting (process-message.js): the voter's own message key, the decoded
 * PollVoteMessage (selectedOptions = sha256 bytes of the chosen option
 * labels), and the vote timestamp. */
export interface PollVoteUpdate {
  pollUpdateMessageKey?: {
    participant?: string | null;
    remoteJid?: string | null;
    /** T94-D-M1: own votes (no participant in DMs) attribute to "me" */
    fromMe?: boolean;
  };
  vote?: { selectedOptions?: Array<Uint8Array | Buffer> };
  senderTimestampMs?: number;
}

/** T76 H4: persist decoded poll votes. Option indexes are recovered by
 * sha256-matching each selectedOption against the poll_options labels stored
 * at ingest; votes whose hash matches no stored option are skipped (engine
 * options may have been edited since), as are updates without a voter key. */
export function storePollVotes(
  store: Store,
  chatJid: string,
  pollMessageId: string,
  updates: PollVoteUpdate[],
): number {
  const labels = store.db
    .prepare(
      "SELECT idx, label FROM poll_options WHERE chat_jid = ? AND message_id = ? ORDER BY idx",
    )
    .all(chatJid, pollMessageId) as Array<{ idx: number; label: string }>;
  const digests = labels.map(({ idx, label }) => ({
    idx,
    digest: createHash("sha256").update(label).digest(),
  }));
  const insert = store.db.prepare(
    "INSERT INTO poll_votes (chat_jid, message_id, voter_jid, option_idx, voted_at) VALUES (?, ?, ?, ?, ?)",
  );
  // T94-D-M1: each update carries the voter's FULL current selection — the
  // previous rows go first, and an empty selection is a retraction
  const deleteVoter = store.db.prepare(
    "DELETE FROM poll_votes WHERE chat_jid = ? AND message_id = ? AND voter_jid = ?",
  );
  let stored = 0;
  for (const update of updates) {
    const key = update.pollUpdateMessageKey;
    const voter = key?.fromMe === true ? "me" : (key?.participant ?? key?.remoteJid);
    if (typeof voter !== "string" || voter.length === 0) {
      continue;
    }
    deleteVoter.run(chatJid, pollMessageId, voter);
    const votedAt = new Date(update.senderTimestampMs ?? Date.now()).toISOString();
    for (const selected of update.vote?.selectedOptions ?? []) {
      const bytes = Buffer.from(selected);
      const match = digests.find((entry) => bytes.equals(entry.digest));
      if (match === undefined) {
        continue;
      }
      insert.run(chatJid, pollMessageId, voter, match.idx, votedAt);
      stored += 1;
    }
  }
  return stored;
}
