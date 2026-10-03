import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test } from "vite-plus/test";
import { openStore } from "../../src/store/schema.ts";
import { storeMessage } from "../../src/store/messages.ts";
import { storePollVotes } from "../../src/store/poll-votes.ts";

const sha = (label: string) => createHash("sha256").update(label).digest();

function pollMessage(id: string) {
  return {
    key: { remoteJid: "120363428874442773@g.us", fromMe: false, id },
    message: {
      pollCreationMessage: {
        name: "lunch",
        options: ["Pizza", "Burger"],
        selectableOptionsCount: 1,
      },
      messageContextInfo: { messageSecret: "c2VjcmV0" },
    },
    messageTimestamp: 1000,
  } as never;
}

test("decoded votes persist with voter + option index (fork messages.update shape)", () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-polls-")));
  try {
    storeMessage(store, pollMessage("POLL1"));
    const stored = storePollVotes(store, "120363428874442773@g.us", "POLL1", [
      {
        pollUpdateMessageKey: { participant: "358401112222@s.whatsapp.net" },
        vote: { selectedOptions: [sha("Pizza")] },
        senderTimestampMs: 1_700_000_000_000,
      },
    ]);
    expect(stored).toBe(1);
    const rows = store.db.prepare("SELECT * FROM poll_votes").all();
    expect(rows).toHaveLength(1);
    const row = rows[0] as Record<string, unknown>;
    expect(row.voter_jid).toBe("358401112222@s.whatsapp.net");
    expect(row.option_idx).toBe(0);
    expect(row.voted_at).toBe(new Date(1_700_000_000_000).toISOString());
  } finally {
    store.close();
  }
});

test("unmatched hashes and voterless updates are skipped, never half-stored", () => {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-polls-")));
  try {
    storeMessage(store, pollMessage("POLL2"));
    const stored = storePollVotes(store, "120363428874442773@g.us", "POLL2", [
      {
        pollUpdateMessageKey: { participant: "358401112222@s.whatsapp.net" },
        vote: { selectedOptions: [sha("Nope")] },
        senderTimestampMs: 1_700_000_000_000,
      },
      { vote: { selectedOptions: [sha("Pizza")] }, senderTimestampMs: 1_700_000_000_001 },
    ]);
    expect(stored).toBe(0);
    expect(store.db.prepare("SELECT COUNT(*) AS n FROM poll_votes").get()).toEqual({ n: 0 });
  } finally {
    store.close();
  }
});
