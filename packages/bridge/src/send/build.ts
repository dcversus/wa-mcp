import { proto } from "@whiskeysockets/baileys";
import { extractUrlFromText } from "@whiskeysockets/baileys";

export interface TextMessageInput {
  text: string;
  mentions?: string[];
  quotedMessageId?: string;
  linkPreview?: boolean;
}

export type MediaKind = "image" | "video" | "audio" | "document" | "sticker";

export interface MediaMessageInput {
  kind: MediaKind;
  caption?: string;
  fileName?: string;
  mimeType?: string;
}

const MEDIA_FIELD: Record<MediaKind, keyof proto.IMessage> = {
  image: "imageMessage",
  video: "videoMessage",
  audio: "audioMessage",
  document: "documentMessage",
  sticker: "stickerMessage",
};

export async function buildTextMessage(input: TextMessageInput): Promise<proto.IMessage> {
  const hasContext =
    (input.mentions !== undefined && input.mentions.length > 0) ||
    input.quotedMessageId !== undefined ||
    input.linkPreview === true;
  if (!hasContext) {
    return proto.Message.fromObject({ conversation: input.text });
  }
  const contextInfo: proto.IContextInfo = {};
  if (input.mentions !== undefined && input.mentions.length > 0) {
    contextInfo.mentionedJid = [...input.mentions];
  }
  if (input.quotedMessageId !== undefined) {
    contextInfo.stanzaId = input.quotedMessageId;
  }
  const extended: proto.Message.IExtendedTextMessage = {
    text: input.text,
    contextInfo,
  };
  if (input.linkPreview === true) {
    const url = extractUrlFromText(input.text);
    if (url !== undefined) {
      extended.matchedText = url;
    }
  }
  return proto.Message.fromObject({ extendedTextMessage: extended });
}

export function buildMediaMessage(input: MediaMessageInput): proto.IMessage {
  const media: Record<string, string> = {};
  if (input.caption !== undefined) {
    media.caption = input.caption;
  }
  if (input.mimeType !== undefined) {
    media.mimetype = input.mimeType;
  }
  if (input.fileName !== undefined) {
    media.fileName = input.fileName;
  }
  return proto.Message.fromObject({ [MEDIA_FIELD[input.kind]]: media });
}
