import { navHtml, notFoundHtml, settingsHtml, NAV_TITLES } from "./pages.ts";
import { helpPageHtml } from "./help.ts";
import { connectionPageHtml } from "./connection.ts";
import { contactsPageHtml } from "./contacts.ts";
import { connectionsPageHtml } from "./connections.ts";
import { subscriptionsPageHtml } from "./subscriptions.ts";
import { pairingHtml as fullPairingHtml, type PairingView } from "./pages-pairing.ts";
import { type WebSettings } from "./state.ts";
import { resolveRoute, type RoutePattern } from "./router.ts";

export interface AppDom {
  getHash(): string;
  setHash(hash: string): void;
  setNav(html: string): void;
  setApp(html: string): void;
  setTitle(title: string): void;
}

export type Route =
  | "status"
  | "connection"
  | "chats"
  | "chat"
  | "contacts"
  | "profile"
  | "settings"
  | "logs"
  | "subscriptions"
  | "connections"
  | "pairing"
  | "help";

export const ROUTES: Array<RoutePattern<Route>> = [
  { route: "status", pattern: "status" },
  { route: "connection", pattern: "connection" },
  { route: "chats", pattern: "chats" },
  { route: "chat", pattern: "chat/:jid" },
  { route: "contacts", pattern: "contacts" },
  { route: "profile", pattern: "profile" },
  { route: "settings", pattern: "settings" },
  { route: "logs", pattern: "logs" },
  { route: "subscriptions", pattern: "subscriptions" },
  { route: "connections", pattern: "connections" },
  { route: "pairing", pattern: "pairing" },
  { route: "help", pattern: "help" },
];

export type RouteLoaders = Partial<
  Record<Route, (params: Record<string, string>) => Promise<string>>
>;

export interface RenderFrameIo {
  dom: AppDom;
  settings: WebSettings;
  loaders: RouteLoaders;
  /** live pairing view (poll-updated in main.ts); absent in pure tests */
  pairingView?: () => PairingView;
}

export async function renderFrame(io: RenderFrameIo): Promise<void> {
  const { dom, settings, loaders } = io;
  const match = resolveRoute(dom.getHash(), ROUTES);
  if (match?.route === "status") {
    dom.setHash("#/connection");
    return;
  }
  dom.setNav(navHtml(match?.route ?? ""));
  if (match === null) {
    dom.setTitle("Not found · wa-mcp");
    dom.setApp(notFoundHtml(dom.getHash()));
    return;
  }
  dom.setTitle(`${NAV_TITLES[match.route] ?? "wa-mcp"} · wa-mcp`);
  if (match.route === "settings") {
    dom.setApp(settingsHtml(settings));
    return;
  }
  if (match.route === "help") {
    dom.setApp(helpPageHtml());
    return;
  }
  const pairingViewRef = io.pairingView;
  if (match.route === "pairing" && pairingViewRef !== undefined) {
    dom.setApp(fullPairingHtml(pairingViewRef()));
    return;
  }
  const loader =
    loaders[match.route] ??
    (match.route === "connection"
      ? async () =>
          connectionPageHtml({ health: {}, me: null, stats: null, settings: null, events: [] })
      : match.route === "contacts"
        ? async () => contactsPageHtml({ contacts: [], total: 0, query: "", saved: true })
        : match.route === "subscriptions"
          ? async () =>
              subscriptionsPageHtml({ subscriptions: [], chats: [], sessions: [], editing: null })
          : match.route === "connections"
            ? async () => connectionsPageHtml({ connections: [] })
            : undefined);
  if (loader === undefined) {
    dom.setApp("<p>not implemented</p>");
    return;
  }
  dom.setApp('<div class="skeleton">loading…</div>');
  dom.setApp(await loader(match.params));
}
