import type {
  ChannelAdapter,
  ChannelEvent,
  ChannelEventBus,
  ChannelName,
  ChannelReadModel,
  OutboundReceipt,
} from "../types.ts";

export interface BaileysAdapterDeps {
  hasPairedAccount(): boolean;
  /** bridge send path: buildTextMessage + sendViaSocket, wired in bin.ts */
  sendText(to: string, body: string): Promise<{ id: string; isFromMe: true }>;
  markRead(chatJid: string, messageIds: string[]): Promise<void>;
  downloadMedia(messageId: string): Promise<Uint8Array>;
  checkContact(phone: string): Promise<{ registered: boolean }>;
  onInbound(fn: (message: { id: string; from: string; text: string }) => void): void;
}

/** Baileys transport over the existing daemon (GOAL §18 default channel).
 * Reads come from the shared store via the injected read model; sends go
 * through the existing baileys send path. */
export class BaileysAdapter implements ChannelAdapter {
  readonly channel: ChannelName = "baileys";
  private readonly listeners = new Set<(event: ChannelEvent) => void>();

  constructor(
    private readonly deps: BaileysAdapterDeps,
    private readonly readModel?: ChannelReadModel,
  ) {
    deps.onInbound((message) => {
      const event: ChannelEvent = {
        type: "message",
        message: {
          id: message.id,
          chatJid: `${message.from}@s.whatsapp.net`,
          from: message.from,
          timestamp: Math.floor(Date.now() / 1000),
          text: message.text,
          isFromMe: false,
        },
      };
      for (const fn of this.listeners) {
        fn(event);
      }
    });
  }

  async connect(): Promise<void> {
    // the baileys daemon connects at startup; nothing extra here
  }

  async disconnect(): Promise<void> {}

  async pair(opts?: { phoneNumber?: string }): Promise<{ paired: boolean; detail?: string }> {
    if (this.deps.hasPairedAccount()) {
      return { paired: true, detail: "already paired" };
    }
    return {
      paired: false,
      detail: opts?.phoneNumber
        ? "request a pairing code via POST /api/pairing-code"
        : "scan the QR via GET /api/qr or 'wa-mcp pair'",
    };
  }

  async sendMessage(input: { kind: "text"; to: string; body: string }): Promise<OutboundReceipt> {
    if (input.kind !== "text") {
      throw new Error("baileys adapter foundation sends text only");
    }
    const receipt = await this.deps.sendText(input.to, input.body);
    return { ...receipt, channel: this.channel };
  }

  async markRead(chatJid: string, messageIds: string[]): Promise<void> {
    await this.deps.markRead(chatJid, messageIds);
  }

  async downloadMedia(messageId: string): Promise<Uint8Array> {
    return this.deps.downloadMedia(messageId);
  }

  async checkContact(phone: string): Promise<{ registered: boolean }> {
    return this.deps.checkContact(phone);
  }

  async fetchChats() {
    return this.readModel?.fetchChats() ?? [];
  }

  async fetchHistory(chatJid: string, cursor?: string) {
    return this.readModel?.fetchHistory(chatJid, cursor) ?? { messages: [], nextCursor: null };
  }

  events(): ChannelEventBus {
    return {
      subscribe: (fn) => {
        this.listeners.add(fn);
        return () => {
          this.listeners.delete(fn);
        };
      },
    };
  }
}
