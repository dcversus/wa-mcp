import "./styles.css";
import { renderFrame, type Route } from "./app.ts";
import { createApiClient, type ApiClient } from "./api.ts";
import {
  chatListHtml,
  contactsPageHtml,
  groupsPageHtml,
  messageListHtml,
  qrHtml,
  settingsHtml,
  statusDashboardHtml,
  unreadHtml,
} from "./pages.ts";
import { loadSettings, saveSettings, type WebSettings } from "./state.ts";

let settings: WebSettings = loadSettings(localStorage);
let client: ApiClient = createClient();

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
  await renderFrame({ dom: dom(), settings, loaders });
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
    const qr = await client.getQr();
    return qrHtml(qr.png === null ? null : `data:image/png;base64,${qr.png}`);
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
    // inline token form (rendered when no token is stored) saves + reloads
    // into the QR view on the same route
    bindSettingsForm();
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
  void renderCurrent();
});
void renderCurrent();
