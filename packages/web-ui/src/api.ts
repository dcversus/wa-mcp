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
  listSubscriptions(): Promise<{ subscriptions: unknown[] }>;
  getConfig(): Promise<{
    transcription?: {
      engine?: string;
      base_url?: string;
      model?: string;
      api_key?: string;
      api_key_set?: boolean;
    };
  }>;
  saveConfig(body: {
    transcription: { engine?: string; base_url?: string; model?: string; api_key?: string };
  }): Promise<{ saved: boolean }>;
  createSubscription(body: {
    chat_jid?: string;
    all_chats?: boolean;
    kinds?: string[];
    include_media?: boolean;
  }): Promise<{ id: string; inboxPath: string }>;
  deleteSubscription(id: string): Promise<void>;
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

/** T93-C1: error bodies are data, not payloads — every non-OK response
 * surfaces as a structured ApiError so render code never receives an
 * error object shaped like a success body. */
export class ApiError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "ApiError";
    this.status = status;
  }
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
    const raw = await response.text();
    let parsed: unknown;
    try {
      parsed = raw.length > 0 ? JSON.parse(raw) : null;
    } catch {
      // an HTML error page (502/504 from a proxy) is not a success body
      throw new ApiError(response.status, `bridge returned non-JSON (${response.status})`);
    }
    if (!response.ok) {
      const message =
        parsed !== null &&
        typeof parsed === "object" &&
        "error" in parsed &&
        (parsed as { error?: { message?: unknown } }).error?.message !== undefined
          ? String((parsed as { error: { message: unknown } }).error.message)
          : `bridge returned ${response.status}`;
      throw new ApiError(response.status, message);
    }
    return parsed as T;
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
      // T93-C1: the bridge reads ?q= — the old ?query= was silently ignored
      const params = new URLSearchParams({ q: query });
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
    // T77: the route validates input.jid (NOT chat_jid) — drift fixed
    setAlias: (chatJid, alias) => post("/api/alias", { jid: chatJid, alias }),
    groupParticipants: (groupJid) => post("/api/group/participants", { group_jid: groupJid }),
    groupMeta: (groupJid, patch) => post("/api/group/meta", { group_jid: groupJid, ...patch }),
    groupCreate: (subject, participants) => post("/api/group/create", { subject, participants }),
    groupLeave: (groupJid) => post("/api/group/leave", { group_jid: groupJid }),
    notifications: () => jsonCall("/api/notifications"),
    listSubscriptions: () => jsonCall("/api/subscriptions"),
    getConfig: () => jsonCall("/api/config"),
    saveConfig: (body) => jsonCall("/api/config", { method: "PUT", json: body }),
    createSubscription: (body) => post("/api/subscriptions", body),
    deleteSubscription: (id) =>
      jsonCall(`/api/subscriptions/${encodeURIComponent(id)}`, { method: "DELETE" }),
    deleteNotification: (id) =>
      jsonCall(`/api/notifications/${encodeURIComponent(id)}`, { method: "DELETE" }),
    profile: () => jsonCall("/api/profile"),
    privacy: () => jsonCall("/api/privacy"),
    blocklist: () => jsonCall("/api/blocklist"),
    downloadMedia: (messageId) => post(`/api/media/${encodeURIComponent(messageId)}`, {}),
    transcribe: (messageId) => post("/api/transcribe", { message_id: messageId }),
    sendTts: (chatJid, text) => post("/api/tts", { chat_jid: chatJid, text }),
    // T77: the route validates input.presence (NOT state) — drift fixed
    sendPresence: (chatJid, state) => post("/api/presence", { chat_jid: chatJid, presence: state }),
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
