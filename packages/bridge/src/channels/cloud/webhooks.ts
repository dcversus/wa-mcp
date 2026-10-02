import { createHmac, timingSafeEqual } from "node:crypto";
import type { ChannelEvent, NormalizedMessage } from "../types.ts";
import type { CloudChannelConfig } from "./config.ts";

/** Meta webhook GET verification: echo hub.challenge only when
 * hub.mode=subscribe and hub.verify_token match; null means 403. */
export function verifyWebhook(
  query: Record<string, string | undefined>,
  config: CloudChannelConfig,
): string | null {
  if (query["hub.mode"] !== "subscribe") {
    return null;
  }
  if (query["hub.verify_token"] !== config.verifyToken) {
    return null;
  }
  const challenge = query["hub.challenge"];
  return challenge === undefined ? null : challenge;
}

function signaturesMatch(
  received: string | undefined,
  body: string,
  config: CloudChannelConfig,
): boolean {
  if (received === undefined || !received.startsWith("sha256=")) {
    return false;
  }
  const expected = createHmac("sha256", config.appSecret).update(body).digest("hex");
  const receivedHex = received.slice("sha256=".length);
  const a = Buffer.from(receivedHex, "hex");
  const b = Buffer.from(expected, "hex");
  return a.length === b.length && timingSafeEqual(a, b);
}

interface MetaWebhookPayload {
  entry?: Array<{
    changes?: Array<{
      value?: {
        messages?: Array<{
          from?: string;
          id?: string;
          timestamp?: string;
          text?: { body?: string };
          type?: string;
        }>;
        statuses?: Array<{ id?: string; status?: string }>;
      };
    }>;
  }>;
}

/** Meta webhook POST: validate X-Hub-Signature-256 (HMAC-SHA256 of the raw
 * body with the app secret), then normalize messages/statuses to channel
 * events. Throws when the signature is missing or wrong. */
export function parseWebhookEvent(
  body: string,
  signature: string | undefined,
  config: CloudChannelConfig,
): ChannelEvent[] {
  if (!signaturesMatch(signature, body, config)) {
    throw new Error("webhook signature validation failed");
  }
  const payload = JSON.parse(body) as MetaWebhookPayload;
  const events: ChannelEvent[] = [];
  for (const entry of payload.entry ?? []) {
    for (const change of entry.changes ?? []) {
      const value = change.value ?? {};
      for (const message of value.messages ?? []) {
        const normalized: NormalizedMessage = {
          id: message.id ?? "",
          chatJid: `${message.from ?? ""}@s.whatsapp.net`,
          from: message.from ?? "",
          timestamp: Number(message.timestamp ?? 0),
          text: message.text?.body ?? null,
          isFromMe: false,
        };
        events.push({ type: "message", message: normalized });
      }
      for (const status of value.statuses ?? []) {
        if (status.id !== undefined) {
          events.push({ type: "status", messageId: status.id, status: status.status ?? "" });
        }
      }
    }
  }
  return events;
}
