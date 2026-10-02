import { expect, test } from "vite-plus/test";
import { channelContractSuite, type ChannelFixture } from "../channel-contract.ts";
import { BaileysAdapter } from "../../src/channels/baileys/adapter.ts";

function makeBaileys(): ChannelFixture {
  let lastBody: unknown;
  const inboundSubscribers = new Set<(m: { id: string; from: string; text: string }) => void>();
  const readModel = {
    fetchChats: async () => [
      { jid: "15551234567@s.whatsapp.net", name: "Store Chat", lastTimestamp: 1 },
    ],
    fetchHistory: async () => ({
      messages: [
        {
          id: "store-1",
          chatJid: "15551234567@s.whatsapp.net",
          from: "15551234567",
          timestamp: 1,
          text: "stored",
          isFromMe: false,
        },
      ],
      nextCursor: null,
    }),
  };
  const adapter = new BaileysAdapter(
    {
      hasPairedAccount: () => true,
      sendText: async (to: string, body: string) => {
        lastBody = { to, body };
        return { id: "BAILEYS-1", isFromMe: true as const };
      },
      markRead: async () => {},
      downloadMedia: async () => new Uint8Array([9, 9]),
      checkContact: async (phone: string) => ({ registered: phone === "15551234567" }),
      onInbound: (fn) => {
        inboundSubscribers.add(fn);
      },
    },
    readModel,
  );
  return {
    adapter,
    lastOutbound: () => lastBody,
    emitInbound: (m) => {
      for (const fn of inboundSubscribers) {
        fn(m);
      }
    },
  };
}

channelContractSuite("baileys", makeBaileys);

test("[baileys] reports the baileys channel name", () => {
  expect(makeBaileys().adapter.channel).toBe("baileys");
});
