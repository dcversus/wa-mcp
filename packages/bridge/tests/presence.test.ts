import { expect, test, vi } from "vite-plus/test";
import type { WASocket } from "@whiskeysockets/baileys";
import { PRESENCE_TYPES, sendPresenceUpdate, sendReadReceipt, sendTyping } from "../src/presence.ts";

function fakeSocket() {
  const readMessages = vi.fn(async () => {});
  const sendPresenceUpdate = vi.fn(async () => {});
  return {
    sock: { readMessages, sendPresenceUpdate } as unknown as WASocket,
    readMessages,
    sendPresenceUpdate,
  };
}

test("presence types match the engine set", () => {
  expect([...PRESENCE_TYPES].sort()).toEqual(
    ["available", "composing", "paused", "recording", "unavailable"].sort(),
  );
});

test("sendReadReceipt builds keys from chat jid and message ids", async () => {
  const { sock, readMessages } = fakeSocket();
  await sendReadReceipt(sock, "120363428874442773@g.us", ["M1", "M2"]);
  expect(readMessages).toHaveBeenCalledTimes(1);
  const keys = readMessages.mock.calls[0]?.[0] as Array<{ remoteJid: string; id: string }>;
  expect(keys).toEqual([
    { remoteJid: "120363428874442773@g.us", id: "M1" },
    { remoteJid: "120363428874442773@g.us", id: "M2" },
  ]);
});

test("sendPresenceUpdate passes the engine type and chat jid", async () => {
  const { sock, sendPresenceUpdate } = fakeSocket();
  await sendPresenceUpdate(sock, "120363428874442773@g.us", "composing");
  expect(sendPresenceUpdate).toHaveBeenCalledWith("composing", "120363428874442773@g.us");
});

test("sendTyping is composing presence", async () => {
  const { sock, sendPresenceUpdate } = fakeSocket();
  await sendTyping(sock, "358497773518@s.whatsapp.net");
  expect(sendPresenceUpdate).toHaveBeenCalledWith("composing", "358497773518@s.whatsapp.net");
});
