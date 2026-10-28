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
  sendMessage(
    chatJid: string,
    text: string,
    opts?: { replyToMessageId?: string },
  ): Promise<{ message_id: string }>;
  getQr(): Promise<{
    qr: string | null;
    png: string | null;
    index?: number;
    expiresAt?: string | null;
    expired?: boolean;
  }>;
  /** open ONE registration when nobody is paired (never resets the budget) */
  startPairing(): Promise<{ started: boolean; reason?: string; status?: string }>;
  getHealth(): Promise<Record<string, unknown>>;
  /** ADR 0012: exchange the scoped pairing token for the daemon token.
   * Reachable only from a loopback, same-origin page. */
  uiToken(opts?: { useCookie?: boolean }): Promise<{ token?: string }>;
  getMe(): Promise<{ pn?: string | null; name?: string | null; status?: string | null }>;
  pairingCode(phone: string): Promise<{ code?: string; error?: { code: string; message: string } }>;
  resumePairing(): Promise<{ resumed: boolean }>;
  searchLogs(query: string): Promise<{ messages?: unknown[] }>;
  contacts(query: { q?: string; saved?: boolean; limit?: number }): Promise<unknown>;
  addContact(input: { name: string; phone: string; username?: string }): Promise<unknown>;
  renameContact(jid: string, name: string): Promise<unknown>;
  removeContact(jid: string): Promise<unknown>;
  connections(): Promise<unknown>;
  disconnectConnection(kind: string, agent: string, sub?: string): Promise<unknown>;
  testSubscription(id: string): Promise<{
    ok: boolean;
    mode: string;
    appended: boolean;
    inboxPath: string | null;
    totalLines: number;
    dropped: number;
  }>;
  subscriptions(): Promise<{ subscriptions?: unknown[] }>;
  updateSubscription(id: string, patch: Record<string, unknown>): Promise<unknown>;
  sessions(): Promise<{ sessions?: unknown[] }>;
  connectionSettings(): Promise<unknown>;
  saveConnectionSettings(body: unknown): Promise<unknown>;
  connectionStats(): Promise<unknown>;
  logout(): Promise<unknown>;
  createSubscription(body: Record<string, unknown>): Promise<unknown>;
  deleteSubscription(id: string): Promise<unknown>;
  privacy(): Promise<unknown>;
  blocklist(): Promise<unknown>;
  downloadMedia(messageId: string): Promise<unknown>;
  transcribe(messageId: string): Promise<unknown>;
  sendPresence(chatJid: string, state: string): Promise<unknown>;
  getContext(chatJid: string, messageId: string, limit?: number): Promise<unknown>;
  block(chatJid: string): Promise<unknown>;
  unblock(chatJid: string): Promise<unknown>;
  setPrivacy(patch: Record<string, string>): Promise<unknown>;
  setProfileName(name: string): Promise<unknown>;
  setProfileStatus(status: string): Promise<unknown>;
}

/** T93-C1: error bodies are data, not payloads — every non-OK response
 * surfaces as a structured ApiError so render code never receives an
 * error object shaped like a success body. */
export class ApiError extends Error {
  readonly status: number;
  readonly retryAfterMs: number | null;

  constructor(status: number, message: string, retryAfterMs: number | null = null) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.retryAfterMs = retryAfterMs;
  }
}

export function createApiClient(opts: ApiClientOptions): ApiClient {
  const fetchFn = opts.fetchFn ?? fetch;
  const call = async (path: string, init?: RequestInit & { json?: unknown }): Promise<Response> => {
    const { json, ...rest } = init ?? {};
    const callerHeaders = (rest.headers ?? {}) as Record<string, string | undefined>;
    const headers: Record<string, string> = {
      "content-type": "application/json",
    };
    Object.assign(headers, callerHeaders);
    if (callerHeaders.authorization === "") {
      delete headers.authorization;
    } else if (callerHeaders.authorization === undefined) {
      headers.authorization = `Bearer ${opts.token}`;
    }
    let response: Response;
    try {
      response = await fetchFn(`${opts.baseUrl}${path}`, {
        ...rest,
        method: rest.method ?? (json !== undefined ? "POST" : "GET"),
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
      const retryAfterHeader = response.headers.get("retry-after");
      const retryAfterSeconds = Number(retryAfterHeader);
      const retryAfterMs =
        retryAfterHeader !== null &&
        retryAfterHeader.length > 0 &&
        Number.isFinite(retryAfterSeconds)
          ? Math.ceil(retryAfterSeconds * 1000)
          : null;
      throw new ApiError(response.status, message, retryAfterMs);
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
    sendMessage: (chatJid, text, opts) =>
      post("/api/send", {
        chat_jid: chatJid,
        text,
        ...(opts?.replyToMessageId !== undefined
          ? { reply_to_message_id: opts.replyToMessageId }
          : {}),
      }),
    getQr: async () => {
      try {
        return await jsonCall("/api/qr");
      } catch (err) {
        // 410: the codes ran out unscanned and the bridge stopped registering
        if (err instanceof ApiError && err.status === 410) {
          return { qr: null, png: null, expired: true };
        }
        throw err;
      }
    },
    startPairing: () => post("/api/pair/start", {}),
    getHealth: () => jsonCall("/health"),
    uiToken: (opts) =>
      jsonCall("/api/ui-token", {
        credentials: opts?.useCookie === true ? "same-origin" : undefined,
        headers: opts?.useCookie === true ? { authorization: "" } : undefined,
      }),
    getMe: () => jsonCall("/api/me"),
    pairingCode: (phone) => post("/api/pairing-code", { phone }),
    resumePairing: () => post("/api/pair/resume", {}),
    searchLogs: (query) => jsonCall(`/api/search?${query}`),
    contacts: (query) => {
      const params = new URLSearchParams();
      if (query.q !== undefined && query.q.length > 0) {
        params.set("q", query.q);
      }
      if (query.saved === true) {
        params.set("saved", "true");
      }
      if (query.limit !== undefined) {
        params.set("limit", String(query.limit));
      }
      const suffix = params.toString();
      return jsonCall(`/api/contacts${suffix ? `?${suffix}` : ""}`);
    },
    addContact: (input) => post("/api/contacts", input),
    renameContact: (jid, name) =>
      jsonCall(`/api/contacts/${encodeURIComponent(jid)}`, { method: "PATCH", json: { name } }),
    removeContact: (jid) =>
      jsonCall(`/api/contacts/${encodeURIComponent(jid)}`, { method: "DELETE" }),
    connections: () => jsonCall("/api/connections"),
    disconnectConnection: (kind, agent, sub) =>
      jsonCall(
        `/api/connections/${encodeURIComponent(kind)}/${encodeURIComponent(agent)}${sub === undefined ? "" : `?sub=${encodeURIComponent(sub)}`}`,
        { method: "DELETE" },
      ),
    testSubscription: (id) =>
      jsonCall(`/api/subs2/${encodeURIComponent(id)}/test`, { method: "POST" }),
    subscriptions: () => jsonCall("/api/subs2"),
    updateSubscription: (id, patch) =>
      jsonCall(`/api/subs2/${encodeURIComponent(id)}`, { method: "PATCH", json: patch }),
    sessions: () => jsonCall("/api/sessions"),
    connectionSettings: () => jsonCall("/api/connection-settings"),
    saveConnectionSettings: (body) =>
      jsonCall("/api/connection-settings", { method: "PUT", json: body }),
    connectionStats: () => jsonCall("/api/connection-stats"),
    logout: () => jsonCall("/api/logout", { method: "POST" }),
    createSubscription: (body) => post("/api/subs2", body),
    deleteSubscription: (id) =>
      jsonCall(`/api/subs2/${encodeURIComponent(id)}`, { method: "DELETE" }),
    privacy: () => jsonCall("/api/privacy"),
    blocklist: () => jsonCall("/api/blocklist"),
    downloadMedia: (messageId) => post(`/api/media/${encodeURIComponent(messageId)}`, {}),
    transcribe: (messageId) => post("/api/transcribe", { message_id: messageId }),
    // T77: the route validates input.presence (NOT state) — drift fixed
    sendPresence: (chatJid, state) => post("/api/presence", { chat_jid: chatJid, presence: state }),
    block: (chatJid) => post("/api/block", { jid: chatJid, block: true }),
    unblock: (chatJid) => post("/api/block", { jid: chatJid, block: false }),
    setPrivacy: (patch) => post("/api/privacy", patch),
    setProfileStatus: (status) => post("/api/profile", { status }),
    setProfileName: (name) => post("/api/profile", { name }),
    getContext: (chatJid, messageId, radius) => {
      const params = new URLSearchParams({ chat_jid: chatJid, message_id: messageId });
      if (radius !== undefined) {
        params.set("radius", String(radius));
      }
      return jsonCall(`/api/context?${params.toString()}`);
    },
  };
}
