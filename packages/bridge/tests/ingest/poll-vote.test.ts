import { createCipheriv, createHash, createHmac, randomBytes } from "node:crypto";
import { expect, test } from "vite-plus/test";

// inverse of the fork's decryptPollVote (process-message.js:146-162) so the
// RED/GREEN round-trip exercises the REAL decrypt primitive from baileys
function encryptPollVote(
  pollEncKey: Uint8Array,
  pollMsgId: string,
  pollCreatorJid: string,
  voterJid: string,
  selectedSha256: Uint8Array,
): { encPayload: Uint8Array; encIv: Uint8Array } {
  const toBinary = (txt: string) => Buffer.from(txt);
  const sign = Buffer.concat([
    toBinary(pollMsgId),
    toBinary(pollCreatorJid),
    toBinary(voterJid),
    toBinary("Poll Vote"),
    new Uint8Array([1]),
  ]);
  const hmac = (data: Buffer | Uint8Array, key: Buffer | Uint8Array) =>
    createHmac("sha256", key).update(data).digest();
  const key0 = hmac(pollEncKey, Buffer.alloc(32));
  const decKey = hmac(sign, key0);
  const aad = toBinary(`${pollMsgId}\u0000${voterJid}`);
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", decKey, iv);
  const plaintext = Buffer.concat([
    Buffer.from([0x0a, selectedSha256.length]), // proto: field 1 (selectedOptions), LEN
    selectedSha256,
  ]);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  return {
    encPayload: new Uint8Array(Buffer.concat([ciphertext, cipher.getAuthTag()])),
    encIv: new Uint8Array(iv),
  };
}

test("T94-C-H1 — decryptInboundPollVote recovers the selected option", async () => {
  const { decryptInboundPollVote } = (await import("../../src/ingest/poll-vote.ts")) as {
    decryptInboundPollVote: (
      message: unknown,
      pollMessage: unknown,
      meId: string,
    ) => { vote?: { selectedOptions?: Array<Uint8Array> } } | null;
  };
  const pollEncKey = randomBytes(32);
  const pollMsgId = "POLLMSG1";
  const creatorJid = "358497773518@s.whatsapp.net";
  const voterJid = "358400000077@s.whatsapp.net";
  const selected = createHash("sha256").update("Pizza").digest();
  const vote = encryptPollVote(pollEncKey, pollMsgId, creatorJid, voterJid, selected);
  const message = {
    key: { remoteJid: "120363428874442773@g.us", fromMe: false, id: "VOTE1", participant: voterJid },
    message: {
      pollUpdateMessage: {
        pollCreationMessageKey: { remoteJid: "120363428874442773@g.us", id: pollMsgId, fromMe: true },
        vote,
        senderTimestampMs: 1_760_000_000_000,
      },
    },
  };
  const pollMessage = {
    messageContextInfo: { messageSecret: pollEncKey },
  };
  const result = decryptInboundPollVote(message, pollMessage, creatorJid);
  expect(result).not.toBeNull();
  expect(Buffer.from(result?.vote?.selectedOptions?.[0] ?? new Uint8Array()).equals(selected)).toBe(
    true,
  );
  expect(result?.pollUpdateMessageKey?.participant).toBe(voterJid);
});

test("T94-C-H1 — a vote without a secret or key returns null instead of throwing", async () => {
  const { decryptInboundPollVote } = (await import("../../src/ingest/poll-vote.ts")) as {
    decryptInboundPollVote: (message: unknown, pollMessage: unknown, meId: string) => unknown;
  };
  expect(decryptInboundPollVote({ key: {}, message: { pollUpdateMessage: {} } }, {}, "x@s.whatsapp.net")).toBeNull();
  expect(decryptInboundPollVote({ key: {}, message: {} }, {}, "x@s.whatsapp.net")).toBeNull();
});
