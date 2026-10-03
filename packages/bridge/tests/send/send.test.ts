import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test, vi } from "vite-plus/test";
import type { WASocket } from "baileys";
import { openStore, type Store } from "../../src/store/schema.ts";
import { resolveLidJid, SendError, sendViaSocket } from "../../src/send/send.ts";
import { listMessages } from "../../src/store/queries.ts";

function fakeSocket(): { sock: WASocket; sendMessage: ReturnType<typeof vi.fn> } {
  const sendMessage = vi.fn(async (jid: string, content: unknown) => ({
    key: { remoteJid: jid, fromMe: true, id: "SENTID1" },
    // emulate the engine: {text} input → extendedTextMessage proto
    message:
      (content as { text?: string }).text !== undefined
        ? { extendedTextMessage: { text: (content as { text: string }).text } }
        : content,
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
  const result = await sendViaSocket(socket.sock, "+358 497 773 518", { text: "hi" });
  expect(result).toEqual({ messageId: "SENTID1", chatJid: "358497773518@s.whatsapp.net" });
  expect(socket.sendMessage).toHaveBeenCalledTimes(1);
  expect(socket.sendMessage).toHaveBeenCalledWith(
    "358497773518@s.whatsapp.net",
    expect.objectContaining({ text: "hi" }),
    undefined, // no quoted message — T54-era reply wiring passes it only when set
  );
});

test("persists the outbound row with is_from_me set", async () => {
  const store = freshStore();
  const socket = fakeSocket();
  await sendViaSocket(socket.sock, "358497773518@s.whatsapp.net", { text: "hi" }, { store });
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
    sendViaSocket(socket.sock, "358497773518@s.whatsapp.net", { text: "hi" }),
  ).rejects.toMatchObject({ code: "SENDS_DISABLED" });
  expect(socket.sendMessage).not.toHaveBeenCalled();
});

test("an unresolvable recipient fails as INVALID_JID before the socket", async () => {
  const socket = fakeSocket();
  await expect(sendViaSocket(socket.sock, "not-a-jid!", { text: "hi" })).rejects.toMatchObject({
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
  await expect(sendViaSocket(socket.sock, "garbage@@@", { text: "hi" })).rejects.toMatchObject({
    code: "INVALID_JID",
  });
  expect(socket.sendMessage).not.toHaveBeenCalled();
});

describe("T56 LID resolution", () => {
  function socketWithLidMapping(mapping: Record<string, string>): {
    socket: WASocket;
    sentJids: string[];
  } {
    const sentJids: string[] = [];
    const socket = {
      signalRepository: {
        lidMapping: {
          getLIDForPN: async (pn: string) => mapping[pn] ?? null, // engine-style: keyed by FULL pn jid
        },
      },
      sendMessage: async (jid: string) => {
        sentJids.push(jid);
        return { key: { remoteJid: jid, fromMe: true, id: `id-${jid}` } };
      },
    } as unknown as WASocket;
    return { socket, sentJids };
  }

  test("resolveLidJid maps a PN jid to its LID", async () => {
    const { socket } = socketWithLidMapping({
      "358497773518@s.whatsapp.net": "221900000001937@lid",
    });
    expect(await resolveLidJid(socket, "358497773518@s.whatsapp.net")).toBe("221900000001937@lid");
  });

  test("resolveLidJid passes through LIDs, groups and unmapped PNs", async () => {
    const { socket } = socketWithLidMapping({});
    expect(await resolveLidJid(socket, "221900000001937@lid")).toBe("221900000001937@lid");
    expect(await resolveLidJid(socket, "1@g.us")).toBe("1@g.us");
    expect(await resolveLidJid(socket, "1999@s.whatsapp.net")).toBe("1999@s.whatsapp.net");
  });

  test("sendViaSocket sends to the resolved LID but stores under the original chat", async () => {
    const store = openStore(mkdtempSync(join(tmpdir(), "wa-mcp-lid-")));
    const { socket, sentJids } = socketWithLidMapping({
      "358497773518@s.whatsapp.net": "221900000001937@lid",
    });
    const result = await sendViaSocket(
      socket,
      "358497773518@s.whatsapp.net",
      { text: "lid probe" },
      { store },
    );
    expect(sentJids).toEqual(["221900000001937@lid"]);
    expect(result.chatJid).toBe("358497773518@s.whatsapp.net");
    const rows = listMessages(store, { chatJid: "358497773518@s.whatsapp.net", limit: 5 });
    expect(rows.some((row) => row.id === "id-221900000001937@lid" && row.isFromMe)).toBe(true);
  });
});

describe("T59 full-jid mapping args (engine lid-mapping contract)", () => {
  // fork lid-mapping.js: getLIDsForPNsImpl skips any pn failing isPnUser
  // (endsWith '@s.whatsapp.net') — BARE users are silently dropped.
  function engineStyleSocket(map: Record<string, string>): {
    socket: WASocket;
    received: string[];
  } {
    const received: string[] = [];
    const socket = {
      signalRepository: {
        lidMapping: {
          getLIDForPN: async (pn: string) => {
            received.push(pn);
            return map[pn] ?? null;
          },
        },
      },
      sendMessage: async (jid: string) => {
        return { key: { remoteJid: jid, fromMe: true, id: `id-${jid}` } };
      },
    } as unknown as WASocket;
    return { socket, received };
  }

  test("resolveLidJid passes the FULL PN jid to getLIDForPN and returns the LID", async () => {
    const { socket, received } = engineStyleSocket({
      "358497773518@s.whatsapp.net": "221900000001937@lid",
    });
    expect(await resolveLidJid(socket, "358497773518@s.whatsapp.net")).toBe("221900000001937@lid");
    expect(received).toEqual(["358497773518@s.whatsapp.net"]);
  });

  test("resolveLidJid keeps the device suffix on the returned LID jid", async () => {
    const { socket } = engineStyleSocket({
      "358497773518:2@s.whatsapp.net": "221900000001937:0@lid",
    });
    expect(await resolveLidJid(socket, "358497773518:2@s.whatsapp.net")).toBe(
      "221900000001937:0@lid",
    );
  });
});
