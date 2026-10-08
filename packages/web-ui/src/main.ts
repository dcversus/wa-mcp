import "./styles.css";
import { renderFrame, type Route } from "./app.ts";
import { ApiError, createApiClient, type ApiClient } from "./api.ts";
import { healthWithRetry } from "./preflight.ts";
import {
  bridgeDownBanner,
  chatErrorHtml,
  contextViewHtml,
  profilePageHtml,
  messageListHtml,
  settingsHtml,
  transcriptionSettingsHtml,
  guardLoader,
  replyPreviewHtml,
} from "./pages.ts";
import {
  CONTACTS_PAGE_SIZE,
  contactsPageHtml,
  contactRenameFormHtml,
  validateNewContact,
  type ContactView,
} from "./contacts.ts";
import { connectionsPageHtml, type ConnectionView } from "./connections.ts";
import {
  readSubscriptionForm,
  likePreview,
  subscriptionsPageHtml,
  type SessionOption,
  type SubscriptionView,
} from "./subscriptions.ts";
import {
  pairedIdentityText,
  pairingHtml,
  pairingPossible,
  pairingState,
  qrCountdownPct,
  type PairingHealth,
  type PairingView,
} from "./pages-pairing.ts";
import { appendEvent, feedHtml, openStatusStream, type FeedLine } from "./events-feed.ts";
import {
  connectionPageHtml,
  readConnectionSettingsForm,
  type ConnectionSettingsView,
  type ConnectionStatsView,
} from "./connection.ts";
import { escapeHtml } from "./escape.ts";
import { routeKind } from "./router.ts";
import {
  EMPTY_LOG_FILTER,
  LOGS_PAGE_SIZE,
  logRowHtml,
  logsPageHtml,
  logsQuery,
  matchesLogFilter,
  rowsFromUpsert,
  type LogFilter,
  type LogRow,
  type LogsPageInput,
} from "./logs.ts";
import { createPairingPoller, type PairingPoller } from "./pairing-poll.ts";
import {
  effectiveToken,
  loadPairingToken,
  loadSettings,
  savePairingToken,
  saveSettings,
  type WebSettings,
  applyExchangeFailure,
  displayName,
  firstRunGate,
  shouldClearStaleToken,
  shouldExchange,
  blockTargetJid,
  buildPrivacyPatch,
} from "./state.ts";

let settings: WebSettings = loadSettings(localStorage);
// the ephemeral pairing token (from the public /health) powers the pairing
// surface until a real session token is stored in settings
let pairingToken = loadPairingToken(localStorage);
let client: ApiClient = createClient();

// ---- live pairing state (T51-A): poll /health + /api/qr while on #/pairing
const QR_TTL_MS = 20_000;
const PAIRING_INTRO =
  "Link WhatsApp to your AI agent — pair once, then your agent can read and send.";
let qrSeenAt = 0;
let pairingPoller: PairingPoller | null = null;
let pairingView: PairingView = {
  pane: "connecting",
  health: {},
  qr: { qr: null, png: null },
  countdownPct: 0,
};

/** Fetch the public /health and adopt its ephemeral token — runs on EVERY
 * route so all loaders authenticate without any user action (T54). Since
 * T73 C1 (ADR 0012) that token opens ONLY the pairing surface, so once the
 * daemon reports a paired account we exchange it once for the real token. */
let lastKnownHealth: PairingHealth = {};
async function syncPairingToken(): Promise<void> {
  const health = (await healthWithRetry(client, { attempts: 5, delayMs: 1200 })) as PairingHealth;
  lastKnownHealth = health;
  adoptPairingToken(health);
  await exchangeAccountToken(health.loggedIn === true);
}

// ADR 0012: one exchange attempt per page load — a 401/403 (unpaired daemon,
// or the UI reached from a non-loopback origin) leaves the UI on the pairing
// flow instead of retrying in a loop.
let exchangeTerminal = false;
let exchangeRetryNotBefore = 0;
let tokenEpoch = 0;
let clearedForEpoch = -1;
let exchangeMinted = true;
let exchangeLatched = false;
let exchangeAttempts = 0;
async function exchangeAccountToken(loggedIn: boolean): Promise<void> {
  if (
    !shouldExchange({
      loggedIn,
      token: settings.token,
      latched: exchangeLatched,
      terminal: exchangeTerminal,
      retryNotBefore: exchangeRetryNotBefore,
      now: Date.now(),
    })
  ) {
    return;
  }
  exchangeLatched = true;
  exchangeAttempts += 1;
  try {
    let res: { token?: string };
    try {
      res = await client.uiToken({ useCookie: true });
    } catch (cookieErr) {
      if (pairingToken.length === 0) {
        throw cookieErr;
      }
      res = await client.uiToken();
    }
    if (typeof res.token === "string" && res.token.length > 0) {
      settings = { ...settings, token: res.token };
      saveSettings(localStorage, settings);
      client = createClient();
      tokenEpoch += 1;
      exchangeMinted = true;
    }
  } catch (err) {
    const next = applyExchangeFailure({
      failure:
        err instanceof ApiError ? { status: err.status, retryAfterMs: err.retryAfterMs } : null,
      attempt: exchangeAttempts,
      now: Date.now(),
    });
    if (next.terminal) {
      exchangeTerminal = true;
    }
    exchangeRetryNotBefore = next.retryNotBefore;
  }
}

/** A daemon restart rotates the UI token — a stored token then 401s every
 * call. Clear it ONCE per page load and let the exchange run again. */
function clearStaleTokenOnce(): void {
  if (
    !shouldClearStaleToken({
      token: settings.token,
      terminal: exchangeTerminal,
      exchangeMinted,
      clearedForEpoch,
      currentEpoch: tokenEpoch,
    })
  ) {
    return;
  }
  clearedForEpoch = tokenEpoch;
  settings = { ...settings, token: "" };
  saveSettings(localStorage, settings);
  client = createClient();
}

function adoptPairingToken(health: PairingHealth): void {
  // T94-G: on a PAIRED daemon the pairing token is hidden — the STABLE
  // uiBootstrapToken takes over the bootstrap slot so a fresh browser still
  // authenticates with zero user action
  if (
    typeof (health as { uiBootstrapToken?: unknown }).uiBootstrapToken === "string" &&
    (health as { uiBootstrapToken: string }).uiBootstrapToken !== pairingToken
  ) {
    pairingToken = (health as { uiBootstrapToken: string }).uiBootstrapToken;
    savePairingToken(localStorage, pairingToken);
    client = createClient();
  }
  if (typeof health.pairingToken === "string" && health.pairingToken !== pairingToken) {
    // the ephemeral token rotates per daemon boot — persist the fresh one so
    // all UI pages authenticate without any user action
    pairingToken = health.pairingToken;
    savePairingToken(localStorage, pairingToken);
    client = createClient();
  }
}

async function refreshPairing(): Promise<void> {
  const health = (await client.getHealth().catch(() => ({}))) as PairingHealth;
  if (typeof health.pairingToken === "string" && health.pairingToken !== pairingToken) {
    // the ephemeral token rotates per daemon boot — persist the fresh one on
    // every health fetch so ALL UI pages authenticate without any user action
    pairingToken = health.pairingToken;
    savePairingToken(localStorage, pairingToken);
    client = createClient();
  }
  // T75: a logged-in daemon has no QR — skip the poll entirely so the
  // pairing page cannot drain the API bucket after pairing finished
  const qr = pairingPossible(health)
    ? await client.getQr().catch(() => ({ qr: null as string | null, png: null as string | null }))
    : { qr: null as string | null, png: null as string | null };
  if (qr.qr !== null && qrSeenAt === 0) {
    qrSeenAt = Date.now();
  }
  if (qr.qr === null) {
    qrSeenAt = 0;
  }
  pairingView = {
    ...pairingView,
    health,
    qr,
    pane: pairingState(health, qr, pairingView.code, pairingView.error),
    countdownPct: qrCountdownPct(qrSeenAt + QR_TTL_MS, Date.now(), QR_TTL_MS),
  };
  if (pairingView.pane === "paired" && pairingView.me == null) {
    const me = (await client.getMe().catch(() => null)) as {
      name: string | null;
      pn: string | null;
    } | null;
    pairingView = { ...pairingView, me: pairedIdentityText(me) };
  }
}

function currentPairingView(): PairingView {
  return pairingView;
}

// ---- logs page (R2-1): server-side filtered pages + SSE live tail
let logsFilter: LogFilter = { ...EMPTY_LOG_FILTER };
let logsPage = 0;
let logsLive = false;
let logsStream: { close(): void } | null = null;
let logsChats: Array<{ jid: string; name: string | null }> = [];

function logsRenderInput(rows: LogRow[], hasMore: boolean): LogsPageInput {
  const people = new Map<string, string | null>();
  for (const [jid, name] of Object.entries(identityContacts)) {
    if (name !== null && name.length > 0) {
      people.set(jid, name);
    }
  }
  for (const row of rows) {
    if (row.senderJid !== null && !people.has(row.senderJid)) {
      people.set(row.senderJid, row.senderName);
    }
  }
  if (logsFilter.person.length > 0 && !people.has(logsFilter.person)) {
    people.set(logsFilter.person, null);
  }
  return {
    rows,
    filter: logsFilter,
    page: logsPage,
    hasMore,
    live: logsLive,
    chats: logsChats,
    people: [...people.entries()].map(([jid, name]) => ({ jid, name })),
    resolveName,
  };
}

function startLogsLive(): void {
  if (logsStream !== null || typeof EventSource !== "function") {
    return;
  }
  logsStream = openStatusStream({
    url: settings.bridgeUrl,
    token: effectiveToken(settings, pairingToken),
    onLine: () => undefined,
    onRaw: (raw) => {
      const tbody = document.getElementById("logs-rows");
      if (tbody === null || logsPage !== 0) {
        return;
      }
      const input = logsRenderInput([], false);
      for (const row of rowsFromUpsert(raw)) {
        if (
          matchesLogFilter(row, logsFilter) &&
          tbody.querySelector(`[data-log-id="${CSS.escape(row.id)}"]`) === null
        ) {
          tbody.insertAdjacentHTML("afterbegin", logRowHtml(row, input));
        }
      }
    },
  });
}

function stopLogsLive(): void {
  logsStream?.close();
  logsStream = null;
}

// ---- live status feed (T52): bounded SSE feed + 5s health poll
let statusFeed: FeedLine[] = [];
let connectionFormDirty = false;
let connectionSaved: string | undefined;
let statusStream: { close(): void } | null = null;
let statusPoll: ReturnType<typeof setInterval> | null = null;

function startStatusLive(): void {
  if (statusStream === null && typeof EventSource === "function") {
    statusStream = openStatusStream({
      url: settings.bridgeUrl,
      token: settings.token,
      onLine: (line) => {
        statusFeed = appendEvent(statusFeed, line);
        const list = document.querySelector("#status-dashboard .events");
        if (list !== null) {
          list.innerHTML = feedHtml(statusFeed);
        }
      },
    });
  }
  if (statusPoll === null) {
    statusPoll = setInterval(() => {
      if (location.hash !== "#/connection" || connectionFormDirty) {
        return;
      }
      void renderCurrent();
    }, 5_000);
  }
}

function stopStatusLive(): void {
  statusStream?.close();
  statusStream = null;
  if (statusPoll !== null) {
    clearInterval(statusPoll);
    statusPoll = null;
  }
}

// ---- chat experience state (T51-B)
let identityContacts: Record<string, string | null> = {};
const resolveName = (jid: string): string | null => {
  const viaIdentity = displayName(jid, identityContacts);
  return viaIdentity === "Unknown" ? null : viaIdentity;
};
async function loadIdentity(): Promise<void> {
  const payload = (await client.contacts({ limit: 1000 })) as { contacts?: ContactView[] };
  identityContacts = Object.fromEntries(
    (payload.contacts ?? []).map((contact) => [contact.jid, contact.displayName]),
  );
}
let contactsQuery = "";
let contactsSavedOnly = true;
let contactsError: string | undefined;
let contactsNotice: string | undefined;
let connectionsError: string | undefined;
let subsEditing: string | null = null;
let subsError: string | undefined;
let subsCache: SubscriptionView[] = [];
let contactsSearchTimer: ReturnType<typeof setTimeout> | null = null;
let replyToId: string | null = null;
let lastUnauthorizedRender = 0;
let bridgeDown = false;

function createClient(): ApiClient {
  return createApiClient({
    baseUrl: settings.bridgeUrl,
    token: effectiveToken(settings, pairingToken),
    onUnreachable: () => {
      bridgeDown = true;
      showBridgeDownBanner(settings.bridgeUrl);
    },
    // T54: never yank the owner to settings — the inline token form renders
    // on the current route instead (needsToken path in renderFrame). A stored
    // but INVALID token must not loop: debounce re-renders per 401 burst.
    onUnauthorized: () => {
      clearStaleTokenOnce();
      const now = Date.now();
      if (now - lastUnauthorizedRender > 500) {
        lastUnauthorizedRender = now;
        void renderCurrent();
      }
    },
  });
}

function dom() {
  const app = document.getElementById("app") as HTMLElement;
  const nav = document.getElementById("nav") as HTMLElement;
  return {
    getHash: () => location.hash,
    setHash: (hash: string) => {
      location.hash = hash;
    },
    setNav: (html: string) => {
      nav.innerHTML = html;
    },
    setApp: (html: string) => {
      app.innerHTML = html;
    },
    setTitle: (title: string) => {
      document.title = title;
    },
  };
}

async function renderCurrent(): Promise<void> {
  try {
    settings = loadSettings(localStorage);
    // every route needs the fresh ephemeral token before its loaders run
    await syncPairingToken();
    client = createClient();
    await renderFrame({ dom: dom(), settings, loaders, pairingView: currentPairingView });
    bindRoute();
    const banner = firstRunGate({
      loggedIn: lastKnownHealth.loggedIn === true,
      contactsWarm: (lastKnownHealth as { contactsWarm?: unknown }).contactsWarm !== false,
      chatCount: 0,
      hash: location.hash,
    });
    document.getElementById("link-banner")?.remove();
    if (banner.banner) {
      document
        .getElementById("app")
        ?.insertAdjacentHTML(
          "afterbegin",
          `<div id="link-banner" class="link-banner">WhatsApp not linked — <a href="#/pairing">Link now</a></div>`,
        );
    }
    if (bridgeDown) {
      const health = await client.getHealth().catch(() => null);
      if (health !== null) {
        bridgeDown = false;
        document.getElementById("bridge-down")?.remove();
      }
    }
  } catch (err) {
    console.error("render failed:", err);
    const app = document.getElementById("app");
    if (app !== null) {
      app.innerHTML = `<p class="danger">render failed: ${escapeHtml(String(err instanceof Error ? err.message : err))}</p>`;
    }
  }
}

const loaders: {
  [R in Exclude<Route, "status" | "chats" | "help">]: (
    params: Record<string, string>,
  ) => Promise<string>;
} = {
  logs: async () => {
    const [payload, chatsPayload] = await Promise.all([
      client.searchLogs(logsQuery(logsFilter, logsPage, LOGS_PAGE_SIZE)),
      client.getChats().catch(() => ({ chats: [] })) as Promise<{
        chats?: Array<{ jid: string; name: string | null }>;
      }>,
      loadIdentity().catch(() => undefined),
    ]);
    logsChats = chatsPayload.chats ?? [];
    const rows = (payload.messages ?? []) as LogRow[];
    return logsPageHtml(
      logsRenderInput(rows.slice(0, LOGS_PAGE_SIZE), rows.length > LOGS_PAGE_SIZE),
    );
  },
  connection: async () => {
    const [health, me, stats, record] = await Promise.all([
      client.getHealth(),
      client.getMe().catch(() => null),
      client.connectionStats().catch(() => null),
      client.connectionSettings().catch(() => null),
    ]);
    const saved = connectionSaved;
    connectionSaved = undefined;
    return connectionPageHtml({
      health,
      me: me as { name: string | null; pn: string | null } | null,
      stats: stats as ConnectionStatsView | null,
      settings: (record as { settings?: ConnectionSettingsView } | null)?.settings ?? null,
      events: [],
      ...(saved !== undefined ? { saved } : {}),
    });
  },
  contacts: async () => {
    const health = (await client.getHealth().catch(() => ({}))) as PairingHealth;
    const contactsWarm = (health as { contactsWarm?: unknown }).contactsWarm !== false;
    const gate = firstRunGate({
      loggedIn: health.loggedIn === true,
      contactsWarm,
      chatCount: 0,
      hash: "#/contacts",
    });
    if (gate.renderPairing) {
      await refreshPairing();
      return pairingHtml({ ...pairingView, intro: PAIRING_INTRO });
    }
    const payload = (await client.contacts({
      q: contactsQuery,
      saved: contactsSavedOnly,
      limit: CONTACTS_PAGE_SIZE,
    })) as { contacts?: ContactView[]; total?: number };
    const error = contactsError;
    const notice = contactsNotice;
    contactsError = undefined;
    contactsNotice = undefined;
    return contactsPageHtml({
      contacts: payload.contacts ?? [],
      total: payload.total ?? payload.contacts?.length ?? 0,
      query: contactsQuery,
      saved: contactsSavedOnly,
      syncing: gate.syncing,
      ...(error !== undefined ? { error } : {}),
      ...(notice !== undefined ? { notice } : {}),
    });
  },
  profile: async () => {
    const [blockPayload, privacy, me] = await Promise.all([
      client.blocklist(),
      client.privacy(),
      client.getMe(),
    ]);
    const page = profilePageHtml({
      blocklist: (blockPayload as { blocklist?: string[] }).blocklist ?? [],
      me: me as { pn: string | null; name: string | null; status: string | null },
      privacy: (privacy as { privacy?: Record<string, string> }).privacy ?? {},
    });
    return page;
  },
  chat: async (params) => {
    const payload = (await client.getMessages(params.jid ?? "", 50)) as {
      messages: Array<
        Parameters<typeof messageListHtml>[1][number] & {
          mediaType?: string | null;
          quotedMessageId?: string | null;
        }
      >;
    };
    const messages = payload.messages.map((row) => ({
      ...row,
      quoted:
        row.quotedMessageId !== undefined && row.quotedMessageId !== null
          ? { text: null, senderName: null }
          : null,
      // T78 M2/M3: the API ships the aggregate ({emote,count,senders}) + poll data
      reactions: row.reactions ?? null,
    }));
    return messageListHtml(params.jid ?? "", messages, {
      mediaToken: effectiveToken(settings, pairingToken),
    });
  },
  settings: async () => {
    const emptyConfig: {
      transcription?: {
        engine?: string;
        base_url?: string;
        model?: string;
        api_key?: string;
        api_key_set?: boolean;
      };
    } = { transcription: {} };
    const config = await client.getConfig().catch(() => emptyConfig);
    const section = config.transcription ?? {};
    return (
      settingsHtml(settings) +
      transcriptionSettingsHtml({
        engine: section.engine,
        baseUrl: section.base_url,
        model: section.model,
        apiKeyMasked: section.api_key_set === true ? section.api_key : undefined,
      })
    );
  },
  subscriptions: async () => {
    const [payload, chatsPayload, sessionsPayload] = await Promise.all([
      client.subscriptions() as Promise<{ subscriptions?: SubscriptionView[] }>,
      client.getChats().catch(() => ({ chats: [] })) as Promise<{
        chats?: Array<{ jid: string; name: string | null }>;
      }>,
      client.sessions().catch(() => ({ sessions: [] })) as Promise<{ sessions?: SessionOption[] }>,
      loadIdentity().catch(() => undefined),
    ]);
    subsCache = payload.subscriptions ?? [];
    const editing =
      subsEditing === null
        ? null
        : subsEditing === "new"
          ? ("new" as const)
          : (subsCache.find((sub) => sub.id === subsEditing) ?? null);
    const error = subsError;
    subsError = undefined;
    return subscriptionsPageHtml({
      subscriptions: subsCache,
      chats: (chatsPayload.chats ?? []).map((chat) => ({ jid: chat.jid, name: chat.name })),
      sessions: sessionsPayload.sessions ?? [],
      editing,
      resolveName,
      ...(error !== undefined ? { error } : {}),
    });
  },

  connections: async () => {
    const payload = (await client.connections()) as { connections?: ConnectionView[] };
    const error = connectionsError;
    connectionsError = undefined;
    return connectionsPageHtml({
      connections: payload.connections ?? [],
      ...(error !== undefined ? { error } : {}),
    });
  },
  pairing: async () => {
    await refreshPairing();
    return pairingHtml(pairingView);
  },
};

// T93-C1: EVERY page render is guarded — a failed load (429/5xx, error body)
// shows an in-page error banner instead of crashing the app
for (const route of Object.keys(loaders) as Array<keyof typeof loaders>) {
  loaders[route] = guardLoader(loaders[route]);
}

function bindRoute(): void {
  const hash = location.hash;
  const kind = routeKind(hash);
  if (kind === "chat-view") {
    bindSendBox();
    bindChatExtras();
    const scroller = document.querySelector("#app .messages");
    if (scroller !== null) {
      scroller.scrollTop = scroller.scrollHeight;
    }
    return;
  }
  if (hash === "#/contacts") {
    bindContactsControls();
    return;
  }
  if (hash === "#/subscriptions") {
    bindSubscriptionsControls();
    return;
  }
  if (hash === "#/connections") {
    bindConnectionsControls();
    return;
  }
  if (hash === "#/profile") {
    bindProfileControls();
    return;
  }
  if (hash === "#/connection") {
    bindConnectionControls();
    startStatusLive();
    return;
  }
  if (hash === "#/logs") {
    bindLogsControls();
    if (logsLive) {
      startLogsLive();
    }
    return;
  }
  if (hash === "#/pairing") {
    bindPairingFlow();
    return;
  }
  if (hash === "#/settings") {
    bindSettingsForm();
    bindTranscriptionForm();
  }
}

function showBridgeDownBanner(bridgeUrl: string): void {
  if (document.getElementById("bridge-down") === null) {
    document.body.insertAdjacentHTML("afterbegin", bridgeDownBanner(bridgeUrl));
  }
  startBridgeDownPoll();
}

function bindSendBox(): void {
  const form = document.querySelector("#app .send-box") as HTMLFormElement | null;
  if (form === null) {
    return;
  }
  const chatJid = form.dataset.chatJid ?? "";
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = form.querySelector("input[name=text]") as HTMLInputElement;
    const text = input.value;
    if (text.length === 0) {
      return;
    }
    form.querySelector(".send-error")?.remove();
    const quoted = replyToId;
    try {
      await client.sendMessage(
        chatJid,
        text,
        quoted !== null ? { replyToMessageId: quoted } : undefined,
      );
      input.value = "";
      replyToId = null;
      document.getElementById("reply-preview")?.remove();
      // re-fetch + re-render so the sent bubble appears immediately (T67)
      const payload = (await client.getMessages(chatJid, 50)) as {
        messages: Parameters<typeof messageListHtml>[1];
      };
      const app = document.getElementById("app");
      if (app !== null) {
        app.innerHTML = messageListHtml(chatJid, payload.messages, {
          mediaToken: effectiveToken(settings, pairingToken),
        });
        bindSendBox();
        bindChatExtras();
        input.focus();
        const scroller = app.querySelector(".messages");
        if (scroller !== null) {
          scroller.scrollTop = scroller.scrollHeight;
        }
      }
    } catch (err) {
      // keep the composer text (retry-able) and show the engine message inline
      const message = err instanceof Error ? err.message : String(err);
      form.insertAdjacentHTML(
        "beforebegin",
        chatErrorHtml(`${message} — message NOT sent, text preserved`),
      );
    }
    void client.sendPresence(chatJid, "paused").catch(() => undefined);
  });
  form.addEventListener("click", (event) => {
    if ((event.target as HTMLElement).matches("[data-dismiss-error]")) {
      form.parentElement?.querySelector(".send-error")?.remove();
    }
  });
}

async function contactWrite(action: () => Promise<unknown>): Promise<void> {
  try {
    await action();
    contactsNotice = "Saved";
    await loadIdentity().catch(() => undefined);
  } catch (err) {
    contactsError = err instanceof Error ? err.message : "could not update the contact";
  }
  await renderCurrent();
}

function bindContactsControls(): void {
  const search = document.querySelector<HTMLInputElement>("#contact-search input[name=q]");
  const rerenderKeepingFocus = async (): Promise<void> => {
    await renderCurrent();
    const next = document.querySelector<HTMLInputElement>("#contact-search input[name=q]");
    next?.focus();
    next?.setSelectionRange(next.value.length, next.value.length);
  };
  search?.addEventListener("input", () => {
    if (contactsSearchTimer !== null) {
      clearTimeout(contactsSearchTimer);
    }
    contactsSearchTimer = setTimeout(() => {
      contactsSearchTimer = null;
      contactsQuery = search.value;
      void rerenderKeepingFocus();
    }, 250);
  });
  document.getElementById("contact-search")?.addEventListener("submit", (event) => {
    event.preventDefault();
    contactsQuery = search?.value ?? "";
    void rerenderKeepingFocus();
  });
  document
    .querySelector<HTMLInputElement>("#contact-search input[name=saved]")
    ?.addEventListener("change", (event) => {
      contactsSavedOnly = (event.currentTarget as HTMLInputElement).checked;
      void renderCurrent();
    });
  document.getElementById("clear-contacts-search")?.addEventListener("click", () => {
    contactsQuery = "";
    void renderCurrent();
  });
  const form = document.getElementById("contact-new") as HTMLFormElement | null;
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const field = (key: string): string => {
      const value = data.get(key);
      return typeof value === "string" ? value : "";
    };
    const checked = validateNewContact({
      name: field("name"),
      phone: field("phone"),
      username: field("username"),
    });
    if (!checked.ok) {
      contactsError = checked.message;
      void renderCurrent();
      return;
    }
    void contactWrite(() => client.addContact(checked.value));
  });
  document.querySelectorAll<HTMLButtonElement>("[data-rename-contact]").forEach((button) => {
    button.addEventListener("click", () => {
      const jid = button.dataset.renameContact ?? "";
      const row = button.closest(".contact-row");
      if (row === null) {
        return;
      }
      row.innerHTML = contactRenameFormHtml(jid, button.dataset.contactName ?? "");
      const renameForm = row.querySelector<HTMLFormElement>(".contact-rename");
      const input = renameForm?.querySelector<HTMLInputElement>("input[name=name]");
      input?.focus();
      input?.select();
      row.querySelector("[data-cancel-rename]")?.addEventListener("click", () => {
        void renderCurrent();
      });
      renameForm?.addEventListener("submit", (event) => {
        event.preventDefault();
        const name = input?.value.trim() ?? "";
        if (name.length === 0) {
          return;
        }
        void contactWrite(() => client.renameContact(jid, name));
      });
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-remove-contact]").forEach((button) => {
    button.addEventListener("click", () => {
      const jid = button.dataset.removeContact ?? "";
      const label = button.dataset.contactName ?? jid;
      if (!window.confirm(`Remove ${label} from your WhatsApp contacts?`)) {
        return;
      }
      void contactWrite(() => client.removeContact(jid));
    });
  });
}

function bindConnectionsControls(): void {
  document.querySelectorAll<HTMLAnchorElement>("[data-logs-chat]").forEach((link) => {
    link.addEventListener("click", () => {
      logsFilter = { ...EMPTY_LOG_FILTER, chat: link.dataset.logsChat ?? "" };
      logsPage = 0;
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-disconnect-kind]").forEach((button) => {
    button.addEventListener("click", async () => {
      const kind = button.dataset.disconnectKind ?? "";
      const agent = button.dataset.disconnectAgent ?? "";
      const label = button.dataset.disconnectLabel ?? agent;
      const what = kind === "hooks" ? "hook" : "MCP registration";
      if (
        !window.confirm(`Disconnect ${label}? This removes the wa-mcp ${what} from its config.`)
      ) {
        return;
      }
      button.disabled = true;
      try {
        await client.disconnectConnection(kind, agent, button.dataset.disconnectSub);
      } catch (err) {
        connectionsError = `could not disconnect ${label}: ${err instanceof Error ? err.message : String(err)}`;
      }
      await renderCurrent();
    });
  });
}

function bindProfileControls(): void {
  document.getElementById("save-name")?.addEventListener("click", async () => {
    const name = (document.getElementById("me-name") as HTMLInputElement | null)?.value ?? "";
    if (name.length === 0) {
      return;
    }
    try {
      await client.setProfileName(name);
      showProfileSaved("name saved");
    } catch (err) {
      showProfileError(err);
    }
  });
  document.getElementById("save-status")?.addEventListener("click", async () => {
    const status = (document.getElementById("me-status") as HTMLInputElement | null)?.value ?? "";
    try {
      await client.setProfileStatus(status);
      showProfileSaved("status saved");
    } catch (err) {
      showProfileError(err);
    }
  });
  document.querySelectorAll<HTMLSelectElement>("select[data-privacy-key]").forEach((select) => {
    select.addEventListener("change", async () => {
      const key = select.dataset.privacyKey ?? "";
      try {
        await client.setPrivacy(buildPrivacyPatch(key, select.value));
        showProfileSaved(`${key} set to ${select.value}`);
      } catch (err) {
        showProfileError(err);
      }
    });
  });
  document.getElementById("block-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const raw =
      (document.querySelector("#block-form input[name=chat_jid]") as HTMLInputElement | null)
        ?.value ?? "";
    const jid = blockTargetJid(raw);
    if (jid === null) {
      showProfileError(
        new Error("Enter a phone number with the country code, like +44 7700 900123"),
      );
      return;
    }
    try {
      await client.block(jid);
      await renderCurrent();
    } catch (err) {
      showProfileError(err);
    }
  });
  document.querySelectorAll("[data-unblock-jid]").forEach((button) => {
    button.addEventListener("click", async () => {
      const jid = (button as HTMLElement).dataset.unblockJid ?? "";
      await client.unblock(jid).catch(() => undefined);
      await renderCurrent();
    });
  });
}

function showProfileSaved(message: string): void {
  const slot = document.getElementById("profile-save-status");
  if (slot !== null) {
    slot.textContent = message;
    slot.className = "save-flash ok";
  }
}

function showProfileError(err: unknown): void {
  const slot = document.getElementById("profile-save-status");
  if (slot !== null) {
    slot.textContent = err instanceof Error ? err.message : "save failed";
    slot.className = "save-flash danger";
  }
}

function bindLogsControls(): void {
  const form = document.getElementById("logs-filter") as HTMLFormElement | null;
  form?.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const field = (name: string): string => {
      const value = data.get(name);
      return typeof value === "string" ? value : "";
    };
    const direction = field("direction");
    logsFilter = {
      chat: field("chat"),
      person: field("person"),
      direction: direction === "in" || direction === "out" ? direction : "",
      since: field("since"),
      until: field("until"),
      q: field("q"),
    };
    logsPage = 0;
    void renderCurrent();
  });
  document.getElementById("logs-reset")?.addEventListener("click", () => {
    logsFilter = { ...EMPTY_LOG_FILTER };
    logsPage = 0;
    void renderCurrent();
  });
  document.getElementById("logs-prev")?.addEventListener("click", () => {
    logsPage = Math.max(0, logsPage - 1);
    void renderCurrent();
  });
  document.getElementById("logs-next")?.addEventListener("click", () => {
    logsPage += 1;
    void renderCurrent();
  });
  document.getElementById("logs-live")?.addEventListener("change", (event) => {
    logsLive = (event.target as HTMLInputElement).checked;
    if (logsLive) {
      startLogsLive();
    } else {
      stopLogsLive();
    }
  });
}

function showConnectionStatus(message: string, ok: boolean): void {
  const slot = document.getElementById("connection-settings-status");
  if (slot !== null) {
    slot.textContent = message;
    slot.className = `save-flash ${ok ? "ok" : "danger"}`;
  }
}

function bindConnectionControls(): void {
  connectionFormDirty = false;
  const form = document.getElementById("connection-settings-form") as HTMLFormElement | null;
  form?.addEventListener("input", () => {
    connectionFormDirty = true;
  });
  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const read = readConnectionSettingsForm((name) => {
      const value = data.get(name);
      return typeof value === "string" ? value : null;
    });
    if (!read.ok) {
      showConnectionStatus(read.message, false);
      return;
    }
    try {
      await client.saveConnectionSettings(read.value);
      connectionFormDirty = false;
      connectionSaved = "Settings saved";
      await renderCurrent();
    } catch (err) {
      showConnectionStatus(err instanceof Error ? err.message : "save failed", false);
    }
  });
}

function bindChatExtras(): void {
  // reply-to: click a message to quote it; send carries reply_to_message_id
  document.querySelectorAll("#app .message").forEach((item) => {
    item.addEventListener("click", (event) => {
      if ((event.target as HTMLElement).closest("button")) {
        return;
      }
      replyToId = (item as HTMLElement).dataset.id ?? null;
      const form = document.querySelector("#app .send-box") as HTMLFormElement | null;
      if (form !== null) {
        document.getElementById("reply-preview")?.remove();
        if (replyToId !== null) {
          const sender = (item.querySelector(".sender") as HTMLElement | null)?.textContent ?? null;
          const text = (item.querySelector(".text") as HTMLElement | null)?.textContent ?? null;
          form.insertAdjacentHTML("beforebegin", replyPreviewHtml({ senderName: sender, text }));
          document.getElementById("cancel-reply")?.addEventListener("click", () => {
            replyToId = null;
            document.getElementById("reply-preview")?.remove();
          });
        }
        const input = form.querySelector("input[name=text]") as HTMLInputElement | null;
        input?.focus();
      }
    });
  });
  // context: ±5 around a message
  document.querySelectorAll("#app .context-btn").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const messageId = (button as HTMLElement).dataset.contextId ?? "";
      const chatJid = location.hash.slice("#/chat/".length);
      const context = (await client.getContext(decodeURIComponent(chatJid), messageId, 5)) as {
        messages?: Array<{
          id: string;
          chatJid?: string;
          senderName?: string | null;
          timestamp?: string;
          content?: string | null;
          isFromMe?: boolean;
        }>;
      };
      const existing = document.getElementById("context-view");
      if (existing !== null) {
        existing.remove();
        return;
      }
      const container = document.querySelector("#app .messages");
      if (container === null) {
        return;
      }
      container.insertAdjacentHTML(
        "afterend",
        contextViewHtml(
          messageId,
          (context.messages ?? []).map((m) => ({
            id: m.id,
            chatJid: m.chatJid ?? decodeURIComponent(chatJid),
            senderName: m.senderName ?? null,
            timestamp: m.timestamp ?? "",
            content: m.content ?? null,
            isFromMe: m.isFromMe ?? false,
          })),
        ),
      );
    });
  });
  // media download + voice-note transcription
  document.querySelectorAll("#app .media-btn").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const id = (button as HTMLElement).dataset.downloadId ?? "";
      await client.downloadMedia(id).catch(() => undefined);
      (button as HTMLButtonElement).textContent = "downloaded ✓";
    });
  });
  document.querySelectorAll("#app .transcribe-btn").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const id = (button as HTMLElement).dataset.transcribeId ?? "";
      const payload = (await client.transcribe(id).catch(() => null)) as {
        transcript?: string;
      } | null;
      const target = document.querySelector(`[data-transcript-for="${id}"]`);
      if (target !== null) {
        target.textContent = payload?.transcript ?? "(transcription unavailable)";
      }
    });
  });
}

function bindPairingFlow(): void {
  bindSettingsForm();
  bindTranscriptionForm();
  const phoneForm = document.getElementById("phone-form") as HTMLFormElement | null;
  phoneForm?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const phone = (document.getElementById("phone-input") as HTMLInputElement).value.replace(
      /\D/g,
      "",
    );
    try {
      const payload = await client.pairingCode(phone);
      if (payload.code !== undefined) {
        pairingView = { ...pairingView, code: payload.code, pane: "methods" };
      } else {
        pairingView = {
          ...pairingView,
          error: payload.error?.message ?? "pairing code request failed",
          pane: "error",
        };
      }
    } catch (err) {
      pairingView = {
        ...pairingView,
        error: err instanceof Error ? err.message : String(err),
        pane: "error",
      };
    }
    await rerenderPairing();
  });
  document.getElementById("resume-pairing")?.addEventListener("click", async () => {
    await client.resumePairing().catch(() => undefined);
    pairingView = { ...pairingView, error: null, code: null };
    await rerenderPairing();
  });
  document.getElementById("unlink-device")?.addEventListener("click", () => {
    if (window.confirm("Unlink this computer? You will need to scan the QR again.")) {
      void client.logout().then(() => renderCurrent());
    }
  });
  document.getElementById("pairing-retry")?.addEventListener("click", () => {
    pairingView = { ...pairingView, error: null, code: null };
    void rerenderPairing();
  });
  for (const button of document.querySelectorAll<HTMLButtonElement>(".copy-cmd")) {
    button.addEventListener("click", () => {
      const cmd = button.dataset.copyCmd ?? "";
      void navigator.clipboard?.writeText(cmd).catch(() => undefined);
    });
  }
  document.querySelector("#pairing .copy-btn")?.addEventListener("click", (event) => {
    const url = (event.currentTarget as HTMLElement).dataset.copyUrl ?? "";
    void navigator.clipboard?.writeText(url).catch(() => undefined);
  });
  if (pairingPoller === null) {
    pairingPoller = createPairingPoller(
      {
        fetchHealth: async () => {
          await refreshPairing();
          return pairingView;
        },
        derive: (view) => {
          const pairing = view as PairingViewLike;
          return {
            pane: pairing.pane,
            qr: pairing.qr.qr,
            code: pairing.code ?? null,
            error: pairing.error ?? null,
            me: pairing.me ?? null,
            attempts: pairing.health.pairingAttempts?.used ?? null,
          };
        },
        render: (_view, rewrite) => {
          if (!rewrite || location.hash !== "#/pairing") {
            return;
          }
          const app = document.getElementById("app");
          if (app !== null) {
            app.innerHTML = pairingHtml(pairingView);
            bindPairingFlow();
          }
        },
        focused: () => {
          const active = document.activeElement;
          return (
            active instanceof HTMLElement && active.closest("#phone-form, #link-input") !== null
          );
        },
      },
      3_000,
    );
    pairingPoller.start();
  }
}

type PairingViewLike = {
  pane: string;
  qr: { qr: string | null };
  code?: string | null;
  error?: string | null;
  me?: string | null;
  health: { pairingAttempts?: { used: number } };
};

async function rerenderPairing(): Promise<void> {
  await refreshPairing();
  const app = document.getElementById("app");
  if (app !== null && location.hash === "#/pairing") {
    app.innerHTML = pairingHtml(pairingView);
    bindPairingFlow();
  }
}

function bindTranscriptionForm(): void {
  const form = document.getElementById("transcription-form") as HTMLFormElement | null;
  if (form === null) {
    return;
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const engine = (document.getElementById("transcription-engine") as HTMLInputElement).value;
    const baseUrl = (document.getElementById("transcription-base-url") as HTMLInputElement).value;
    const model = (document.getElementById("transcription-model") as HTMLInputElement).value;
    const apiKey = (document.getElementById("transcription-api-key") as HTMLInputElement).value;
    void client
      .saveConfig({
        transcription: {
          engine,
          base_url: baseUrl,
          model,
          api_key: apiKey,
        },
      })
      .then(() => {
        location.reload();
      })
      .catch((err: unknown) => {
        const hint = document.querySelector("#transcription-form .hint");
        if (hint !== null) {
          hint.textContent = `save failed: ${err instanceof Error ? err.message : String(err)}`;
        }
      });
  });
}

function bindSettingsForm(): void {
  const form = document.getElementById("settings-form") as HTMLFormElement | null;
  if (form === null) {
    return;
  }
  document.getElementById("reveal-token")?.addEventListener("click", () => {
    const input = document.getElementById("token") as HTMLInputElement | null;
    const reveal = document.getElementById("reveal-token") as HTMLButtonElement | null;
    if (input === null || reveal === null) {
      return;
    }
    const hidden = input.type === "password";
    input.type = hidden ? "text" : "password";
    reveal.textContent = hidden ? "hide" : "show";
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const bridgeUrl = (document.getElementById("bridge-url") as HTMLInputElement).value;
    const token = (document.getElementById("token") as HTMLInputElement).value;
    saveSettings(localStorage, { bridgeUrl, token });
    location.reload();
  });
}

document.addEventListener("click", (event) => {
  const target = event.target as HTMLElement;
  if (target.closest(".banner-retry")) {
    void renderCurrent();
    return;
  }
  const copyButton = target.closest<HTMLButtonElement>(".copy-hook, .copy-cmd");
  if (copyButton !== null) {
    const original = copyButton.textContent ?? "Copy";
    copyButton.textContent = "Copied ✓";
    window.setTimeout(() => {
      copyButton.textContent = original;
    }, 2_000);
  }
});
let bridgeDownPoll: ReturnType<typeof setInterval> | null = null;
function startBridgeDownPoll(): void {
  if (bridgeDownPoll !== null) {
    return;
  }
  bridgeDownPoll = setInterval(() => {
    void client
      .getHealth()
      .then(() => {
        if (bridgeDownPoll !== null) {
          clearInterval(bridgeDownPoll);
          bridgeDownPoll = null;
        }
        bridgeDown = false;
        document.getElementById("bridge-down")?.remove();
        void renderCurrent();
      })
      .catch(() => undefined);
  }, 2_000);
}

window.addEventListener("hashchange", () => {
  if (location.hash !== "#/connection") {
    stopStatusLive();
  }
  if (location.hash !== "#/logs") {
    stopLogsLive();
  }
  if (pairingPoller !== null && location.hash !== "#/pairing") {
    pairingPoller.stop();
    pairingPoller = null;
    qrSeenAt = 0;
  }
  void renderCurrent();
});
void renderCurrent();

function errorText(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

async function subsWrite(action: () => Promise<unknown>, closeForm = false): Promise<void> {
  try {
    await action();
    if (closeForm) {
      subsEditing = null;
    }
  } catch (err) {
    subsError = `could not save the subscription: ${errorText(err)}`;
  }
  await renderCurrent();
}

function bindSubscriptionsControls(): void {
  document.getElementById("new-subscription")?.addEventListener("click", () => {
    subsEditing = "new";
    void renderCurrent();
  });
  document.querySelectorAll<HTMLButtonElement>("[data-edit-sub]").forEach((button) => {
    button.addEventListener("click", () => {
      subsEditing = button.dataset.editSub ?? null;
      void renderCurrent();
    });
  });
  document.querySelector("[data-cancel-sub]")?.addEventListener("click", () => {
    subsEditing = null;
    void renderCurrent();
  });
  document.querySelectorAll<HTMLInputElement>("[data-toggle-sub]").forEach((toggle) => {
    toggle.addEventListener("change", () => {
      const id = toggle.dataset.toggleSub ?? "";
      void subsWrite(() => client.updateSubscription(id, { enabled: toggle.checked }));
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-delete-sub]").forEach((button) => {
    button.addEventListener("click", () => {
      const id = button.dataset.deleteSub ?? "";
      if (!window.confirm(`Delete the subscription “${button.dataset.subName ?? id}”?`)) {
        return;
      }
      if (subsEditing === id) {
        subsEditing = null;
      }
      void subsWrite(() => client.deleteSubscription(id));
    });
  });
  document.querySelectorAll<HTMLButtonElement>("[data-test-sub]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = button.dataset.testSub ?? "";
      const status = document.querySelector<HTMLElement>(`[data-test-status="${CSS.escape(id)}"]`);
      if (status !== null) {
        status.textContent = "sending…";
      }
      try {
        const result = await client.testSubscription(id);
        if (status !== null) {
          status.textContent =
            result.inboxPath === null
              ? "test delivered ✓ · agent started"
              : `test delivered ✓ · ${result.totalLines} events in the file`;
        }
      } catch (err) {
        if (status !== null) {
          status.textContent = errorText(err).includes("429")
            ? "one test per 10s — try again in a moment"
            : `couldn't send: ${errorText(err)}`;
        }
      }
    });
  });
  document
    .querySelectorAll<HTMLButtonElement>("#subscriptions-page .copy-cmd")
    .forEach((button) => {
      button.addEventListener("click", () => {
        void navigator.clipboard?.writeText(button.dataset.copyCmd ?? "").catch(() => undefined);
      });
    });
  const form = document.getElementById("subscription-form") as HTMLFormElement | null;
  if (form === null) {
    return;
  }
  form.querySelector("#sub-chat-filter")?.addEventListener("input", (event) => {
    const needle = (event.target as HTMLInputElement).value.trim().toLowerCase();
    form.querySelectorAll<HTMLElement>(".sub-chat-row").forEach((row) => {
      row.style.display = (row.textContent ?? "").toLowerCase().includes(needle) ? "" : "none";
    });
  });
  form.querySelector<HTMLInputElement>("input[name=like]")?.addEventListener("input", (event) => {
    const preview = document.getElementById("like-preview");
    if (preview !== null) {
      preview.textContent = likePreview((event.target as HTMLInputElement).value);
    }
  });
  form.querySelectorAll<HTMLInputElement>("input[name=mode]").forEach((radio) => {
    radio.addEventListener("change", () => {
      form.querySelectorAll<HTMLElement>("[data-mode-config]").forEach((panel) => {
        panel.hidden = panel.dataset.modeConfig !== radio.value;
      });
    });
  });
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const data = new FormData(form);
    const text = (name: string): string => {
      const value = data.get(name);
      return typeof value === "string" ? value : "";
    };
    const id = form.dataset.subId ?? "";
    const existing = subsCache.find((sub) => sub.id === id);
    const result = readSubscriptionForm(
      {
        name: text("name"),
        chats: data.getAll("chats").filter((jid): jid is string => typeof jid === "string"),
        allChats: data.get("all_chats") === "on",
        like: text("like"),
        mentionOnly: data.get("mention_only") === "on",
        prompt: text("prompt"),
        mode: text("mode"),
        session: text("session"),
        command: text("command"),
        args: text("args"),
        env: text("env"),
        enabled: existing?.enabled ?? true,
      },
      { editing: id.length > 0 },
    );
    if (!result.ok) {
      subsError = result.message;
      void renderCurrent();
      return;
    }
    void subsWrite(
      () =>
        id.length > 0
          ? client.updateSubscription(id, result.value)
          : client.createSubscription(result.value),
      true,
    );
  });
}
