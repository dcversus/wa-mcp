import { expect, test } from "vite-plus/test";
import { renderFrame, ROUTES, type AppDom } from "../src/app.ts";
import { resolveRoute } from "../src/router.ts";
import { navHtml, NAV_TITLES, profilePageHtml } from "../src/pages.ts";
import {
  connectionPageHtml,
  readConnectionSettingsForm,
  type ConnectionPageView,
} from "../src/connection.ts";

const DEFAULT_CONNECTION_SETTINGS = {
  humanisation: {
    enabled: false,
    minDelayMs: 1500,
    maxDelayMs: 8000,
    typingStatus: true,
    delayPerCharMs: 60,
  },
  sendLimits: { enabled: false, perMinute: 30, perHour: 120, perDay: 500, perChatPerDay: null },
};

const LINKED = {
  loggedIn: true,
  connected: true,
  uptime: 3725,
  reconnects: 2,
  status: "connected",
};

function view(overrides: Partial<ConnectionPageView> = {}): ConnectionPageView {
  return {
    health: LINKED,
    me: { name: "Vasilisa", pn: "358497773518" },
    stats: {
      status: "connected",
      uptime: 3725,
      reconnects: 2,
      lastDisconnectAt: null,
      sentToday: 12,
      receivedToday: 340,
    },
    settings: DEFAULT_CONNECTION_SETTINGS,
    events: [],
    ...overrides,
  };
}

test("T181 C — profile: card layout with initials avatar, formatted phone, labelled fields and save feedback", () => {
  const html = profilePageHtml({
    blocklist: [],
    me: { pn: "358497773518@s.whatsapp.net", name: "Vasilisa Versus", status: "On a break" },
    privacy: { last: "contacts" },
  });
  expect(html).toContain('<div class="profile-grid">');
  expect(html).toContain('<div class="panel me-card">');
  expect(html).toContain('<span class="avatar avatar-lg" aria-hidden="true">VV</span>');
  expect(html).toContain('<h3 class="me-title">Vasilisa Versus</h3>');
  expect(html).toContain(
    '<p class="me-phone">+358 49 777 3518 · <code id="me-phone">358497773518@s.whatsapp.net</code></p>',
  );
  expect(html).toContain(
    '<input id="me-name" value="Vasilisa Versus" aria-label="Display name" />',
  );
  expect(html).toContain('<button id="save-name" type="button">Save name</button>');
  expect(html).toContain('aria-label="About"');
  expect(html).toContain('<button id="save-status" type="button">Save about</button>');
  expect(html).toContain(
    '<span id="profile-save-status" class="save-flash" role="status" aria-live="polite"></span>',
  );
  expect((html.match(/<h1>/g) ?? []).length).toBe(1);
});

test("T181 C — profile: privacy panel with WhatsApp labels; blocklist rows show the number and an Unblock button", () => {
  const html = profilePageHtml({
    blocklist: ["358401112222@s.whatsapp.net"],
    me: { pn: null, name: null, status: null },
    privacy: { last: "contacts", groupadd: "contacts" },
  });
  expect(html).toContain('<div class="panel"><h3>Privacy</h3>');
  expect(html).toContain("Changes save as soon as you pick an option.");
  expect(html).toContain('<option value="contacts" selected>My contacts</option>');
  expect(html).toContain("Who can add me to groups");
  expect(html).toContain('<div class="panel"><h3>Blocked contacts</h3>');
  expect(html).toContain(
    '<li data-blocked-jid="358401112222@s.whatsapp.net"><span class="blocked-who"><strong>+358 40 111 2222</strong><code>358401112222@s.whatsapp.net</code></span><button type="button" data-unblock-jid="358401112222@s.whatsapp.net" aria-label="Unblock +358 40 111 2222">Unblock</button></li>',
  );
  expect(html).toContain('<h3 class="me-title">Your profile</h3>');
  const empty = profilePageHtml({ blocklist: [], privacy: {} });
  expect(empty).toContain('<div class="empty-state">No blocked contacts</div>');
});

test("T181 D — connection page: status card, stats, connect-new links, settings form bound to the model", () => {
  const html = connectionPageHtml(view());
  expect(html).toContain('<section id="connection-page"><h1>Connection</h1>');
  expect(html).toContain("✅ Linked as <strong>Vasilisa (+358 49 777 3518)</strong>");
  expect(html).toContain('<div class="panel" id="connection-stats"><h2>Today</h2>');
  for (const [label, value] of [
    ["Messages sent", "12"],
    ["Messages received", "340"],
    ["Uptime", "1 h 2 m"],
    ["Reconnects", "2"],
  ]) {
    expect(html).toContain(`<div class="stat"><dt>${label}</dt><dd>${value}</dd></div>`);
  }
  expect(html).toContain('<div class="panel" id="connect-new"><h2>Connect a phone</h2>');
  expect(html).toContain('<a class="button" href="#/pairing">Link with a QR code</a>');
  expect(html).toContain(
    '<a class="button secondary" href="#/pairing">Link with a phone-number code</a>',
  );
  expect(html).toContain("WA_CHANNEL=cloud");
  expect(html).toContain('<form id="connection-settings-form" class="panel">');
  expect(html).toContain('<input type="checkbox" name="humanisation.enabled" />');
  expect(html).toContain('<input type="checkbox" name="humanisation.typingStatus" checked />');
  expect(html).toContain('name="humanisation.minDelayMs" value="1500"');
  expect(html).toContain('name="humanisation.maxDelayMs" value="8000"');
  expect(html).toContain('name="humanisation.delayPerCharMs" value="60"');
  expect(html).toContain('<input type="checkbox" name="sendLimits.enabled" />');
  expect(html).toContain('name="sendLimits.perMinute" value="30"');
  expect(html).toContain('name="sendLimits.perHour" value="120"');
  expect(html).toContain('name="sendLimits.perDay" value="500"');
  expect(html).toContain('name="sendLimits.perChatPerDay" value="" placeholder="no cap"');
  expect(html).toContain('<button type="submit">Save settings</button>');
  expect(html).toContain('<div id="status-dashboard" class="panel">');
  expect(html).toContain("<h2>Recent activity</h2>");
});

test("T181 D — connection page: enabled settings render checked; save feedback and errors; unlinked shows the link prompt", () => {
  const on = connectionPageHtml(
    view({
      settings: {
        humanisation: { ...DEFAULT_CONNECTION_SETTINGS.humanisation, enabled: true },
        sendLimits: { ...DEFAULT_CONNECTION_SETTINGS.sendLimits, enabled: true, perChatPerDay: 40 },
      },
      saved: "Settings saved",
    }),
  );
  expect(on).toContain('<input type="checkbox" name="humanisation.enabled" checked />');
  expect(on).toContain('<input type="checkbox" name="sendLimits.enabled" checked />');
  expect(on).toContain('name="sendLimits.perChatPerDay" value="40"');
  expect(on).toContain(
    '<span id="connection-settings-status" class="save-flash ok" role="status" aria-live="polite">Settings saved</span>',
  );
  const failed = connectionPageHtml(view({ error: "humanisation.minDelayMs <b>bad</b>" }));
  expect(failed).toContain('class="save-flash danger"');
  expect(failed).toContain("humanisation.minDelayMs &lt;b&gt;bad&lt;/b&gt;");
  const unlinked = connectionPageHtml(
    view({ health: { loggedIn: false }, me: null, stats: null, settings: null }),
  );
  expect(unlinked).toContain('⚠ WhatsApp not linked — <a href="#/pairing">Link now</a>');
  expect(unlinked).toContain(
    '<div class="empty-state">Stats appear once the bridge is running with a store</div>',
  );
  expect(unlinked).toContain(
    '<div class="empty-state">Settings are unavailable — the bridge has no store attached</div>',
  );
  expect(unlinked).not.toContain("connection-settings-form");
});

test("T181 D — readConnectionSettingsForm: checkboxes, numbers, empty per-chat cap is null, bad numbers error", () => {
  const values: Record<string, string> = {
    "humanisation.enabled": "on",
    "humanisation.minDelayMs": "800",
    "humanisation.maxDelayMs": "6000",
    "humanisation.delayPerCharMs": "50",
    "sendLimits.perMinute": "20",
    "sendLimits.perHour": "100",
    "sendLimits.perDay": "400",
    "sendLimits.perChatPerDay": "",
  };
  expect(readConnectionSettingsForm((name) => values[name] ?? null)).toEqual({
    ok: true,
    value: {
      humanisation: {
        enabled: true,
        typingStatus: false,
        minDelayMs: 800,
        maxDelayMs: 6000,
        delayPerCharMs: 50,
      },
      sendLimits: { enabled: false, perMinute: 20, perHour: 100, perDay: 400, perChatPerDay: null },
    },
  });
  expect(
    readConnectionSettingsForm((name) =>
      name === "sendLimits.perDay" ? "lots" : (values[name] ?? null),
    ),
  ).toEqual({ ok: false, message: "Per day must be a whole number" });
});

test("T181 D — nav: System holds a single Connection entry (no separate Link phone); title is Connection", () => {
  const html = navHtml("connection");
  expect(html).toContain(
    '<a href="#/connection" class="active" aria-current="page" data-nav="connection">Connection</a>',
  );
  expect(html).not.toContain("#/status");
  expect(html).not.toContain("Link phone");
  expect(NAV_TITLES.connection).toBe("Connection");
  expect(resolveRoute("#/connection", ROUTES)?.route).toBe("connection");
});

function fakeDom(hash: string): {
  dom: AppDom;
  state: { hash: string; app: string; title: string };
} {
  const state = { hash, app: "", title: "" };
  return {
    state,
    dom: {
      getHash: () => state.hash,
      setHash: (next) => {
        state.hash = next;
      },
      setNav: () => {},
      setApp: (html) => {
        state.app = html;
      },
      setTitle: (title) => {
        state.title = title;
      },
    },
  };
}

test("T181 D — #/status redirects to #/connection; the connection route renders its loader or the fallback", async () => {
  const old = fakeDom("#/status");
  await renderFrame({
    dom: old.dom,
    settings: { bridgeUrl: "", token: "t" },
    loaders: { connection: async () => "<p>loaded</p>" },
  });
  expect(old.state.hash).toBe("#/connection");
  const loaded = fakeDom("#/connection");
  await renderFrame({
    dom: loaded.dom,
    settings: { bridgeUrl: "", token: "t" },
    loaders: { connection: async () => "<p>loaded</p>" },
  });
  expect(loaded.state.app).toBe("<p>loaded</p>");
  expect(loaded.state.title).toBe("Connection · wa-mcp");
  const fallback = fakeDom("#/connection");
  await renderFrame({ dom: fallback.dom, settings: { bridgeUrl: "", token: "t" }, loaders: {} });
  expect(fallback.state.app).toContain('<section id="connection-page">');
});

test("T181 C/D — styles: pages are panel stacks; grids, wide avatar, field rows, link buttons, settings fieldsets", async () => {
  const { readFileSync } = await import("node:fs");
  const css = readFileSync(new URL("../src/styles.css", import.meta.url), "utf8");
  for (const selector of [
    "#profile-page,\n#connection-page {",
    ".panel {",
    ".profile-grid {",
    ".card-grid {",
    ".avatar-lg {",
    ".field-row {",
    ".blocked-who {",
    "a.button {",
    "a.button.secondary {",
    ".field-grid {",
    "#connection-settings-form fieldset {",
  ]) {
    expect(css).toContain(selector);
  }
});
