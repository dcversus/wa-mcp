export interface ApiClientOptions {
  baseUrl: string;
  token: string;
  fetchFn?: typeof fetch;
  onUnauthorized: () => void;
  /** network-level failure (daemon down) — T68 banner */
  onUnreachable?: () => void;
}

export interface ApiClient {
  getChats(): Promise<unknown>;
  getMessages(chatJid: string, limit?: number): Promise<unknown>;
  sendMessage(chatJid: string, text: string): Promise<{ message_id: string }>;
  getQr(): Promise<{ qr: string | null; png: string | null }>;
  getUnread(): Promise<{ unread: Array<{ chatJid: string; unreadCount: number }> }>;
  getHealth(): Promise<Record<string, unknown>>;
  /** ADR 0012: exchange the scoped pairing token for the daemon token.
   * Reachable only from a loopback, same-origin page. */
  uiToken(): Promise<{ token?: string }>;
  markRead(chatJid: string, messageIds: string[]): Promise<unknown>;
  pairingCode(phone: string): Promise<{ code?: string; error?: { code: string; message: string } }>;
  resumePairing(): Promise<{ resumed: boolean }>;
  search(query: string, limit?: number): Promise<unknown>;
  contacts(query?: string): Promise<unknown>;
  setAlias(chatJid: string, alias: string): Promise<unknown>;
  groupParticipants(groupJid: string): Promise<unknown>;
  groupCreate(subject: string, participants: string[]): Promise<unknown>;
  groupLeave(groupJid: string): Promise<unknown>;
  groupMeta(groupJid: string, patch: { subject?: string; description?: string }): Promise<unknown>;
  groupInfo(groupJid: string): Promise<unknown>;
  notifications(): Promise<unknown>;
  deleteNotification(id: string): Promise<unknown>;
  profile(): Promise<unknown>;
  privacy(): Promise<unknown>;
  blocklist(): Promise<unknown>;
  downloadMedia(messageId: string): Promise<unknown>;
  transcribe(messageId: string): Promise<unknown>;
  sendTts(chatJid: string, text: string): Promise<unknown>;
  sendPresence(chatJid: string, state: string): Promise<unknown>;
  getContext(chatJid: string, messageId: string, limit?: number): Promise<unknown>;
  block(chatJid: string): Promise<unknown>;
  setPrivacy(key: string, value: string): Promise<unknown>;
  setProfileName(name: string): Promise<unknown>;
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const fetchFn = opts.fetchFn ?? fetch;
  const call = async (path: string, init?: RequestInit & { json?: unknown }): Promise<Response> => {
    const { json, ...rest } = init ?? {};
    const headers: Record<string, string> = {
      "content-type": "application/json",
      authorization: `Bearer ${opts.token}`,
    };
    if (rest.headers !== undefined) {
      Object.assign(headers, rest.headers);
    }
    let response: Response;
    try {
      response = await fetchFn(`${opts.baseUrl}${path}`, {
        ...rest,
        method: json !== undefined ? "POST" : (rest.method ?? "GET"),
        headers,
        ...(json !== undefined ? { body: JSON.stringify(json) } : {}),
      });
    } catch (err) {
      opts.onUnreachable?.();
      throw err;
    }
    if (response.status === 401) {
      opts.onUnauthorized();
    }
    return response;
  };
  const jsonCall = async <T>(path: string, init?: RequestInit & { json?: unknown }): Promise<T> => {
    const response = await call(path, init);
    return (await response.json()) as T;
  };
  const post = <T>(path: string, json: unknown): Promise<T> =>
    jsonCall<T>(path, { method: "POST", json });
  return {
    getChats: () => jsonCall("/api/chats"),
    getMessages: (chatJid, limit) => {
      const params = new URLSearchParams({ chat_jid: chatJid });
      if (limit !== undefined) {
        params.set("limit", String(limit));
      }
      return jsonCall(`/api/messages?${params.toString()}`);
    },
    sendMessage: (chatJid, text) => post("/api/send", { chat_jid: chatJid, text }),
    getQr: () => jsonCall("/api/qr"),
    getUnread: () => jsonCall("/api/unread"),
    getHealth: () => jsonCall("/health"),
    uiToken: () => jsonCall("/api/ui-token"),
    markRead: (chatJid, messageIds) =>
      post("/api/read", { chat_jid: chatJid, message_ids: messageIds }),
    pairingCode: (phone) => post("/api/pairing-code", { phone }),
    resumePairing: () => post("/api/pair/resume", {}),
    search: (query, limit) => {
      const params = new URLSearchParams({ query });
      if (limit !== undefined) {
        params.set("limit", String(limit));
      }
      return jsonCall(`/api/search?${params.toString()}`);
    },
    contacts: (query) => {
      const params = new URLSearchParams();
      if (query !== undefined) {
        params.set("query", query);
      }
      const suffix = params.toString();
      return jsonCall(`/api/contacts${suffix ? `?${suffix}` : ""}`);
    },
    setAlias: (chatJid, alias) => post("/api/alias", { chat_jid: chatJid, alias }),
    groupParticipants: (groupJid) => post("/api/group/participants", { group_jid: groupJid }),
    groupMeta: (groupJid, patch) => post("/api/group/meta", { group_jid: groupJid, ...patch }),
    groupCreate: (subject, participants) => post("/api/group/create", { subject, participants }),
    groupLeave: (groupJid) => post("/api/group/leave", { group_jid: groupJid }),
    notifications: () => jsonCall("/api/notifications"),
    deleteNotification: (id) =>
      jsonCall(`/api/notifications/${encodeURIComponent(id)}`, { method: "DELETE" }),
    profile: () => jsonCall("/api/profile"),
    privacy: () => jsonCall("/api/privacy"),
    blocklist: () => jsonCall("/api/blocklist"),
    downloadMedia: (messageId) => post(`/api/media/${encodeURIComponent(messageId)}`, {}),
    transcribe: (messageId) => post("/api/transcribe", { message_id: messageId }),
    sendTts: (chatJid, text) => post("/api/tts", { chat_jid: chatJid, text }),
    sendPresence: (chatJid, state) => post("/api/presence", { chat_jid: chatJid, state }),
    block: (chatJid) => post("/api/block", { chat_jid: chatJid, block: true }),
    setPrivacy: (privacy_key, value) => post("/api/privacy", { privacy_key, value }),
    setProfileName: (name) => post("/api/profile", { name }),
    groupInfo: (groupJid) => jsonCall(`/api/group/info?jid=${encodeURIComponent(groupJid)}`),
    getContext: (chatJid, messageId, radius) => {
      const params = new URLSearchParams({ chat_jid: chatJid, message_id: messageId });
      if (radius !== undefined) {
        params.set("radius", String(radius));
      }
      return jsonCall(`/api/context?${params.toString()}`);
    },
  };
}
