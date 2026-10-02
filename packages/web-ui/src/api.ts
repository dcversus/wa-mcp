export interface ApiClientOptions {
  baseUrl: string;
  token: string;
  fetchFn?: typeof fetch;
  onUnauthorized: () => void;
}

export interface ApiClient {
  getChats(): Promise<unknown>;
  getMessages(chatJid: string, limit?: number): Promise<unknown>;
  sendMessage(chatJid: string, text: string): Promise<{ message_id: string }>;
  getQr(): Promise<{ qr: string | null; png: string | null }>;
  getUnread(): Promise<{ unread: Array<{ chatJid: string; unreadCount: number }> }>;
  getHealth(): Promise<Record<string, unknown>>;
  markRead(chatJid: string, messageIds: string[]): Promise<unknown>;
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const fetchFn = opts.fetchFn ?? fetch;
  const call = async (path: string, init?: RequestInit & { json?: unknown }): Promise<Response> => {
    const { json, ...rest } = init ?? {};
    const response = await fetchFn(`${opts.baseUrl}${path}`, {
      method: json !== undefined ? "POST" : "GET",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${opts.token}`,
        ...(rest.headers ?? {}),
      },
      ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
    });
    if (response.status === 401) {
      opts.onUnauthorized();
    }
    return response;
  };
  const jsonCall = async <T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
    const response = await call(path, init);
    return (await response.json()) as T;
  };
  return {
    getChats: () => jsonCall("/api/chats"),
    getMessages: (chatJid, limit) => {
      const params = new URLSearchParams({ chat_jid: chatJid });
      if (limit !== undefined) {
        params.set("limit", String(limit));
      }
      return jsonCall(`/api/messages?${params.toString()}`);
    },
    sendMessage: (chatJid, text) =>
      jsonCall("/api/send", { method: "POST", json: { chat_jid: chatJid, text } }),
    getQr: () => jsonCall("/api/qr"),
    getUnread: () => jsonCall("/api/unread"),
    getHealth: () => jsonCall("/health"),
    markRead: (chatJid, messageIds) =>
      jsonCall("/api/read", {
        method: "POST",
        json: { chat_jid: chatJid, message_ids: messageIds },
      }),
  };
}
