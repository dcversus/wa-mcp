import { createHmac } from "node:crypto";
import { expect, test } from "vite-plus/test";
import { parseWebhookEvent, verifyWebhook } from "../../src/channels/cloud/webhooks.ts";
import { readCloudConfig } from "../../src/channels/cloud/config.ts";

const CONFIG = readCloudConfig({
  WA_CLOUD_ACCESS_TOKEN: "t",
  WA_CLOUD_PHONE_NUMBER_ID: "109876543210987",
  WA_CLOUD_VERIFY_TOKEN: "verify-me",
  WA_CLOUD_APP_SECRET: "appsecret-hex",
}).config!;

function sign(body: string, secret = "appsecret-hex"): string {
  return `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;
}

const META_PAYLOAD = {
  object: "whatsapp_business_account",
  entry: [
    {
      id: "WABA-ID",
      changes: [
        {
          field: "messages",
          value: {
            messaging_product: "whatsapp",
            metadata: { display_phone_number: "1555", phone_number_id: "109876543210987" },
            contacts: [{ profile: { name: "Versus" }, wa_id: "15551234567" }],
            messages: [
              {
                from: "15551234567",
                id: "wamid.in1",
                timestamp: "1700000000",
                type: "text",
                text: { body: "hello" },
              },
            ],
          },
        },
      ],
    },
  ],
};

test("webhook GET verify echoes hub.challenge for the right verify token", () => {
  expect(
    verifyWebhook(
      { "hub.mode": "subscribe", "hub.verify_token": "verify-me", "hub.challenge": "CHAL1" },
      CONFIG,
    ),
  ).toBe("CHAL1");
});

test("webhook GET verify rejects a wrong verify token", () => {
  expect(
    verifyWebhook(
      { "hub.mode": "subscribe", "hub.verify_token": "wrong", "hub.challenge": "CHAL1" },
      CONFIG,
    ),
  ).toBeNull();
  expect(verifyWebhook({ "hub.challenge": "CHAL1" }, CONFIG)).toBeNull();
});

test("webhook POST with a valid X-Hub-Signature-256 yields normalized events", () => {
  const body = JSON.stringify(META_PAYLOAD);
  const events = parseWebhookEvent(body, sign(body), CONFIG);
  expect(events).toEqual([
    {
      type: "message",
      message: {
        id: "wamid.in1",
        chatJid: "15551234567@s.whatsapp.net",
        from: "15551234567",
        timestamp: 1700000000,
        text: "hello",
        isFromMe: false,
      },
    },
  ]);
});

test("webhook POST with a bad signature is rejected", () => {
  const body = JSON.stringify(META_PAYLOAD);
  expect(() => parseWebhookEvent(body, "sha256=deadbeef", CONFIG)).toThrow(/signature/);
  expect(() => parseWebhookEvent(body, sign(body, "wrong-secret"), CONFIG)).toThrow(/signature/);
  expect(() => parseWebhookEvent(body, undefined, CONFIG)).toThrow(/signature/);
});

test("webhook status payloads normalize to status events", () => {
  const payload = {
    object: "whatsapp_business_account",
    entry: [
      {
        changes: [
          {
            field: "messages",
            value: {
              statuses: [{ id: "wamid.out1", status: "delivered", recipient_id: "15551234567" }],
            },
          },
        ],
      },
    ],
  };
  const body = JSON.stringify(payload);
  const events = parseWebhookEvent(body, sign(body), CONFIG);
  expect(events).toEqual([{ type: "status", messageId: "wamid.out1", status: "delivered" }]);
});
