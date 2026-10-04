import { proto } from "baileys";
import { SendError } from "./send.ts";
import {
  extractUrlFromText,
  generateForwardMessageContent,
  generateWAMessageContent,
} from "baileys";
import type { AnyMessageContent, WAMediaUploadFunction, WAMessage } from "baileys";
import pino from "pino";

export interface TextMessageInput {
  text: string;
  mentions?: string[];
  quotedMessageId?: string;
  linkPreview?: boolean;
}

export type MediaKind = "image" | "video" | "audio" | "document" | "sticker";

export const BUTTONS_AND_LISTS_SENDING_IS_BUSINESS_ACCOUNT_ONLY = true;

const GENERATION_OPTIONS = {
  logger: pino({ level: "silent" }),
  upload: (async () => {
    throw new Error("no media upload expected for this message kind");
  }) as unknown as WAMediaUploadFunction,
};

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

export async function buildReactionMessage(
  chatJid: string,
  targetMessageId: string,
  emote: string,
): Promise<proto.IMessage> {
  const react: proto.Message.IReactionMessage = {
    key: { remoteJid: chatJid, id: targetMessageId, fromMe: false },
    text: emote,
  };
  return generateWAMessageContent({ react } as AnyMessageContent, GENERATION_OPTIONS);
}

export function buildEditMessage(
  chatJid: string,
  targetMessageId: string,
  newText: string,
): proto.IMessage {
  return proto.Message.fromObject({
    protocolMessage: {
      key: { remoteJid: chatJid, id: targetMessageId, fromMe: true },
      type: proto.Message.ProtocolMessage.Type.MESSAGE_EDIT,
      editedMessage: { conversation: newText },
    },
  });
}

export async function buildForwardMessage(original: WAMessage): Promise<proto.IMessage> {
  return generateForwardMessageContent(original, false);
}

export async function buildLocationMessage(
  latitude: number,
  longitude: number,
  label?: string,
): Promise<proto.IMessage> {
  const location: NonNullable<Extract<AnyMessageContent, { location: unknown }>["location"]> = {
    degreesLatitude: latitude,
    degreesLongitude: longitude,
  };
  if (label !== undefined) {
    location.name = label;
  }
  return generateWAMessageContent({ location } as AnyMessageContent, GENERATION_OPTIONS);
}

export function buildVcard(name: string, phones: string[]): string {
  const lines = ["BEGIN:VCARD", "VERSION:3.0", `FN:${name}`];
  for (const phone of phones) {
    lines.push(`TEL:${phone}`);
  }
  lines.push("END:VCARD");
  return lines.join("\n");
}

export function buildContactMessage(displayName: string, phones: string[]): proto.IMessage {
  return proto.Message.fromObject({
    contactMessage: { displayName, vcard: buildVcard(displayName, phones) },
  });
}

export async function buildPollMessage(
  name: string,
  options: string[],
  selectableCount?: number,
): Promise<proto.IMessage> {
  // T84 line99: WhatsApp poll rules — 2..12 options, unique per case, non-empty
  if (options.length < 2) {
    throw new SendError("VALIDATION_ERROR", "a poll needs at least 2 options");
  }
  if (options.length > 12) {
    throw new SendError("VALIDATION_ERROR", "a poll allows at most 12 options");
  }
  if (options.some((option) => option.trim().length === 0)) {
    throw new SendError("VALIDATION_ERROR", "poll options must be non-empty");
  }
  const seen = new Set<string>();
  for (const option of options) {
    const key = option.toLowerCase();
    if (seen.has(key)) {
      throw new SendError(
        "VALIDATION_ERROR",
        `duplicate poll option (case-insensitive): ${option}`,
      );
    }
    seen.add(key);
  }
  return generateWAMessageContent(
    {
      poll: { name, values: options, selectableCount: selectableCount ?? options.length - 1 },
    } as AnyMessageContent,
    GENERATION_OPTIONS,
  );
}

export interface ListSectionInput {
  title: string;
  rows: Array<{ title: string; rowId: string; description?: string }>;
}

export function buildButtonsMessage(
  contentText: string,
  buttonLabels: string[],
  footerText?: string,
): proto.IMessage {
  return proto.Message.fromObject({
    buttonsMessage: {
      contentText,
      footerText,
      buttons: buttonLabels.map((label, index) => ({
        buttonId: `btn_${index}`,
        buttonText: { displayText: label },
      })),
    },
  });
}

export function buildListMessage(
  title: string,
  description: string,
  sections: ListSectionInput[],
): proto.IMessage {
  return proto.Message.fromObject({
    listMessage: {
      title,
      description,
      buttonText: "Choose",
      listType: proto.Message.ListMessage.ListType.SINGLE_SELECT,
      sections: sections.map((section) => ({
        title: section.title,
        rows: section.rows.map((row) => ({
          title: row.title,
          rowId: row.rowId,
          description: row.description,
        })),
      })),
    },
  });
}
