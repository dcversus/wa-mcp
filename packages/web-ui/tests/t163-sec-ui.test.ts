import { expect, test } from "vite-plus/test";
import { statusDashboardHtml, settingsHtml } from "../src/pages.ts";

test("T163 S3 — the status page never paints a token value", () => {
  const html = statusDashboardHtml({
    health: {
      status: "connected",
      connected: true,
      loggedIn: true,
      uptime: 60,
      uiBootstrapToken: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      pairingToken: "pair-secret-value",
    },
    notifications: [],
    events: [],
  });
  expect(html).not.toContain("a1b2c3d4e5f6");
  expect(html).not.toContain("pair-secret-value");
  expect(html).not.toContain("uiBootstrapToken");
});

test("T163 S3 — the settings token field is a password input with a reveal control", () => {
  const html = settingsHtml({ bridgeUrl: "http://127.0.0.1:8080", token: "sekrit" });
  expect(html).toContain('type="password"');
  expect(html).toContain('id="reveal-token"');
});
