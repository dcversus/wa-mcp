import { describe, expect, test } from "vite-plus/test";
import pino from "pino";
import { proto } from "baileys";
import type { WAMessage } from "baileys";
import { extractContent } from "../../src/ingest/extract.ts";

function waMessage(content: proto.IMessage | null, overrides: Partial<WAMessage> = {}): WAMessage {
  return {
    key: { remoteJid: "358497773518@s.whatsapp.net", fromMe: false, id: "TESTID" },
    message: content,
    messageTimestamp: 1727812345,
    pushName: "Vasilisa",
    ...overrides,
  } as unknown as WAMessage;
}

test("conversation text extracts plainly", () => {
  const extracted = extractContent(waMessage({ conversation: "hello world" }));
  expect(extracted.text).toBe("hello world");
  expect(extracted.mediaType).toBeNull();
  expect(extracted.mentions).toEqual([]);
});

test("extended text keeps mentions from contextInfo", () => {
  const extracted = extractContent(
    waMessage({
      extendedTextMessage: {
        text: "ping @551199",
        contextInfo: { mentionedJid: ["551199@s.whatsapp.net"], stanzaId: "QUOTED1" },
      },
    }),
  );
  expect(extracted.text).toBe("ping @551199");
  expect(extracted.mentions).toEqual(["551199@s.whatsapp.net"]);
  expect(extracted.quotedMessageId).toBe("QUOTED1");
});

test("image falls back to caption and tags media type", () => {
  const extracted = extractContent(
    waMessage({ imageMessage: { caption: "look at this", url: "https://x" } }),
  );
  expect(extracted.mediaType).toBe("image");
  expect(extracted.text).toBe("look at this");
});

test("media without captions yields null text", () => {
  for (const content of [
    { videoMessage: { url: "https://v" } },
    { audioMessage: { url: "https://a" } },
    { stickerMessage: { url: "https://s" } },
  ]) {
    const extracted = extractContent(waMessage(content));
    expect(extracted.text).toBeNull();
  }
  expect(extractContent(waMessage({ videoMessage: { url: "https://v" } })).mediaType).toBe("video");
  expect(extractContent(waMessage({ audioMessage: { url: "https://a" } })).mediaType).toBe("audio");
  expect(extractContent(waMessage({ stickerMessage: { url: "https://s" } })).mediaType).toBe(
    "sticker",
  );
});

test("documents prefer caption over title", () => {
  const extracted = extractContent(
    waMessage({
      documentMessage: { title: "report.pdf", caption: "the report", url: "https://d" },
    }),
  );
  expect(extracted.mediaType).toBe("document");
  expect(extracted.text).toBe("the report");
});

test("documentWithCaption unwraps to a document", () => {
  const extracted = extractContent(
    waMessage({
      documentWithCaptionMessage: { message: { documentMessage: { caption: "cap doc" } } },
    }),
  );
  expect(extracted.mediaType).toBe("document");
  expect(extracted.text).toBe("cap doc");
});

test("reactions carry emote and target", () => {
  const extracted = extractContent(
    waMessage({ reactionMessage: { key: { id: "TARGET1", remoteJid: "x" }, text: "👍" } }),
  );
  expect(extracted.reaction).toBe("👍");
  expect(extracted.reactionTargetId).toBe("TARGET1");
  expect(extracted.text).toBe("👍");
});

test("polls extract name and option labels", () => {
  const extracted = extractContent(
    waMessage({
      pollCreationMessage: {
        name: "Lunch?",
        options: [{ optionName: "Pizza" }, { optionName: "Burger" }],
      },
    }),
  );
  expect(extracted.poll).toEqual({ name: "Lunch?", options: ["Pizza", "Burger"] });
  expect(extracted.text).toBe("Lunch?");
});

test("poll votes arrive as selections on the poll message update", () => {
  const hash = Uint8Array.from([0xaa, 0xbb]);
  const pollMessage = waMessage(
    {
      pollCreationMessage: {
        name: "Lunch?",
        options: [{ optionName: "Pizza" }, { optionName: "Burger" }],
      },
    },
    { key: { remoteJid: "g", fromMe: false, id: "POLL1" } },
  );
  const extracted = extractContent(pollMessage, [
    {
      pollUpdateMessageKey: { id: "VOTERMSG", remoteJid: "g" },
      vote: { selectedOptions: [hash] },
      senderTimestampMs: 1,
    },
  ]);
  expect(extracted.pollVote).toEqual({ targetMessageId: "POLL1", selections: ["aabb"] });
});

test("an undecrypted poll update still names its target", () => {
  const extracted = extractContent(
    waMessage({ pollUpdateMessage: { pollCreationMessageKey: { id: "POLL1", remoteJid: "g" } } }),
  );
  expect(extracted.pollVote).toEqual({ targetMessageId: "POLL1", selections: [] });
});

test("edits carry target id and the edited text", () => {
  const extracted = extractContent(
    waMessage({
      protocolMessage: {
        type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
        key: { id: "EDITED1", remoteJid: "x" },
        editedMessage: { extendedTextMessage: { text: "v2 text" } },
      },
    }),
  );
  expect(extracted.editedMessageId).toBe("EDITED1");
  expect(extracted.editedText).toBe("v2 text");
  expect(extracted.text).toBe("v2 text");
});

test("revokes carry the revoked target id and no text", () => {
  const extracted = extractContent(
    waMessage({
      protocolMessage: {
        type: proto.Message.ProtocolMessage.Type.REVOKE,
        key: { id: "GONE1", remoteJid: "x" },
      },
    }),
  );
  expect(extracted.revokedMessageId).toBe("GONE1");
  expect(extracted.text).toBeNull();
});

test("locations extract coordinates and label", () => {
  const named = extractContent(
    waMessage({
      locationMessage: { degreesLatitude: 60.17, degreesLongitude: 24.94, name: "Kallio" },
    }),
  );
  expect(named.mediaType).toBe("location");
  expect(named.text).toBe("Kallio (60.17, 24.94)");
  const bare = extractContent(
    waMessage({ locationMessage: { degreesLatitude: 60.17, degreesLongitude: 24.94 } }),
  );
  expect(bare.text).toBe("60.17, 24.94");
});

test("vcards extract display name and phone numbers", () => {
  const extracted = extractContent(
    waMessage({
      contactMessage: {
        displayName: "John Doe",
        vcard: "BEGIN:VCARD\nVERSION:3.0\nFN:John Doe\nTEL;TYPE=CELL:+15551234567\nEND:VCARD",
      },
    }),
  );
  expect(extracted.mediaType).toBe("contact");
  expect(extracted.text).toBe("John Doe: +15551234567");
});

test("buttons extract content, labels and footer", () => {
  const extracted = extractContent(
    waMessage({
      buttonsMessage: {
        contentText: "Choose one",
        footerText: "footer here",
        buttons: [{ buttonId: "b1", buttonText: { displayText: "Yes" } }],
      },
    }),
  );
  expect(extracted.text).toBe("Choose one [Yes] footer here");
});

test("lists extract title, description and row titles", () => {
  const extracted = extractContent(
    waMessage({
      listMessage: {
        title: "Menu",
        description: "Pick an item",
        sections: [
          {
            title: "Food",
            rows: [
              { title: "Pizza", rowId: "r1" },
              { title: "Burger", rowId: "r2" },
            ],
          },
        ],
      },
    }),
  );
  expect(extracted.text).toBe("Menu — Pick an item [Food: Pizza | Burger]");
});

test("templates extract hydrated content and button labels", () => {
  const extracted = extractContent(
    waMessage({
      templateMessage: {
        hydratedTemplate: {
          hydratedContentText: "Your order shipped",
          hydratedButtons: [{ quickReplyButton: { displayText: "Track" } }],
        },
      },
    }),
  );
  expect(extracted.text).toBe("Your order shipped [Track]");
});

test("view-once unwraps and flags, caption still readable", () => {
  const extracted = extractContent(
    waMessage({ viewOnceMessageV2: { message: { imageMessage: { caption: "one look only" } } } }),
  );
  expect(extracted.isViewOnce).toBe(true);
  expect(extracted.mediaType).toBe("image");
  expect(extracted.text).toBe("one look only");
});

test("view-once media without caption gets a placeholder", () => {
  const extracted = extractContent(
    waMessage({ viewOnceMessageV2: { message: { imageMessage: {} } } }),
  );
  expect(extracted.isViewOnce).toBe(true);
  expect(extracted.text).toBe("[view-once image]");
});

test("ephemeral wrapper unwraps and flags", () => {
  const extracted = extractContent(
    waMessage({ ephemeralMessage: { message: { conversation: "vanishing" } } }),
  );
  expect(extracted.isEphemeral).toBe(true);
  expect(extracted.text).toBe("vanishing");
});

test("ephemeral protocol setting flags without text", () => {
  const extracted = extractContent(
    waMessage({
      protocolMessage: {
        type: proto.Message.ProtocolMessage.Type.EPHEMERAL_SETTING,
        ephemeralExpiration: 604800,
      },
    }),
  );
  expect(extracted.isEphemeral).toBe(true);
  expect(extracted.text).toBeNull();
});

test("status mention protocol flags isStatusMention", () => {
  const extracted = extractContent(
    waMessage({
      protocolMessage: { type: proto.Message.ProtocolMessage.Type.STATUS_MENTION_MESSAGE },
    }),
  );
  expect(extracted.isStatusMention).toBe(true);
});

test("a null message extracts to empty defaults", () => {
  const extracted = extractContent(waMessage(null));
  expect(extracted.text).toBeNull();
  expect(extracted.mediaType).toBeNull();
  expect(extracted.mentions).toEqual([]);
  expect(extracted.isEphemeral).toBe(false);
  expect(extracted.isViewOnce).toBe(false);
  expect(extracted.isStatusMention).toBe(false);
});

describe("T58 engine-generated send shapes", () => {
  // The engine generates these protos from AnyMessageContent — the exact
  // shapes socket.sendMessage returns in sent.message after a live send.
  async function engineGenerate(input: Record<string, unknown>) {
    const { generateWAMessageContent } = await import("baileys");
    return (await generateWAMessageContent(input, {
      logger: pino({ level: "silent" }),
    })) as proto.IMessage;
  }

  test("engine-generated single-select poll (V3 key) extracts name + options", async () => {
    const content = await engineGenerate({
      poll: { name: "Lunch?", values: ["a", "b"], selectableCount: 1 },
    });
    expect(content.pollCreationMessageV3).toBeDefined();
    const extracted = extractContent({
      key: { remoteJid: "1@g.us", fromMe: true, id: "POLLOTHER" },
      message: content,
      messageTimestamp: 1_760_000_000,
    } as WAMessage);
    expect(extracted.poll).not.toBeNull();
    expect(extracted.poll?.question).toBe("Lunch?");
    expect(extracted.poll?.options).toEqual(["a", "b"]);
  });

  test("engine-generated multi-select poll (base key) extracts too", async () => {
    const content = await engineGenerate({
      poll: { name: "Colors", values: ["red", "blue"], selectableCount: 0 },
    });
    expect(content.pollCreationMessage).toBeDefined();
    const extracted = extractContent({
      key: { remoteJid: "1@g.us", fromMe: true, id: "POLLOTHER2" },
      message: content,
      messageTimestamp: 1_760_000_000,
    } as WAMessage);
    expect(extracted.poll?.question).toBe("Colors");
  });

  test("engine-generated edit wraps text as extendedTextMessage", async () => {
    const content = await engineGenerate({
      edit: { remoteJid: "1@s.whatsapp.net", id: "TARGET7", fromMe: true },
      text: "corrected text",
    });
    const extracted = extractContent({
      key: { remoteJid: "1@s.whatsapp.net", fromMe: true, id: "EDITNEW" },
      message: content,
      messageTimestamp: 1_760_000_000,
    } as WAMessage);
    expect(extracted.editedMessageId).toBe("TARGET7");
    expect(extracted.editedText).toBe("corrected text");
  });
});

describe("T58 poll storage", () => {
  test("storeMessage writes content + poll_options rows for an engine poll", async () => {
    const { openStore } = await import("../src/store/schema.ts");
    const { storeMessage } = await import("../src/store/messages.ts");
    const store = openStore((await import("node:fs")).mkdtempSync("/tmp/wa-mcp-pollopt-"));
    const content = await engineGenerate({
      poll: { name: "Lunch?", values: ["Ramen", "Pizza"], selectableCount: 1 },
    });
    const stored = storeMessage(store, {
      key: { remoteJid: "1@g.us", fromMe: true, id: "POLLOPTIONS1" },
      message: content,
      messageTimestamp: 1_760_000_000,
      pushName: "V",
    } as WAMessage);
    expect(stored).toBe(true);
    const row = store.db
      .prepare("SELECT content FROM messages WHERE chat_jid = ? AND id = ?")
      .get("1@g.us", "POLLOPTIONS1") as { content: string };
    expect(row.content).toBe("Lunch?");
    const options = store.db
      .prepare("SELECT idx, label FROM poll_options WHERE chat_jid = ? AND message_id = ? ORDER BY idx")
      .all("1@g.us", "POLLOPTIONS1") as Array<{ idx: number; label: string }>;
    expect(options.map((option) => option.label)).toEqual(["Ramen", "Pizza"]);
  });
});
