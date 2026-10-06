import { expect, test } from "vite-plus/test";
import { startReport } from "../src/service.ts";

test("T153 F17 — start prints the pid line and the web-UI next step", () => {
  const lines = startReport(4242, "8080", "/data/bridge.log");
  expect(lines[0]).toBe("bridge started (pid 4242); logs: /data/bridge.log");
  expect(lines[1]).toBe("Web UI: http://127.0.0.1:8080 — open it to link WhatsApp");
});

test("T153 F17 — a custom port lands in the UI URL", () => {
  const lines = startReport(1, "9090", "/data/bridge.log");
  expect(lines[1]).toContain("127.0.0.1:9090");
});
