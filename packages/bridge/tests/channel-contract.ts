/** Identical contract suite every ChannelAdapter must satisfy (GOAL §18):
 * the same store feeds both channels, so reads must normalize identically;
 * only the transport (send/events/media/pair) differs.
 * NOTE: template sending is a Cloud API capability (§18); baileys templates
 * are OUT-OF-SCOPE 0.9 — that contract lives in the cloud-only suite. */
import { expect, test } from "vite-plus/test";
import type { ChannelAdapter } from "../src/channels/types.ts";

export interface ChannelFixture {
  adapter: ChannelAdapter;
  /** the raw body the transport's last outbound POST/GET carried (cloud: JSON;
   * baileys: the built proto payload serialized for inspection) */
  lastOutbound(): unknown;
  /** push a provider-side inbound message into the adapter */
  emitInbound(message: {
    id: string;
    from: string;
    text: string;
    timestamp?: number;
  }): void;
}

export function channelContractSuite(label: string, make: () => ChannelFixture): void {
  test(`[${label}] sendMessage(text) returns a receipt with the provider id and isFromMe`, async () => {
    const f = make();
    const receipt = await f.adapter.sendMessage({ kind: "text", to: "15551234567", body: "hi" });
    expect(receipt.id.length).toBeGreaterThan(0);
    expect(receipt.isFromMe).toBe(true);
    expect(receipt.channel).toBe(f.adapter.channel);
  });

  test(`[${label}] markRead resolves for message ids`, async () => {
    const f = make();
    await expect(f.adapter.markRead("chat", ["wamid.1"])).resolves.toBeUndefined();
  });

  test(`[${label}] downloadMedia returns the provider bytes`, async () => {
    const f = make();
    const bytes = await f.adapter.downloadMedia("https://media.example/v1/file");
    expect(bytes.length).toBeGreaterThan(0);
  });

  test(`[${label}] checkContact reports registration truthfully`, async () => {
    const f = make();
    const known = await f.adapter.checkContact("15551234567");
    const unknown = await f.adapter.checkContact("10000000000");
    expect(known.registered).toBe(true);
    expect(unknown.registered).toBe(false);
  });

  test(`[${label}] fetchChats + fetchHistory read the shared store identically`, async () => {
    const f = make();
    const chats = await f.adapter.fetchChats();
    expect(chats[0]).toMatchObject({ jid: "15551234567@s.whatsapp.net", name: "Store Chat" });
    const page = await f.adapter.fetchHistory("15551234567@s.whatsapp.net");
    expect(page.messages[0]).toMatchObject({ id: "store-1", isFromMe: false });
  });

  test(`[${label}] inbound provider messages reach subscribers normalized`, async () => {
    const f = make();
    const seen: Array<{ id: string; from: string; text: string }> = [];
    const unsubscribe = f.adapter.events().subscribe((event) => {
      if (event.type === "message") {
        seen.push({ id: event.message.id, from: event.message.from, text: event.message.text ?? "" });
      }
    });
    f.emitInbound({ id: "wamid.in1", from: "15551234567", text: "hello" });
    expect(seen).toEqual([{ id: "wamid.in1", from: "15551234567", text: "hello" }]);
    unsubscribe();
  });
}
