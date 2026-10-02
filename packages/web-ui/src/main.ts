import "./styles.css";
import { renderFrame, type Route } from "./app.ts";
import { createApiClient, type ApiClient } from "./api.ts";
import {
  chatListHtml,
  contactsPageHtml,
  groupsPageHtml,
  messageListHtml,
  settingsHtml,
  statusDashboardHtml,
  unreadHtml,
} from "./pages.ts";
import {
  pairingHtml,
  pairingState,
  qrCountdownPct,
  type PairingHealth,
  type PairingView,
} from "./pages-pairing.ts";
import { loadSettings, saveSettings, type WebSettings } from "./state.ts";

let settings: WebSettings = loadSettings(localStorage);
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

async function refreshPairing(): Promise<void> {
  const health = (await client.getHealth().catch(() => ({}))) as PairingHealth;
  const qr = await client
    .getQr()
    .catch(() => ({ qr: null as string | null, png: null as string | null }));
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

function createClient(): ApiClient {
  return createApiClient({
    baseUrl: settings.bridgeUrl,
    token: settings.token,
    onUnauthorized: () => {
      location.hash = "#/settings";
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
  settings = loadSettings(localStorage);
  client = createClient();
  await renderFrame({ dom: dom(), settings, loaders, pairingView: currentPairingView });
  bindRoute();
}

const loaders: {
  [R in Route]: (params: Record<string, string>) => Promise<string>;
} = {
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
    const payload = (await client.contacts()) as {
      contacts?: Array<{ jid: string; name: string | null }>;
    };
    return contactsPageHtml(payload.contacts ?? []);
  },
  groups: async () => {
    const payload = (await client.getChats()) as {
      chats?: Array<{ jid: string; name: string | null; unreadCount: number }>;
    };
    return groupsPageHtml((payload.chats ?? []).filter((chat) => chat.jid.endsWith("@g.us")));
  },
  chats: async () => {
    const payload = (await client.getChats()) as { chats: Parameters<typeof chatListHtml>[0] };
    return chatListHtml(payload.chats);
  },
  chat: async (params) => {
    const payload = (await client.getMessages(params.jid ?? "", 50)) as {
      messages: Parameters<typeof messageListHtml>[1];
    };
    return messageListHtml(params.jid ?? "", payload.messages);
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

function bindSendBox(): void {
  const form = document.querySelector("#app .send-box") as HTMLFormElement | null;
  if (form === null) {
    return;
  }
  const chatJid = form.dataset.chatJid ?? "";
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    const input = form.querySelector("input[name=text]") as HTMLInputElement;
    await client.sendMessage(chatJid, input.value);
    input.value = "";
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
  if (pairingPoll !== null && location.hash !== "#/pairing") {
    clearInterval(pairingPoll);
    pairingPoll = null;
    qrSeenAt = 0;
  }
  void renderCurrent();
});
void renderCurrent();
