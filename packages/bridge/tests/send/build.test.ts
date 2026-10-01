import { expect, test } from "vite-plus/test";
import { buildMediaMessage, buildTextMessage, type MediaKind } from "../../src/send/build.ts";

test("plain text builds a conversation content", async () => {
  const content = await buildTextMessage({ text: "hello" });
  expect(content.conversation).toBe("hello");
  expect(content.extendedTextMessage).toBeUndefined();
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
  expect(extended.canonicalUrl).toBe("https://example.com/page");
});

test("linkPreview off leaves no preview fields", async () => {
  const content = await buildTextMessage({ text: "plain", linkPreview: false });
  const extended = content.extendedTextMessage;
  if (!extended) throw new Error("expected extendedTextMessage content");
  expect(extended.matchedText).toBeUndefined();
  expect(extended.canonicalUrl).toBeUndefined();
});

test("media kinds map to their proto fields with metadata", async () => {
  const cases: Array<[MediaKind, string, Record<string, string | undefined>]> = [
    ["image", "imageMessage", { caption: "pic" }],
    ["video", "videoMessage", { caption: "clip", mimeType: "video/mp4" }],
    ["audio", "audioMessage", { mimeType: "audio/ogg" }],
    ["document", "documentMessage", { caption: "doc", fileName: "report.pdf", mimeType: "application/pdf" }],
    ["sticker", "stickerMessage", { mimeType: "image/webp" }],
  ];
  for (const [kind, field, meta] of cases) {
    const content = await buildMediaMessage({
      kind,
      caption: meta.caption,
      fileName: meta.fileName,
      mimeType: meta.mimeType,
    });
    const payload = (content as Record<string, Record<string, string | undefined> | undefined>)[field];
    if (!payload) throw new Error(`${field} missing for ${kind}`);
    expect(payload.caption, `${kind} caption`).toBe(meta.caption);
    expect(payload.mimetype, `${kind} mimetype`).toBe(meta.mimeType);
    expect(payload.fileName, `${kind} fileName`).toBe(meta.fileName);
  }
});
