import { expect, test } from "vite-plus/test";
import { connectionPageHtml } from "../src/connection.ts";

test("T163 S3 — the status page never paints a token value", () => {
  const html = connectionPageHtml({
    health: {
      status: "connected",
      connected: true,
      loggedIn: true,
      uptime: 60,
      uiBootstrapToken: "a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4e5f6a1b2",
      pairingToken: "pair-secret-value",
    },
    me: null,
    stats: null,
    settings: null,
    events: [],
  });
  expect(html).not.toContain("a1b2c3d4e5f6");
  expect(html).not.toContain("pair-secret-value");
  expect(html).not.toContain("uiBootstrapToken");
});
