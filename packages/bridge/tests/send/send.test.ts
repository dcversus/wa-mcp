import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import type { WASocket } from "@whiskeysockets/baileys";
import { openStore, type Store } from "../../src/store/schema.ts";
import { SendError, sendViaSocket } from "../../src/send/send.ts";

function fakeSocket(): { sock: WASocket; sendMessage: ReturnType<typeof vi.fn> } {
  const sendMessage = vi.fn(async (jid: string, content: unknown) => ({
    key: { remoteJid: jid, fromMe: false, id: "SENTID1" },
    message: content,
  }));
  return { sock: { sendMessage } as unknown as WASocket, sendMessage };
}

const openStores: Store[] = [];

function freshStore(): Store {
  const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-send-")));
  openStores.push(store);
  return store;
}

afterEach(async () => {
  delete process.env.WA_SENDS_DISABLED;
  for (const store of openStores.splice(0)) {
    store.close();
  }
});

test("sends via the socket to a normalized jid and returns the message id", async () => {
  const socket = fakeSocket();
  const result = await sendViaSocket(socket.sock, "+358 497 773 518", { conversation: "hi" });
  expect(result).toEqual({ messageId: "SENTID1", chatJid: "358497773518@s.whatsapp.net" });
  expect(socket.sendMessage).toHaveBeenCalledTimes(1);
  expect(socket.sendMessage).toHaveBeenCalledWith(
    "358497773518@s.whatsapp.net",
    expect.objectContaining({ conversation: "hi" }),
  );
});

test("persists the outbound row with is_from_me set", async () => {
  const store = freshStore();
  const socket = fakeSocket();
  await sendViaSocket(
    socket.sock,
    "358497773518@s.whatsapp.net",
    { conversation: "hi" },
    { store },
  );
  const row = store.db.prepare("SELECT * FROM messages").get() as Record<string, unknown>;
  expect(row.is_from_me).toBe(1);
  expect(row.is_unread).toBe(0);
  expect(row.content).toBe("hi");
  expect(row.chat_jid).toBe("358497773518@s.whatsapp.net");
});

test("WA_SENDS_DISABLED=1 refuses every send without touching the socket", async () => {
  process.env.WA_SENDS_DISABLED = "1";
  const socket = fakeSocket();
  await expect(
    sendViaSocket(socket.sock, "358497773518@s.whatsapp.net", { conversation: "hi" }),
  ).rejects.toMatchObject({ code: "SENDS_DISABLED" });
  expect(socket.sendMessage).not.toHaveBeenCalled();
});

test("an unresolvable recipient fails as INVALID_JID before the socket", async () => {
  const socket = fakeSocket();
  await expect(
    sendViaSocket(socket.sock, "not-a-jid!", { conversation: "hi" }),
  ).rejects.toMatchObject({
    code: "INVALID_JID",
  });
  expect(socket.sendMessage).not.toHaveBeenCalled();
});

test("SendError carries code and message", () => {
  const err = new SendError("SENDS_DISABLED", "blocked");
  expect(err).toBeInstanceOf(Error);
  expect(err.code).toBe("SENDS_DISABLED");
  expect(err.message).toBe("blocked");
});

test("an unparsable recipient with an at-sign fails as INVALID_JID before the socket", async () => {
  const socket = fakeSocket();
  await expect(
    sendViaSocket(socket.sock, "garbage@@@", { conversation: "hi" }),
  ).rejects.toMatchObject({
    code: "INVALID_JID",
  });
  expect(socket.sendMessage).not.toHaveBeenCalled();
});
