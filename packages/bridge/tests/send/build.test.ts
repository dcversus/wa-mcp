import { describe, expect, test } from "vite-plus/test";
import { proto } from "baileys";
import {
  buildButtonsMessage,
  buildContactMessage,
  buildEditMessage,
  buildForwardMessage,
  buildListMessage,
  buildLocationMessage,
  buildMediaMessage,
  buildPollMessage,
  buildReactionMessage,
  buildTextMessage,
  BUTTONS_AND_LISTS_SENDING_IS_BUSINESS_ACCOUNT_ONLY,
  type MediaKind,
} from "../../src/send/build.ts";

test("plain text builds a conversation content", async () => {
  const content = await buildTextMessage({ text: "hello" });
  expect(content.conversation).toBe("hello");
  expect(content.extendedTextMessage).toBeNull();
});

test("mentions and quoted ids land in extendedTextMessage contextInfo", async () => {
  const content = await buildTextMessage({
    text: "hello @5511",
    mentions: ["5511@s.whatsapp.net"],
    quotedMessageId: "QID1",
  });
  const extended = content.extendedTextMessage;
  if (!extended) throw new Error("expected extendedTextMessage content");
  expect(extended.text).toBe("hello @5511");
  expect(extended.contextInfo?.mentionedJid).toEqual(["5511@s.whatsapp.net"]);
  expect(extended.contextInfo?.stanzaId).toBe("QID1");
});

test("linkPreview surfaces the matched url", async () => {
  const content = await buildTextMessage({
    text: "check https://example.com/page now",
    linkPreview: true,
  });
  const extended = content.extendedTextMessage;
  if (!extended) throw new Error("expected extendedTextMessage content");
  expect(extended.matchedText).toBe("https://example.com/page");
});

test("linkPreview off with plain text stays a conversation", async () => {
  const content = await buildTextMessage({ text: "plain", linkPreview: false });
  expect(content.conversation).toBe("plain");
  expect(content.extendedTextMessage).toBeNull();
});

test("media kinds map to their proto fields with metadata", async () => {
  const cases: Array<[MediaKind, string, Record<string, string | undefined>]> = [
    ["image", "imageMessage", { caption: "pic" }],
    ["video", "videoMessage", { caption: "clip", mimeType: "video/mp4" }],
    ["audio", "audioMessage", { mimeType: "audio/ogg" }],
    [
      "document",
      "documentMessage",
      { caption: "doc", fileName: "report.pdf", mimeType: "application/pdf" },
    ],
    ["sticker", "stickerMessage", { mimeType: "image/webp" }],
  ];
  for (const [kind, field, meta] of cases) {
    const content = buildMediaMessage({
      kind,
      caption: meta.caption,
      fileName: meta.fileName,
      mimeType: meta.mimeType,
    });
    const payload = (content as Record<string, Record<string, string | null> | null>)[field];
    if (!payload) throw new Error(`${field} missing for ${kind}`);
    expect(payload.caption ?? null, `${kind} caption`).toBe(meta.caption ?? null);
    expect(payload.mimetype, `${kind} mimetype`).toBe(meta.mimeType ?? null);
    expect(payload.fileName ?? null, `${kind} fileName`).toBe(meta.fileName ?? null);
  }
});

test("reaction carries target key and emote", async () => {
  const content = await buildReactionMessage("120363428874442773@g.us", "TARGET1", "👍");
  const reaction = content.reactionMessage;
  if (!reaction) throw new Error("expected reactionMessage");
  expect(reaction.text).toBe("👍");
  expect(reaction.key?.id).toBe("TARGET1");
  expect(reaction.key?.remoteJid).toBe("120363428874442773@g.us");
});

test("edit wraps the new text in a MESSAGE_EDIT protocol message", async () => {
  const content = buildEditMessage("120363428874442773@g.us", "TARGET1", "corrected text");
  const protocol = content.protocolMessage;
  if (!protocol) throw new Error("expected protocolMessage");
  expect(protocol.type).toBe(proto.Message.ProtocolMessage.Type.MESSAGE_EDIT);
  expect(protocol.key?.id).toBe("TARGET1");
  expect(protocol.key?.remoteJid).toBe("120363428874442773@g.us");
  expect(protocol.editedMessage?.conversation).toBe("corrected text");
});

test("forward keeps the original text and flags it", async () => {
  const original = {
    key: { remoteJid: "120363428874442773@g.us", fromMe: false, id: "ORIG1" },
    message: { conversation: "spread this" },
  } as never;
  const content = await buildForwardMessage(original);
  expect(content.conversation ?? content.extendedTextMessage?.text).toBe("spread this");
  const context = content.extendedTextMessage?.contextInfo;
  expect(context?.isForwarded).toBe(true);
  expect(context?.forwardingScore).toBeGreaterThan(0);
});

test("location carries coordinates and label", async () => {
  const content = await buildLocationMessage(60.17, 24.94, "Kallio");
  const location = content.locationMessage;
  if (!location) throw new Error("expected locationMessage");
  expect(location.degreesLatitude).toBe(60.17);
  expect(location.degreesLongitude).toBe(24.94);
  expect(location.name).toBe("Kallio");
});

test("contact builds a vcard with name and numbers", async () => {
  const content = buildContactMessage("John Doe", ["+15551234567", "+15559876543"]);
  const contact = content.contactMessage;
  if (!contact) throw new Error("expected contactMessage");
  expect(contact.displayName).toBe("John Doe");
  expect(contact.vcard).toContain("FN:John Doe");
  expect(contact.vcard).toContain("TEL:+15551234567");
  expect(contact.vcard).toContain("TEL:+15559876543");
});

test("poll uses the engine builder so the vote secret is generated", async () => {
  const content = await buildPollMessage("Lunch?", ["Pizza", "Burger"], 1);
  const poll = content.pollCreationMessageV3 ?? content.pollCreationMessage;
  if (!poll) throw new Error("expected pollCreationMessage(V3)");
  expect(poll.name).toBe("Lunch?");
  const labels = (poll.options ?? []).map((option) => option.optionName);
  expect(labels).toEqual(["Pizza", "Burger"]);
  expect(poll.selectableOptionsCount).toBe(1);
  const secret = content.messageContextInfo?.messageSecret;
  if (!secret) throw new Error("poll vote secret missing - votes would be undecryptable");
  expect(secret.length).toBe(32);
});

test("buttons and lists build proto shells for business-account delivery", async () => {
  const buttons = buildButtonsMessage("Choose", ["Yes", "No"], "footer");
  const buttonsMessage = buttons.buttonsMessage;
  if (!buttonsMessage) throw new Error("expected buttonsMessage");
  expect(buttonsMessage.contentText).toBe("Choose");
  expect(buttonsMessage.footerText).toBe("footer");
  expect((buttonsMessage.buttons ?? []).map((button) => button.buttonText?.displayText)).toEqual([
    "Yes",
    "No",
  ]);
  const list = buildListMessage("Menu", "Pick one", [
    { title: "Food", rows: [{ title: "Pizza", rowId: "r1" }] },
  ]);
  const listMessage = list.listMessage;
  if (!listMessage) throw new Error("expected listMessage");
  expect(listMessage.title).toBe("Menu");
  expect((listMessage.sections ?? [])[0]?.rows?.[0]?.title).toBe("Pizza");
  expect(BUTTONS_AND_LISTS_SENDING_IS_BUSINESS_ACCOUNT_ONLY).toBe(true);
});

describe("T84 line99 — poll validation", () => {
  test("fewer than two options is rejected", async () => {
    await expect(buildPollMessage("lunch", ["Pizza"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("at least 2"),
    });
  });

  test("more than twelve options is rejected", async () => {
    const options = Array.from({ length: 13 }, (_, i) => `opt ${i}`);
    await expect(buildPollMessage("lunch", options)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("at most 12"),
    });
  });

  test("duplicate options (case-insensitive) are rejected", async () => {
    await expect(buildPollMessage("lunch", ["Pizza", "pizza", "Burger"])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("duplicate"),
    });
  });

  test("empty-string options are rejected", async () => {
    await expect(buildPollMessage("lunch", ["Pizza", "   "])).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("non-empty"),
    });
  });
});

describe("T85 line95 — album container (engine truth: fork albumMessage)", () => {
  test("3 images build the albumMessage container", async () => {
    const msg = await buildAlbumMessage(3, 0);
    const album = (msg as { albumMessage?: { expectedImageCount?: number; expectedVideoCount?: number } })
      .albumMessage;
    expect(album?.expectedImageCount).toBe(3);
    expect(album?.expectedVideoCount).toBe(0);
  });

  test("2-10 image/video items only", async () => {
    await expect(buildAlbumMessage(1, 0)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("2"),
    });
    await expect(buildAlbumMessage(9, 2)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("10"),
    });
    await expect(buildAlbumMessage(2, 1)).rejects.toMatchObject({
      code: "VALIDATION_ERROR",
      message: expect.stringContaining("image"),
    });
  });
});
