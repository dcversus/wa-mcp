import { proto } from "@whiskeysockets/baileys";
import type { WAMessage } from "@whiskeysockets/baileys";

export interface ExtractedPoll {
  name: string;
  options: string[];
}

export interface ExtractedPollVote {
  targetMessageId: string | null;
  selections: string[];
}

export interface ExtractedContent {
  text: string | null;
  mediaType: string | null;
  mentions: string[];
  quotedMessageId: string | null;
  reaction: string | null;
  reactionTargetId: string | null;
  editedMessageId: string | null;
  editedText: string | null;
  revokedMessageId: string | null;
  poll: ExtractedPoll | null;
  pollVote: ExtractedPollVote | null;
  isEphemeral: boolean;
  isViewOnce: boolean;
  isStatusMention: boolean;
}

const REVOKE = proto.Message.ProtocolMessage.Type.REVOKE;
const MESSAGE_EDIT = proto.Message.ProtocolMessage.Type.MESSAGE_EDIT;
const EPHEMERAL_SETTING = proto.Message.ProtocolMessage.Type.EPHEMERAL_SETTING;
const STATUS_MENTION = proto.Message.ProtocolMessage.Type.STATUS_MENTION_MESSAGE;

type Content = proto.IMessage;

export interface IncomingPollUpdate {
  pollUpdateMessageKey?: proto.IMessageKey | null;
  vote?: { selectedOptions?: (Uint8Array | null)[] | null } | null;
  senderTimestampMs?: number | null;
}

export type ExtractInput = WAMessage;

function unwrapLayers(content: Content | null | undefined): {
  content: Content | null;
  viewOnce: boolean;
  ephemeral: boolean;
} {
  let current: Content | null = content ?? null;
  let viewOnce = false;
  let ephemeral = false;
  for (let depth = 0; depth < 5 && current !== null; depth += 1) {
    const inner =
      current.viewOnceMessage?.message ??
      current.viewOnceMessageV2?.message ??
      current.viewOnceMessageV2Extension?.message;
    if (inner) {
      viewOnce = true;
      current = inner;
      continue;
    }
    const ephemeralInner = current.ephemeralMessage?.message;
    if (ephemeralInner) {
      ephemeral = true;
      current = ephemeralInner;
      continue;
    }
    const doc = current.documentWithCaptionMessage?.message?.documentMessage;
    if (doc) {
      current = { documentMessage: doc };
      continue;
    }
    break;
  }
  return { content: current, viewOnce, ephemeral };
}

function parseVcard(vcard: string): { name: string | null; numbers: string[] } {
  let name: string | null = null;
  const numbers: string[] = [];
  for (const line of vcard.split("\n")) {
    const [key, value = ""] = line.split(":");
    const cleanValue = value.trim();
    if (!key || cleanValue.length === 0) {
      continue;
    }
    if (key.startsWith("FN") && name === null) {
      name = cleanValue;
    } else if (key.startsWith("TEL")) {
      numbers.push(cleanValue);
    }
  }
  return { name, numbers };
}

function buttonLabels(
  buttons: proto.Message.ButtonsMessage.IButton[] | null | undefined,
): string[] {
  return (buttons ?? [])
    .map((button) => button.buttonText?.displayText)
    .filter((label): label is string => typeof label === "string");
}

function hydratedButtonLabels(
  buttons: proto.IHydratedTemplateButton[] | null | undefined,
): string[] {
  return (buttons ?? [])
    .map(
      (button) =>
        button.quickReplyButton?.displayText ??
        button.urlButton?.displayText ??
        button.callButton?.displayText,
    )
    .filter((label): label is string => typeof label === "string");
}

function templateOf(
  message: proto.Message.ITemplateMessage,
): proto.Message.TemplateMessage.IHydratedFourRowTemplate | null {
  return message.hydratedTemplate ?? message.hydratedFourRowTemplate ?? null;
}

function listSectionsText(
  sections: proto.Message.ListMessage.ISection[] | null | undefined,
): string {
  return (sections ?? [])
    .map((section) => {
      const rows = (section.rows ?? [])
        .map((row) => row.title ?? "")
        .filter((title) => title.length > 0)
        .join(" | ");
      return [section.title ?? "", rows].filter((part) => part.length > 0).join(": ");
    })
    .filter((part) => part.length > 0)
    .join(" [");
}

function contextOf(content: Content): proto.IContextInfo | null {
  return (
    content.extendedTextMessage?.contextInfo ??
    content.imageMessage?.contextInfo ??
    content.videoMessage?.contextInfo ??
    content.audioMessage?.contextInfo ??
    content.documentMessage?.contextInfo ??
    content.stickerMessage?.contextInfo ??
    null
  );
}

function textOf(content: Content): {
  text: string | null;
  mediaType: string | null;
  mentions: string[];
  quotedMessageId: string | null;
  reaction: string | null;
  reactionTargetId: string | null;
  editedMessageId: string | null;
  editedText: string | null;
  revokedMessageId: string | null;
  poll: ExtractedPoll | null;
  pollVote: ExtractedPollVote | null;
  isEphemeral: boolean;
  isStatusMention: boolean;
} {
  const context = contextOf(content);
  const mentions = [...(context?.mentionedJid ?? [])];
  const quotedMessageId = context?.stanzaId ?? null;
  const base = {
    mentions,
    quotedMessageId,
    reaction: null,
    reactionTargetId: null,
    editedMessageId: null,
    editedText: null,
    revokedMessageId: null,
    poll: null,
    pollVote: null,
    isEphemeral: false,
    isStatusMention: false,
  };
  if (content.conversation !== undefined && content.conversation !== null) {
    return { text: content.conversation, mediaType: null, ...base };
  }
  const extended = content.extendedTextMessage;
  if (extended) {
    return { text: extended.text ?? null, mediaType: null, ...base };
  }
  const image = content.imageMessage;
  if (image) {
    return { text: image.caption ?? null, mediaType: "image", ...base };
  }
  const video = content.videoMessage;
  if (video) {
    return { text: video.caption ?? null, mediaType: "video", ...base };
  }
  const audio = content.audioMessage;
  if (audio) {
    return { text: null, mediaType: "audio", ...base };
  }
  const sticker = content.stickerMessage;
  if (sticker) {
    return { text: null, mediaType: "sticker", ...base };
  }
  const document = content.documentMessage;
  if (document) {
    return { text: document.caption ?? document.title ?? null, mediaType: "document", ...base };
  }
  const reactionMessage = content.reactionMessage;
  if (reactionMessage) {
    const emote = reactionMessage.text ?? null;
    return {
      text: emote,
      mediaType: null,
      ...base,
      reaction: emote,
      reactionTargetId: reactionMessage.key?.id ?? null,
    };
  }
  const pollCreation = content.pollCreationMessage;
  if (pollCreation) {
    const poll = {
      name: pollCreation.name ?? "",
      options: (pollCreation.options ?? [])
        .map((option) => option.optionName ?? "")
        .filter((label) => label.length > 0),
    };
    return { text: poll.name, mediaType: null, ...base, poll };
  }
  const pollUpdate = content.pollUpdateMessage;
  if (pollUpdate) {
    return {
      text: null,
      mediaType: null,
      ...base,
      pollVote: { targetMessageId: pollUpdate.pollCreationMessageKey?.id ?? null, selections: [] },
    };
  }
  const protocol = content.protocolMessage;
  if (protocol) {
    if (protocol.type === REVOKE) {
      return {
        text: null,
        mediaType: null,
        ...base,
        revokedMessageId: protocol.key?.id ?? null,
      };
    }
    if (protocol.type === MESSAGE_EDIT) {
      const edited = protocol.editedMessage;
      const editedText =
        edited?.conversation ??
        edited?.extendedTextMessage?.text ??
        edited?.imageMessage?.caption ??
        null;
      return {
        text: editedText,
        mediaType: null,
        ...base,
        editedMessageId: protocol.key?.id ?? null,
        editedText,
      };
    }
    if (protocol.type === EPHEMERAL_SETTING) {
      return { text: null, mediaType: null, ...base, isEphemeral: true };
    }
    if (protocol.type === STATUS_MENTION) {
      return { text: null, mediaType: null, ...base, isStatusMention: true };
    }
    return { text: null, mediaType: null, ...base };
  }
  const location = content.locationMessage;
  if (location) {
    const lat = location.degreesLatitude ?? 0;
    const lon = location.degreesLongitude ?? 0;
    const coords = `${lat}, ${lon}`;
    return {
      text: location.name ? `${location.name} (${coords})` : coords,
      mediaType: "location",
      ...base,
    };
  }
  const contact = content.contactMessage;
  if (contact) {
    const vcard = parseVcard(contact.vcard ?? "");
    const name = contact.displayName ?? vcard.name ?? "contact";
    const numbers = vcard.numbers.join(", ");
    return {
      text: numbers.length > 0 ? `${name}: ${numbers}` : name,
      mediaType: "contact",
      ...base,
    };
  }
  const buttons = content.buttonsMessage;
  if (buttons) {
    const labels = buttonLabels(buttons.buttons);
    const parts = [
      buttons.contentText ?? "",
      labels.length > 0 ? `[${labels.join(" | ")}]` : "",
      buttons.footerText ?? "",
    ];
    return {
      text: parts.filter((part) => part.length > 0).join(" "),
      mediaType: null,
      ...base,
    };
  }
  const list = content.listMessage;
  if (list) {
    const headline = [list.title ?? "", list.description ?? ""]
      .filter((part) => part.length > 0)
      .join(" — ");
    const sections = listSectionsText(list.sections);
    return {
      text: [headline, sections.length > 0 ? `[${sections}]` : ""]
        .filter((part) => part.length > 0)
        .join(" "),
      mediaType: null,
      ...base,
    };
  }
  const template = content.templateMessage;
  if (template) {
    const hydrated = templateOf(template);
    if (hydrated) {
      const labels = hydratedButtonLabels(hydrated.hydratedButtons);
      const parts = [
        hydrated.hydratedContentText ?? "",
        labels.length > 0 ? `[${labels.join(" | ")}]` : "",
        hydrated.hydratedFooterText ?? "",
      ];
      return { text: parts.filter((part) => part.length > 0).join(" "), mediaType: null, ...base };
    }
  }
  return { text: null, mediaType: null, ...base };
}

export function extractContent(
  message: WAMessage,
  pollUpdates?: IncomingPollUpdate[],
): ExtractedContent {
  const { content, viewOnce, ephemeral } = unwrapLayers(message.message);
  if (content === null) {
    return {
      text: null,
      mediaType: null,
      mentions: [],
      quotedMessageId: null,
      reaction: null,
      reactionTargetId: null,
      editedMessageId: null,
      editedText: null,
      revokedMessageId: null,
      poll: null,
      pollVote: pollVoteFromUpdates(message.key?.id ?? null, pollUpdates),
      isEphemeral: ephemeral,
      isViewOnce: viewOnce,
      isStatusMention: false,
    };
  }
  const extracted = textOf(content);
  let text = extracted.text;
  if (text === null && extracted.mediaType !== null && viewOnce) {
    text = `[view-once ${extracted.mediaType}]`;
  }
  return {
    text,
    mediaType: extracted.mediaType,
    mentions: extracted.mentions,
    quotedMessageId: extracted.quotedMessageId,
    reaction: extracted.reaction,
    reactionTargetId: extracted.reactionTargetId,
    editedMessageId: extracted.editedMessageId,
    editedText: extracted.editedText,
    revokedMessageId: extracted.revokedMessageId,
    poll: extracted.poll,
    pollVote: pollVoteFromUpdates(message.key?.id ?? null, pollUpdates) ?? extracted.pollVote,
    isEphemeral: ephemeral || extracted.isEphemeral,
    isViewOnce: viewOnce,
    isStatusMention: extracted.isStatusMention,
  };
}

function pollVoteFromUpdates(
  pollMessageId: string | null | undefined,
  updates?: IncomingPollUpdate[],
): ExtractedPollVote | null {
  if (updates === undefined || updates.length === 0) {
    return null;
  }
  const selections = updates
    .flatMap((update) => update.vote?.selectedOptions ?? [])
    .filter((option): option is Uint8Array => option !== null && option !== undefined)
    .map((option) => Buffer.from(option).toString("hex"));
  return { targetMessageId: pollMessageId ?? null, selections };
}
