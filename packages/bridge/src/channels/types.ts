/** GOAL §18 dual-channel foundation: normalized channel abstractions.
 * Both adapters share the same store and read model; only the transport
 * (send/events/media/pair) is channel-specific (delltrak channels/ pattern). */

export type ChannelName = "baileys" | "cloud";

export interface OutboundText {
  kind: "text";
  to: string;
  body: string;
}

export interface OutboundTemplate {
  kind: "template";
  to: string;
  template: string;
  language: string;
  vars: string[];
}

export type OutboundMessage = OutboundText | OutboundTemplate;

export interface OutboundReceipt {
  id: string;
  isFromMe: true;
  channel: ChannelName;
}

export interface NormalizedChat {
  jid: string;
  name: string | null;
  lastTimestamp: number | null;
}

export interface NormalizedMessage {
  id: string;
  chatJid: string;
  from: string;
  timestamp: number;
  text: string | null;
  isFromMe: boolean;
}

export interface NormalizedHistoryPage {
  messages: NormalizedMessage[];
  nextCursor: string | null;
}

export type ChannelEvent =
  | { type: "message"; message: NormalizedMessage }
  | { type: "status"; messageId: string; status: string };

export interface ChannelEventBus {
  subscribe(fn: (event: ChannelEvent) => void): () => void;
}

/** Read model shared by both channels — backed by the one store. */
export interface ChannelReadModel {
  fetchChats(): Promise<NormalizedChat[]>;
  fetchHistory(chatJid: string, cursor?: string): Promise<NormalizedHistoryPage>;
}

export interface ChannelAdapter {
  readonly channel: ChannelName;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** baileys pairs via QR/pairing-code; cloud is pre-provisioned (no-op). */
  pair(opts?: { phoneNumber?: string }): Promise<{ paired: boolean; detail?: string }>;
  sendMessage(input: OutboundMessage): Promise<OutboundReceipt>;
  markRead(chatJid: string, messageIds: string[]): Promise<void>;
  downloadMedia(url: string): Promise<Uint8Array>;
  checkContact(phone: string): Promise<{ registered: boolean }>;
  fetchChats(): Promise<NormalizedChat[]>;
  fetchHistory(chatJid: string, cursor?: string): Promise<NormalizedHistoryPage>;
  events(): ChannelEventBus;
}
