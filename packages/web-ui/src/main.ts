import { createApiClient } from "./api.ts";
import {
  chatListHtml,
  healthHtml,
  messageListHtml,
  qrHtml,
  settingsHtml,
  unreadHtml,
} from "./pages.ts";
import { resolveRoute, type RoutePattern } from "./router.ts";
import { loadSettings, needsToken, saveSettings, type WebSettings } from "./state.ts";

type Route = "chats" | "chat" | "unread" | "settings" | "health" | "pairing";

const ROUTES: Array<RoutePattern<Route>> = [
  { route: "chats", pattern: "chats" },
  { route: "chat", pattern: "chat/:jid" },
  { route: "unread", pattern: "unread" },
  { route: "settings", pattern: "settings" },
  { route: "health", pattern: "health" },
  { route: "pairing", pattern: "pairing" },
];

const NAV_HTML = `<a href="#/chats">Chats</a><a href="#/unread">Unread</a><a href="#/health">Health</a><a href="#/pairing">Pairing</a><a href="#/settings">Settings</a>`;

function mount(): { app: HTMLElement; settings: WebSettings } {
  const app = document.getElementById("app") as HTMLElement;
  const settings = loadSettings(localStorage);
  return { app, settings };
}

function clientFor(settings: WebSettings, reroute: () => void) {
  return createApiClient({
    baseUrl: settings.bridgeUrl,
    token: settings.token,
    onUnauthorized: reroute,
  });
}

async function renderCurrent(): Promise<void> {
  const { app, settings } = mount();
  if (needsToken(settings)) {
    location.hash = "#/settings";
    return;
  }
  const match = resolveRoute(location.hash, ROUTES);
  if (match === null) {
    app.innerHTML = "<p>not found</p>";
    return;
  }
  const client = clientFor(settings, () => {
    location.hash = "#/settings";
  });
  if (match.route === "settings") {
    app.innerHTML = settingsHtml(settings) + NAV_HTML;
    const form = document.getElementById("settings-form") as HTMLFormElement;
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      const bridgeUrl = (document.getElementById("bridge-url") as HTMLInputElement).value;
      const token = (document.getElementById("token") as HTMLInputElement).value;
      saveSettings(localStorage, { bridgeUrl, token });
      location.hash = "#/chats";
    });
    return;
  }
  if (match.route === "pairing") {
    app.innerHTML = qrHtml(null) + NAV_HTML;
    const poll = setInterval(async () => {
      try {
        const qr = await client.getQr();
        if (qr.png !== null) {
          const img = document.getElementById("qr-image") as HTMLImageElement;
          img.src = `data:image/png;base64,${qr.png}`;
          const status = document.getElementById("qr-status");
          if (status) status.textContent = "scan with your phone";
        }
      } catch {
        /* keep polling */
      }
    }, 2000);
    window.addEventListener("hashchange", () => clearInterval(poll), { once: true });
    return;
  }
  if (match.route === "health") {
    app.innerHTML = "<p>loading…</p>" + NAV_HTML;
    const health = await client.getHealth();
    app.innerHTML = healthHtml(health) + NAV_HTML;
    return;
  }
  if (match.route === "chats") {
    app.innerHTML = "<p>loading…</p>" + NAV_HTML;
    const payload = (await client.getChats()) as { chats: Parameters<typeof chatListHtml>[0] };
    app.innerHTML = chatListHtml(payload.chats) + NAV_HTML;
    app.querySelectorAll("li[data-jid]").forEach((item) => {
      item.addEventListener("click", () => {
        location.hash = `#/chat/${encodeURIComponent((item as HTMLElement).dataset.jid ?? "")}`;
      });
    });
    return;
  }
  if (match.route === "chat") {
    const jid = match.params.jid ?? "";
    app.innerHTML = "<p>loading…</p>" + NAV_HTML;
    const payload = (await client.getMessages(jid, 50)) as {
      messages: Parameters<typeof messageListHtml>[1];
    };
    app.innerHTML = messageListHtml(jid, payload.messages) + NAV_HTML;
    const form = app.querySelector(".send-box") as HTMLFormElement;
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const input = form.querySelector("input[name=text]") as HTMLInputElement;
      await client.sendMessage(jid, input.value);
      input.value = "";
      await renderCurrent();
    });
    return;
  }
  if (match.route === "unread") {
    app.innerHTML = "<p>loading…</p>" + NAV_HTML;
    const payload = (await client.getUnread()) as {
      unread: Array<{ chatJid: string; unreadCount: number }>;
    };
    app.innerHTML = unreadHtml(payload.unread) + NAV_HTML;
    app.querySelectorAll("button[data-mark-jid]").forEach((button) => {
      button.addEventListener("click", async () => {
        const chatJid = (button as HTMLElement).dataset.markJid ?? "";
        const messages = (await client.getMessages(chatJid, 200)) as {
          messages: Array<{ id: string; isUnread: boolean }>;
        };
        const unreadIds = messages.messages
          .filter((message) => message.isUnread)
          .map((message) => message.id);
        if (unreadIds.length > 0) {
          await client.markRead(chatJid, unreadIds);
        }
        await renderCurrent();
      });
    });
    return;
  }
}

window.addEventListener("hashchange", () => {
  void renderCurrent();
});
void renderCurrent();
