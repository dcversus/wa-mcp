import type {
  ChannelAdapter,
  ChannelEvent,
  ChannelEventBus,
  ChannelName,
  ChannelReadModel,
  OutboundMessage,
  OutboundReceipt,
} from "../types.ts";
import type { CloudChannelConfig } from "./config.ts";

export interface WebhookInboundMessage {
  id: string;
  from: string;
  text: string;
  timestamp?: number;
}

interface CloudDeps {
  fetchFn?: typeof fetch;
  readModel?: ChannelReadModel;
}

/** Meta WhatsApp Cloud API transport (GOAL §18). Real Graph API shapes,
 * injected fetch — mocked in tests, sandbox creds plug in later.
 * Credentials live in env/config only; this adapter never touches the store. */
export class CloudApiAdapter implements ChannelAdapter {
  readonly channel: ChannelName = "cloud";
  private readonly listeners = new Set<(event: ChannelEvent) => void>();
  private readonly fetchFn: typeof fetch;
  private readonly readModel: ChannelReadModel | undefined;

  constructor(
    private readonly config: CloudChannelConfig,
    deps: CloudDeps = {},
  ) {
    this.fetchFn = deps.fetchFn ?? fetch;
    this.readModel = deps.readModel;
  }

  private messagesUrl(): string {
    return `https://graph.facebook.com/${this.config.apiVersion}/${this.config.phoneNumberId}/messages`;
  }

  private authHeaders(extra: Record<string, string> = {}): Record<string, string> {
    return {
      authorization: `Bearer ${this.config.accessToken}`,
      "content-type": "application/json",
      ...extra,
    };
  }

  async connect(): Promise<void> {
    // cloud is connectionless from our side: each call hits the Graph API
  }

  async disconnect(): Promise<void> {}

  /** cloud numbers are pre-provisioned in the Meta dashboard — nothing to pair */
  async pair(): Promise<{ paired: boolean; detail?: string }> {
    return { paired: true, detail: "cloud channel is pre-provisioned; no pairing step" };
  }

  async sendMessage(input: OutboundMessage): Promise<OutboundReceipt> {
    let body: Record<string, unknown>;
    if (input.kind === "text") {
      body = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "text",
        text: { preview_url: false, body: input.body },
      };
    } else {
      body = {
        messaging_product: "whatsapp",
        recipient_type: "individual",
        to: input.to,
        type: "template",
        template: {
          name: input.template,
          language: { code: input.language },
          components: [
            { type: "body", parameters: input.vars.map((text) => ({ type: "text", text })) },
          ],
        },
      };
    }
    const response = await this.fetchFn(this.messagesUrl(), {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify(body),
    });
    if (!response.ok) {
      throw new Error(`cloud send failed: ${response.status}`);
    }
    const payload = (await response.json()) as { messages?: Array<{ id: string }> };
    const id = payload.messages?.[0]?.id;
    if (id === undefined) {
      throw new Error("cloud send returned no message id");
    }
    return { id, isFromMe: true, channel: this.channel };
  }

  async markRead(chatJid: string, messageIds: string[]): Promise<void> {
    void chatJid;
    for (const messageId of messageIds) {
      const response = await this.fetchFn(this.messagesUrl(), {
        method: "POST",
        headers: this.authHeaders(),
        body: JSON.stringify({
          messaging_product: "whatsapp",
          status: "read",
          message_id: messageId,
        }),
      });
      if (!response.ok) {
        throw new Error(`cloud mark-read failed for ${messageId}: ${response.status}`);
      }
    }
  }

  async downloadMedia(url: string): Promise<Uint8Array> {
    const response = await this.fetchFn(url, { headers: this.authHeaders() });
    if (!response.ok) {
      throw new Error(`cloud media download failed: ${response.status}`);
    }
    return new Uint8Array(await response.arrayBuffer());
  }

  /** Meta contact check: POST /{phone-number-id}/contacts with blocking=wait */
  async checkContact(phone: string): Promise<{ registered: boolean }> {
    const url = `https://graph.facebook.com/${this.config.apiVersion}/${this.config.phoneNumberId}/contacts`;
    const response = await this.fetchFn(url, {
      method: "POST",
      headers: this.authHeaders(),
      body: JSON.stringify({ blocking: "wait", contacts: [phone], field: "wa_id" }),
    });
    if (!response.ok) {
      throw new Error(`cloud contact check failed: ${response.status}`);
    }
    const payload = (await response.json()) as {
      contacts?: Array<{ input: string; status?: string }>;
    };
    const match = payload.contacts?.find((contact) => contact.input === phone);
    return { registered: match?.status === "valid" };
  }

  async fetchChats() {
    if (this.readModel === undefined) {
      return [];
    }
    return this.readModel.fetchChats();
  }

  async fetchHistory(chatJid: string, cursor?: string) {
    // engine truth: the Cloud API has no history-backfill endpoint — the shared
    // store is the read model for both channels
    if (this.readModel === undefined) {
      return { messages: [], nextCursor: null };
    }
    return this.readModel.fetchHistory(chatJid, cursor);
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

  /** webhook payload entry point: normalize a provider message and fan out */
  ingestWebhookMessage(message: WebhookInboundMessage): void {
    const event: ChannelEvent = {
      type: "message",
      message: {
        id: message.id,
        chatJid: `${message.from}@s.whatsapp.net`,
        from: message.from,
        timestamp: message.timestamp ?? Math.floor(Date.now() / 1000),
        text: message.text,
        isFromMe: false,
      },
    };
    for (const fn of this.listeners) {
      fn(event);
    }
  }
}
