import {
  contactsPageHtml,
  groupsPageHtml,
  navHtml,
  settingsHtml,
  statusDashboardHtml,
} from "./pages.ts";
import { pairingHtml as fullPairingHtml, type PairingView } from "./pages-pairing.ts";
import { needsToken, type WebSettings } from "./state.ts";
import { resolveRoute, type RoutePattern } from "./router.ts";

export interface AppDom {
  getHash(): string;
  setHash(hash: string): void;
  setNav(html: string): void;
  setApp(html: string): void;
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
  { route: "pairing", pattern: "pairing" },
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
  dom.setNav(navHtml(match?.route ?? "status"));
  if (match === null) {
    dom.setApp("<p>not found</p>");
    return;
  }
  if (match.route !== "settings" && match.route !== "pairing" && needsToken(settings)) {
    // pairing is the PUBLIC surface (ephemeral pairingToken, T53): it renders
    // tokenless; every account route still redirects to settings
    dom.setHash("#/settings");
    dom.setApp(settingsHtml(settings));
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
          : undefined);
  if (loader === undefined) {
    dom.setApp("<p>not implemented</p>");
    return;
  }
  dom.setApp(await loader(match.params));
}
