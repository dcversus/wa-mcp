import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { main } from "../src/bin.ts";
import { startReport } from "../src/service.ts";
import { writeServerEntry } from "../src/writers.ts";

afterEach(() => {
  vi.restoreAllMocks();
});

function installedArgs(extra: string[]): string[] {
  const home = mkdtempSync(join(tmpdir(), "t186-"));
  vi.spyOn(console, "log").mockImplementation(() => {});
  return [home, ...extra];
}

test("T186 A — install writes the explicit default bridge URL (27777) into host configs", async () => {
  const [home = ""] = installedArgs([]);
  await main(["install", "--home", home, "--target", "claude-code", "--token", "t"]);
  const config = JSON.parse(readFileSync(join(home, ".claude.json"), "utf8")) as {
    mcpServers: Record<string, { args: string[] }>;
  };
  const args = config.mcpServers["wa-mcp"]?.args ?? [];
  expect(args[args.indexOf("--bridge-url") + 1]).toBe("http://127.0.0.1:27777");
});

test("T186 A — install --port 8080 still writes an explicit 8080 URL", async () => {
  const [home = ""] = installedArgs([]);
  await main([
    "install",
    "--home",
    home,
    "--target",
    "claude-code",
    "--token",
    "t",
    "--port",
    "8080",
  ]);
  const raw = readFileSync(join(home, ".claude.json"), "utf8");
  expect(raw).toContain('"http://127.0.0.1:8080"');
});

test("T186 A — antigravity's serverUrl follows the bridge URL instead of a hardcoded port", () => {
  const home = mkdtempSync(join(tmpdir(), "t186-ag-"));
  const result = writeServerEntry("antigravity", {
    home,
    spec: {
      command: "node",
      args: ["bin.mjs", "--bridge-url", "http://127.0.0.1:31337", "--token", "t"],
    },
  });
  expect(readFileSync(result.path, "utf8")).toContain('"serverUrl": "http://127.0.0.1:31337/mcp"');
});

test("T186 B — the start report prints whichever port the daemon got", () => {
  expect(startReport(1, "27777", "/d/bridge.log")[1]).toBe(
    "Web UI: http://127.0.0.1:27777 — open it to link WhatsApp",
  );
});
