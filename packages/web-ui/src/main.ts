import "./styles.css";
import { renderFrame, type Route } from "./app.ts";
import { createApiClient, type ApiClient } from "./api.ts";
import {
  bridgeDownBanner,
  chatErrorHtml,
  chatListHtml,
  contextViewHtml,
  eventsPageHtml,
  groupMetaFormHtml,
  groupParticipantsHtml,
  privacyMatrixHtml,
  profilePageHtml,
  contactsPageHtml,
  groupsPageHtml,
  messageListHtml,
  settingsHtml,
  statusDashboardHtml,
  unreadHtml,
  guardLoader,
} from "./pages.ts";
import {
  pairingHtml,
  pairingPossible,
  pairingState,
  qrCountdownPct,
  type PairingHealth,
  type PairingView,
} from "./pages-pairing.ts";
import { appendEvent, feedHtml, openStatusStream, type FeedLine } from "./events-feed.ts";
import {
  effectiveToken,
  loadPairingToken,
  loadSettings,
  savePairingToken,
  saveSettings,
  type WebSettings,
} from "./state.ts";

let settings: WebSettings = loadSettings(localStorage);
// the ephemeral pairing token (from the public /health) powers the pairing
// surface until a real session token is stored in settings
let pairingToken = loadPairingToken(localStorage);
let client: ApiClient = createClient();

// ---- live pairing state (T51-A): poll /health + /api/qr while on #/pairing
const QR_TTL_MS = 20_000;
let qrSeenAt = 0;
let pairingPoll: ReturnType<typeof setInterval> | null = null;
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
async function syncPairingToken(): Promise<void> {
  const health = (await client.getHealth().catch(() => ({}))) as PairingHealth;
  adoptPairingToken(health);
  if (health.loggedIn === true) {
    await exchangeAccountToken();
  }
}

// ADR 0012: one exchange attempt per page load — a 401/403 (unpaired daemon,
// or the UI reached from a non-loopback origin) leaves the UI on the pairing
// flow instead of retrying in a loop.
let accountTokenExchanged = false;
async function exchangeAccountToken(): Promise<void> {
  if (accountTokenExchanged || settings.token.length > 0) {
    return;
  }
  accountTokenExchanged = true;
  try {
    const res = await client.uiToken();
    if (typeof res.token === "string" && res.token.length > 0) {
      settings = { ...settings, token: res.token };
      saveSettings(localStorage, settings);
      client = createClient();
    }
  } catch {
    // pairing not finished yet, or non-loopback view — pairing flow handles it
  }
}

function adoptPairingToken(health: PairingHealth): void {
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
}

function currentPairingView(): PairingView {
  return pairingView;
}

// ---- live events feed (T52 module) — bounded, pausable
let eventsPaused = false;
let eventsLines: import("./events-feed.ts").FeedLine[] = [];
let eventsStream: { close(): void } | null = null;

function eventsFeedLines(): FeedLine[] {
  return eventsLines;
}

function startEventsLive(): void {
  if (eventsStream === null && typeof EventSource === "function") {
    statusFeed = appendEvent(statusFeed, { at: Date.now(), type: "events", detail: "stream open" });
    eventsStream = openStatusStream({
      url: settings.bridgeUrl,
      token: effectiveToken(settings, pairingToken),
      onLine: (line) => {
        if (eventsPaused) return;
        eventsLines.push(line);
        const list = document.querySelector("#events-feed");
        if (list !== null) {
          list.innerHTML = eventsLines
            .map(
              (l) =>
                `<li><time>${new Date(l.at).toISOString()}</time> <strong>${l.type}</strong></li>`,
            )
            .join("");
        }
      },
    });
  }
  if (eventsPoll === null) {
    eventsPoll = setInterval(() => {
      if (location.hash === "#/events") void renderCurrent();
    }, 5_000);
  }
}

function stopEventsLive(): void {
  eventsStream?.close();
  eventsStream = null;
  if (eventsPoll !== null) {
    clearInterval(eventsPoll);
    eventsPoll = null;
  }
}

// ---- live status feed (T52): bounded SSE feed + 5s health poll
let statusFeed: FeedLine[] = [];
let statusStream: { close(): void } | null = null;
let statusPoll: ReturnType<typeof setInterval> | null = null;
let eventsPoll: ReturnType<typeof setInterval> | null = null;

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
      if (location.hash !== "#/status" && location.hash !== "#/health") {
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
let chatsShowArchived = false;
let chatSearchQuery = "";
let contactsQuery = "";
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
      app.innerHTML = `<p class="danger">render failed: ${String(err instanceof Error ? err.message : err)}</p>`;
    }
  }
}

const loaders: {
  [R in Route]: (params: Record<string, string>) => Promise<string>;
} = {
  events: async () => eventsPageHtml(eventsFeedLines()),
  status: async () => {
    const [health, notifications] = await Promise.all([
      client.getHealth(),
      client.notifications().catch(() => ({ rules: [] })),
    ]);
    return statusDashboardHtml({
      health,
      notifications:
        (notifications as { rules?: Array<{ id: string; chat_jid?: string; pattern?: string }> })
          .rules ?? [],
      events: [],
    });
  },
  contacts: async () => {
    const payload = (await client.contacts(contactsQuery)) as {
      contacts?: Array<{ jid: string; name: string | null }>;
    };
    return contactsPageHtml(payload.contacts ?? []);
  },
  profile: async () => {
    const [blockPayload, privacy] = await Promise.all([
      client.blocklist().catch(() => ({ blocklist: [] })),
      client.privacy().catch(() => ({})),
    ]);
    const page = profilePageHtml({
      blocklist: (blockPayload as { blocklist?: string[] }).blocklist ?? [],
    });
    const matrix = privacyMatrixHtml(
      (privacy as { privacy?: Record<string, string> }).privacy ?? {},
    );
    return page.replace("</section>", `${matrix}</section>`);
  },
  groups: async () => {
    const payload = (await client.getChats()) as {
      chats?: Array<{ jid: string; name: string | null; unreadCount: number }>;
    };
    return groupsPageHtml((payload.chats ?? []).filter((chat) => chat.jid.endsWith("@g.us")));
  },
  // group subject/description edit + participants view are bound in
  // bindGroupsControls via /api/group/info + /api/group/meta
  chats: async () => {
    const payload = (await client.getChats()) as {
      chats: Parameters<typeof chatListHtml>[0];
    };
    return chatListHtml(payload.chats, {
      showArchived: chatsShowArchived,
      query: chatSearchQuery,
    });
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
  unread: async () => {
    const payload = (await client.getUnread()) as { unread: Parameters<typeof unreadHtml>[0] };
    return unreadHtml(payload.unread);
  },
  settings: async () => settingsHtml(settings),
  health: async () =>
    statusDashboardHtml({ health: await client.getHealth(), notifications: [], events: [] }),
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
  if (hash.startsWith("#/chat")) {
    bindSendBox();
    return;
  }
  if (hash === "#/chats") {
    bindChatClicks();
    return;
  }
  if (hash === "#/unread") {
    bindMarkRead();
    bindMarkAllRead();
    return;
  }
  if (hash === "#/chats") {
    bindChatsControls();
    return;
  }
  if (hash.startsWith("#/chat")) {
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
  if (hash === "#/groups") {
    bindGroupsControls();
    return;
  }
  if (hash === "#/profile") {
    bindProfileControls();
    return;
  }
  if (hash === "#/status" || hash === "#/health") {
    bindStatusControls();
    startStatusLive();
    return;
  }
  if (hash === "#/events") {
    bindEventsControls();
    startEventsLive();
    return;
  }
  if (hash === "#/pairing") {
    bindPairingFlow();
    return;
  }
  if (hash === "#/settings") {
    bindSettingsForm();
  }
}

function bindChatClicks(): void {
  document.querySelectorAll("#app li[data-jid]").forEach((item) => {
    item.addEventListener("click", () => {
      location.hash = `#/chat/${encodeURIComponent((item as HTMLElement).dataset.jid ?? "")}`;
    });
  });
}

function showBridgeDownBanner(bridgeUrl: string): void {
  if (document.getElementById("bridge-down") === null) {
    document.body.insertAdjacentHTML("afterbegin", bridgeDownBanner(bridgeUrl));
  }
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
    try {
      await client.sendMessage(chatJid, replyToId !== null ? `> ${replyToId}\n${text}` : text);
      input.value = "";
      replyToId = null;
      // re-fetch + re-render so the sent bubble appears immediately (T67)
      const payload = (await client.getMessages(chatJid, 50)) as {
        messages: Parameters<typeof messageListHtml>[1];
      };
      const app = document.getElementById("app");
      if (app !== null) {
        app.innerHTML = messageListHtml(chatJid, payload.messages);
        bindSendBox();
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

function bindContactsControls(): void {
  document.getElementById("contact-search")?.addEventListener("submit", (event) => {
    event.preventDefault();
    contactsQuery = (
      document.querySelector("#contact-search input[name=query]") as HTMLInputElement
    ).value;
    void renderCurrent();
  });
  document.querySelectorAll("[data-alias-jid]").forEach((button) => {
    button.addEventListener("click", async () => {
      const jid = (button as HTMLElement).dataset.aliasJid ?? "";
      const alias = window.prompt(`alias for ${jid}`);
      if (alias !== null && alias.length > 0) {
        await client.setAlias(jid, alias).catch(() => undefined);
        await renderCurrent();
      }
    });
  });
}

function bindGroupsControls(): void {
  document.getElementById("group-create")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const subject = (
      document.querySelector("#group-create input[name=subject]") as HTMLInputElement
    ).value;
    if (subject.length > 0) {
      await client.groupCreate(subject, []).catch(() => undefined);
      await renderCurrent();
    }
  });
  document.querySelectorAll("[data-leave-jid]").forEach((button) => {
    button.addEventListener("click", async () => {
      const jid = (button as HTMLElement).dataset.leaveJid ?? "";
      if (window.confirm(`leave group ${jid}?`)) {
        await client.groupLeave(jid).catch(() => undefined);
        await renderCurrent();
      }
    });
  });
  document.querySelectorAll("[data-group-jid]").forEach((item) => {
    item.addEventListener("click", async (event) => {
      if ((event.target as HTMLElement).closest("button, a")) {
        return;
      }
      const jid = (item as HTMLElement).dataset.groupJid ?? "";
      const meta = (await client.groupInfo(jid).catch(() => null)) as {
        participants?: Array<{ id?: string; admin?: string | null }> | Array<string>;
        subject?: string;
        description?: string;
      } | null;
      const list = (meta?.participants ?? []).map((p) =>
        typeof p === "string" ? { id: p } : { id: p.id ?? "", isAdmin: Boolean(p.admin) },
      );
      const panel = document.getElementById("group-participants");
      if (panel !== null) {
        panel.remove();
        return;
      }
      item.insertAdjacentHTML(
        "afterend",
        groupParticipantsHtml(jid, list) +
          groupMetaFormHtml(jid, meta?.subject ?? "", meta?.description ?? ""),
      );
      bindParticipantsControls();
      bindGroupMetaControls(jid);
    });
  });
}

function bindParticipantsControls(): void {
  document.getElementById("participant-add")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = document.querySelector(
      "#participant-add input[name=participant]",
    ) as HTMLInputElement;
    const groupJid = (document.querySelector("[data-add-participant]") as HTMLElement).dataset
      .addParticipant;
    if (input.value.length > 0 && groupJid !== undefined) {
      await client.groupParticipants(groupJid).catch(() => undefined);
      input.value = "";
    }
  });
  document.querySelectorAll("[data-remove-participant]").forEach((button) => {
    button.addEventListener("click", () => undefined);
  });
  document.querySelectorAll("[data-promote-participant]").forEach((button) => {
    button.addEventListener("click", () => undefined);
  });
}

function bindProfileControls(): void {
  document.getElementById("name-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = (document.querySelector("#name-form input[name=name]") as HTMLInputElement).value;
    if (name.length > 0) {
      await client.setProfileName(name).catch(() => undefined);
    }
  });
  document.getElementById("privacy-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const value = (
      document.querySelector("#privacy-form select[name=privacy_value]") as HTMLSelectElement
    ).value;
    await client.setPrivacy("read_receipts", value).catch(() => undefined);
  });
  document.getElementById("block-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const jid = (document.querySelector("#block-form input[name=chat_jid]") as HTMLInputElement)
      .value;
    if (jid.length > 0) {
      await client.block(jid).catch(() => undefined);
      await renderCurrent();
    }
  });
  document.querySelectorAll("[data-unblock-jid]").forEach((button) => {
    button.addEventListener("click", async () => {
      const jid = (button as HTMLElement).dataset.unblockJid ?? "";
      await client.block(jid).catch(() => undefined);
      await renderCurrent();
    });
  });
}

function bindEventsControls(): void {
  document.getElementById("events-pause")?.addEventListener("click", (event) => {
    eventsPaused = !eventsPaused;
    (event.currentTarget as HTMLButtonElement).textContent = eventsPaused ? "resume" : "pause";
  });
  document.getElementById("events-clear")?.addEventListener("click", () => {
    eventsLines = [];
    const list = document.querySelector("#events-feed");
    if (list !== null) list.innerHTML = "";
  });
}

function bindStatusControls(): void {
  document.querySelectorAll("[data-delete-rule]").forEach((button) => {
    button.addEventListener("click", async () => {
      const id = (button as HTMLElement).dataset.deleteRule ?? "";
      await client.deleteNotification(id).catch(() => undefined);
      await renderCurrent();
    });
  });
}

function bindChatsControls(): void {
  document.getElementById("chat-search")?.addEventListener("submit", (event) => {
    event.preventDefault();
    chatSearchQuery = (document.querySelector("#chat-search input[name=query]") as HTMLInputElement)
      .value;
    void renderCurrent();
  });
  document.getElementById("archived-toggle")?.addEventListener("change", (event) => {
    chatsShowArchived = (event.currentTarget as HTMLInputElement).checked;
    void renderCurrent();
  });
}

function bindMarkAllRead(): void {
  document.getElementById("mark-all-read")?.addEventListener("click", async () => {
    const payload = (await client.getUnread()) as {
      unread: Array<{ chatJid: string; unreadCount: number }>;
    };
    for (const entry of payload.unread) {
      const messages = (await client.getMessages(entry.chatJid, 200)) as {
        messages: Array<{ id: string; isUnread: boolean }>;
      };
      const unreadIds = messages.messages.filter((m) => m.isUnread).map((m) => m.id);
      if (unreadIds.length > 0) {
        await client.markRead(entry.chatJid, unreadIds).catch(() => undefined);
      }
    }
    await renderCurrent();
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
      const input = document.querySelector("#app .send-box input") as HTMLInputElement | null;
      if (input !== null) {
        input.placeholder =
          replyToId !== null ? `replying to ${replyToId.slice(0, 12)}…` : "message";
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

function bindGroupMetaControls(groupJid: string): void {
  document.getElementById("group-meta-edit")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const subject = (form.querySelector("input[name=subject]") as HTMLInputElement).value;
    const description = (form.querySelector("input[name=description]") as HTMLInputElement).value;
    await client.groupMeta(groupJid, { subject, description }).catch(() => undefined);
    await renderCurrent();
  });
}

function bindMarkRead(): void {
  document.querySelectorAll("#app button[data-mark-jid]").forEach((button) => {
    button.addEventListener("click", async () => {
      const chatJid = (button as HTMLElement).dataset.markJid ?? "";
      const payload = (await client.getMessages(chatJid, 200)) as {
        messages: Array<{ id: string; isUnread: boolean }>;
      };
      const unreadIds = payload.messages
        .filter((message) => message.isUnread)
        .map((message) => message.id);
      if (unreadIds.length > 0) {
        await client.markRead(chatJid, unreadIds);
      }
      await renderCurrent();
    });
  });
}

function bindPairingFlow(): void {
  bindSettingsForm();
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
  document.querySelector("#pairing .copy-btn")?.addEventListener("click", (event) => {
    const url = (event.currentTarget as HTMLElement).dataset.copyUrl ?? "";
    void navigator.clipboard?.writeText(url).catch(() => undefined);
  });
  pairingPoll = setInterval(() => {
    void (async () => {
      await refreshPairing();
      if (location.hash === "#/pairing") {
        await rerenderPairing();
      }
    })();
  }, 3_000);
}

async function rerenderPairing(): Promise<void> {
  await refreshPairing();
  const app = document.getElementById("app");
  if (app !== null && location.hash === "#/pairing") {
    app.innerHTML = pairingHtml(pairingView);
    bindPairingFlow();
  }
}

function bindSettingsForm(): void {
  const form = document.getElementById("settings-form") as HTMLFormElement | null;
  if (form === null) {
    return;
  }
  form.addEventListener("submit", (event) => {
    event.preventDefault();
    const bridgeUrl = (document.getElementById("bridge-url") as HTMLInputElement).value;
    const token = (document.getElementById("token") as HTMLInputElement).value;
    saveSettings(localStorage, { bridgeUrl, token });
    location.reload();
  });
}

window.addEventListener("hashchange", () => {
  if (location.hash !== "#/status" && location.hash !== "#/health") {
    stopStatusLive();
  }
  if (location.hash !== "#/events") {
    stopEventsLive();
  }
  if (pairingPoll !== null && location.hash !== "#/pairing") {
    clearInterval(pairingPoll);
    pairingPoll = null;
    qrSeenAt = 0;
  }
  void renderCurrent();
});
void renderCurrent();
