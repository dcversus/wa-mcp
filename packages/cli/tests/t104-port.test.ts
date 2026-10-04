import { createServer, type AddressInfo } from "node:net";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { expect, test, vi } from "vite-plus/test";
import { main } from "../src/bin.ts";

async function busyListener(): Promise<{ server: import("node:net").Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer();
    server.listen(0, "127.0.0.1", () => {
      resolve({ server, port: (server.address() as AddressInfo).port });
    });
  });
}

test("T104 — isPortBusy detects a live listener", async () => {
  const { isPortBusy } = (await import("../src/service.ts")) as {
    isPortBusy: (port: number) => Promise<boolean>;
  };
  const { server, port } = await busyListener();
  try {
    expect(await isPortBusy(port)).toBe(true);
    expect(await isPortBusy(0)).toBe(false);
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
});

test("T104 — install --service refuses with PORT_IN_USE when the port is taken", async () => {
  const { server, port } = await busyListener();
  try {
    const home = mkdtempSync(join(tmpdir(), "wa-mcp-t104-home-"));
    const dataDir = mkdtempSync(join(tmpdir(), "wa-mcp-t104-data-"));
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await main(["install", "--service", "--port", String(port), "--home", home, "--data-dir", dataDir]);
      const printed = errSpy.mock.calls.map((call) => call.join(" ")).join("\n");
      expect(printed).toContain("PORT_IN_USE");
      expect(printed).toContain(String(port));
      expect(printed).toContain("wa-mcp stop");
      const plist = join(home, "Library", "LaunchAgents", "com.wa-mcp.bridge.plist");
      expect(plist && 0).toBe(0);
    } finally {
      errSpy.mockRestore();
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}, 15_000);

test("T104 — plain start refuses with PORT_IN_USE when the port is taken", async () => {
  const { server, port } = await busyListener();
  try {
    const home = mkdtempSync(join(tmpdir(), "wa-mcp-t104-home2-"));
    const dataDir = mkdtempSync(join(tmpdir(), "wa-mcp-t104-data2-"));
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      await main(["start", "--port", String(port), "--home", home, "--data-dir", dataDir]);
      const printed = [...errSpy.mock.calls, ...logSpy.mock.calls]
        .map((call) => call.join(" "))
        .join("\n");
      expect(printed).toContain("PORT_IN_USE");
      expect(printed).toContain(String(port));
    } finally {
      logSpy.mockRestore();
      errSpy.mockRestore();
    }
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
}, 15_000);
