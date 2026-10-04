import { createHash } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
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
        options: [{ optionName: "Pizza" }, { optionName: "Burger" }],
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

describe("T94-D-M1 — a vote update REPLACES the voter's selection", () => {
  function voteFixture(): {
    store: ReturnType<typeof openStore>;
    hash: (label: string) => Uint8Array;
  } {
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-m1-")));
    store.db
      .prepare("INSERT INTO poll_options (chat_jid, message_id, idx, label) VALUES (?, ?, ?, ?)")
      .run("120363428874442773@g.us", "POLL1", 0, "Pizza");
    store.db
      .prepare("INSERT INTO poll_options (chat_jid, message_id, idx, label) VALUES (?, ?, ?, ?)")
      .run("120363428874442773@g.us", "POLL1", 1, "Salad");
    const hash = (label: string) => createHash("sha256").update(label).digest();
    return { store, hash };
  }

  function vote(voter: string, labels: string[], hash: (l: string) => Uint8Array) {
    return {
      pollUpdateMessageKey: { participant: voter },
      vote: { selectedOptions: labels.map(hash) },
      senderTimestampMs: 1_760_000_000_000,
    };
  }

  test("changing the choice leaves exactly the new option", () => {
    const { store, hash } = voteFixture();
    storePollVotes(store, "120363428874442773@g.us", "POLL1", [
      vote("358400000077@s.whatsapp.net", ["Pizza"], hash),
    ]);
    // the voter changes their mind — the update carries the FULL selection
    storePollVotes(store, "120363428874442773@g.us", "POLL1", [
      vote("358400000077@s.whatsapp.net", ["Salad"], hash),
    ]);
    // RED today: OR REPLACE keyed by (voter, option) keeps BOTH rows
    const rows = store.db
      .prepare("SELECT option_idx FROM poll_votes WHERE voter_jid = ?")
      .all("358400000077@s.whatsapp.net") as Array<{ option_idx: number }>;
    expect(rows).toEqual([{ option_idx: 1 }]);
    store.close();
  });

  test("an empty selection is a retraction and clears the voter", () => {
    const { store, hash } = voteFixture();
    storePollVotes(store, "120363428874442773@g.us", "POLL1", [
      vote("358400000077@s.whatsapp.net", ["Pizza"], hash),
    ]);
    storePollVotes(store, "120363428874442773@g.us", "POLL1", [
      vote("358400000077@s.whatsapp.net", [], hash),
    ]);
    const rows = store.db
      .prepare("SELECT option_idx FROM poll_votes WHERE voter_jid = ?")
      .all("358400000077@s.whatsapp.net");
    expect(rows).toEqual([]);
    store.close();
  });

  test("own DM votes (fromMe key, no participant) attribute to me", () => {
    const { store, hash } = voteFixture();
    // the DM chat carries its own poll options
    store.db
      .prepare("INSERT INTO poll_options (chat_jid, message_id, idx, label) VALUES (?, ?, ?, ?)")
      .run("358497773518@s.whatsapp.net", "POLL1", 0, "Pizza");
    storePollVotes(store, "358497773518@s.whatsapp.net", "POLL1", [
      {
        // RED today: participant ?? remoteJid attributes the vote to the
        // OTHER party when fromMe has no participant
        pollUpdateMessageKey: { remoteJid: "358400000077@s.whatsapp.net", fromMe: true },
        vote: { selectedOptions: [hash("Pizza")] },
        senderTimestampMs: 1_760_000_000_000,
      },
    ]);
    const rows = store.db.prepare("SELECT voter_jid FROM poll_votes").all() as Array<{
      voter_jid: string;
    }>;
    expect(rows[0]?.voter_jid).toBe("me");
    store.close();
  });
});
