import { expect, test } from "vite-plus/test";
import { channelContractSuite, type ChannelFixture } from "../channel-contract.ts";
import { CloudApiAdapter } from "../../src/channels/cloud/adapter.ts";
import { readCloudConfig } from "../../src/channels/cloud/config.ts";

const CONFIG = readCloudConfig({
  WA_CLOUD_ACCESS_TOKEN: "EAAG-test-token",
  WA_CLOUD_PHONE_NUMBER_ID: "109876543210987",
  WA_CLOUD_VERIFY_TOKEN: "verify-me",
  WA_CLOUD_APP_SECRET: "appsecret-hex",
});

let lastBody: unknown;
function makeCloud(): ChannelFixture {
  lastBody = undefined;
  const adapter = new CloudApiAdapter(CONFIG.config!, {
    readModel: {
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
    },
    fetchFn: (async (url: string | URL, init?: RequestInit) => {
      const urlText = String(url);
      if (init?.body !== undefined) {
        lastBody = JSON.parse(typeof init.body === "string" ? init.body : "{}");
      }
      if (urlText.endsWith("/messages") && init?.method === "POST") {
        return new Response(JSON.stringify({ messages: [{ id: "wamid.out1" }] }), { status: 200 });
      }
      if (urlText.includes("/contacts")) {
        const rawBody = typeof init?.body === "string" ? init.body : "{}";
        const body = JSON.parse(rawBody) as { contacts: string[] };
        return new Response(
          JSON.stringify({
            contacts: body.contacts.map((input) => ({
              input,
              wa_id: input,
              status: input === "15551234567" ? "valid" : "invalid",
            })),
          }),
          { status: 200 },
        );
      }
      return new Response(Buffer.from([1, 2, 3, 4]), { status: 200 });
    }) as unknown as typeof fetch,
  });
  return {
    adapter,
    lastOutbound: () => lastBody,
    emitInbound: (m) => adapter.ingestWebhookMessage(m),
  };
}

channelContractSuite("cloud", makeCloud);

test("[cloud] sendMessage(template) carries template name, language and vars (Meta-native)", async () => {
  const f = makeCloud();
  await f.adapter.sendMessage({
    kind: "template",
    to: "15551234567",
    template: "order_update",
    language: "en_US",
    vars: ["VAL1", "VAL2"],
  });
  const body = JSON.stringify(f.lastOutbound());
  expect(body).toContain("order_update");
  expect(body).toContain("en_US");
  expect(body).toContain("VAL1");
});

test("[cloud] sends text via the Meta graph endpoint with bearer auth", async () => {
  let seenUrl = "";
  let seenAuth = "";
  const adapter = new CloudApiAdapter(CONFIG.config!, {
    readModel: {
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
    },
    fetchFn: (async (url: string | URL, init?: RequestInit) => {
      seenUrl = String(url);
      seenAuth = String((init?.headers as Record<string, string>)?.authorization ?? "");
      return new Response(JSON.stringify({ messages: [{ id: "wamid.1" }] }), { status: 200 });
    }) as unknown as typeof fetch,
  });
  await adapter.sendMessage({ kind: "text", to: "15551234567", body: "hello" });
  expect(seenUrl).toBe("https://graph.facebook.com/v22.0/109876543210987/messages");
  expect(seenAuth).toBe("Bearer EAAG-test-token");
});
