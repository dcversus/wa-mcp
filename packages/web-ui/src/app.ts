import {
  contactsPageHtml,
  subscriptionsPageHtml,
  groupsPageHtml,
  navHtml,
  notFoundHtml,
  settingsHtml,
  statusDashboardHtml,
  agentConnectHtml,
  automationsPageHtml,
  NAV_TITLES,
} from "./pages.ts";
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
  | "chats"
  | "chat"
  | "unread"
  | "contacts"
  | "groups"
  | "profile"
  | "settings"
  | "health"
  | "logs"
  | "subscriptions"
  | "connect"
  | "automations"
  | "pairing";

export const ROUTES: Array<RoutePattern<Route>> = [
  { route: "status", pattern: "status" },
  { route: "chats", pattern: "chats" },
  { route: "chat", pattern: "chat/:jid" },
  { route: "unread", pattern: "unread" },
  { route: "contacts", pattern: "contacts" },
  { route: "groups", pattern: "groups" },
  { route: "profile", pattern: "profile" },
  { route: "settings", pattern: "settings" },
  { route: "health", pattern: "health" },
  { route: "logs", pattern: "logs" },
  { route: "subscriptions", pattern: "subscriptions" },
  { route: "connect", pattern: "connect" },
  { route: "automations", pattern: "automations" },
  { route: "pairing", pattern: "pairing" },
];

const REDIRECTS: Partial<Record<Route, string>> = {
  unread: "#/chats",
  health: "#/status",
};

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
  if (match !== null && REDIRECTS[match.route] !== undefined) {
    dom.setHash(REDIRECTS[match.route] as string);
    return;
  }
  dom.setNav(navHtml(match?.route ?? ""));
  if (match === null) {
    dom.setTitle("Not found · wa-mcp");
    dom.setApp(notFoundHtml(dom.getHash()));
    return;
  }
  dom.setTitle(`${NAV_TITLES[match.route] ?? "wa-mcp"} · wa-mcp`);
  if (match.route === "connect") {
    dom.setApp(agentConnectHtml());
    return;
  }
  if (match.route === "automations") {
    const automationsLoader: (params: Record<string, string>) => Promise<string> =
      loaders.automations ??
      (async () =>
        automationsPageHtml({ autoreplies: [], scheduled: [], sendRules: [], rules: [] }));
    dom.setApp(await automationsLoader({}));
    return;
  }
  if (match.route === "settings") {
    dom.setApp(settingsHtml(settings));
    return;
  }
  const pairingViewRef = io.pairingView;
  if (match.route === "pairing" && pairingViewRef !== undefined) {
    dom.setApp(fullPairingHtml(pairingViewRef()));
    return;
  }
  const loader =
    loaders[match.route] ??
    (match.route === "status"
      ? async () => statusDashboardHtml({ health: {}, notifications: [], events: [] })
      : match.route === "contacts"
        ? async () => contactsPageHtml([])
        : match.route === "groups"
          ? async () => groupsPageHtml([])
          : match.route === "subscriptions"
            ? async () => subscriptionsPageHtml([])
            : undefined);
  if (loader === undefined) {
    dom.setApp("<p>not implemented</p>");
    return;
  }
  dom.setApp('<div class="skeleton">loading…</div>');
  dom.setApp(await loader(match.params));
}
