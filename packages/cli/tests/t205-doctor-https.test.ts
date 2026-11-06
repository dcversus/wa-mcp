import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { createServer, type Server } from "node:https";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, expect, test } from "vite-plus/test";
import { ensureLocalCert } from "@wa-mcp/shared/tls-cert";
import { runDoctor } from "../src/doctor.ts";

const cleanups: Array<() => void> = [];
afterEach(() => {
  for (const fn of cleanups.splice(0)) fn();
});

function tempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "wa-mcp-t205d-"));
  cleanups.push(() => rmSync(dir, { recursive: true, force: true }));
  return dir;
}

function listen(
  cert: string,
  key: string,
  status: number,
): Promise<{ server: Server; port: number }> {
  return new Promise((resolve) => {
    const server = createServer({ cert, key }, (req, res) => {
      req.resume();
      res.writeHead(status, { "content-type": "application/json" });
      res.end(
        JSON.stringify({ jsonrpc: "2.0", id: 1, result: { serverInfo: { name: "wa-mcp" } } }),
      );
    });
    server.listen(0, "127.0.0.1", () => {
      cleanups.push(() => {
        if (server.listening) server.close();
      });
      resolve({ server, port: (server.address() as { port: number }).port });
    });
  });
}

const healthy = (async () => new Response("{}")) as unknown as typeof fetch;

async function doctor(home: string, dataDir: string, port: number) {
  writeFileSync(join(dataDir, "token"), "tok");
  return runDoctor({
    home,
    dataDir,
    bridgeUrl: `http://127.0.0.1:${port}`,
    fetchFn: healthy,
    minNodeMajor: 1,
  });
}
const check = (
  report: { checks: Array<{ name: string; ok: boolean; detail: string }> },
  name: string,
) => report.checks.find((item) => item.name === name);

test("doctor confirms the HTTPS endpoint with the generated certificate", async () => {
  const dataDir = tempDir();
  const { cert, key } = ensureLocalCert(dataDir);
  const { port } = await listen(cert, key, 200);
  const report = await doctor(tempDir(), dataDir, port);
  expect(check(report, "mcp https")).toMatchObject({ ok: true });
  expect(check(report, "mcp https")?.detail).toContain(`https://127.0.0.1:${port}/mcp`);
});

test("a daemon that isn't serving TLS yet fails with the fix", async () => {
  const dataDir = tempDir();
  ensureLocalCert(dataDir);
  const other = ensureLocalCert(tempDir());
  const closed = await listen(other.cert, other.key, 200);
  await new Promise((resolve) => closed.server.close(resolve));
  const report = await doctor(tempDir(), dataDir, closed.port);
  expect(check(report, "mcp https")?.ok).toBe(false);
  expect(check(report, "mcp https")?.detail).toContain("wa-mcp restart");
});

test("no certificate yet is not a failure: stdio installs keep working", async () => {
  const report = await doctor(tempDir(), tempDir(), 1);
  expect(check(report, "mcp https")).toMatchObject({ ok: true });
  expect(check(report, "mcp https")?.detail).toContain("wa-mcp install");
});

test("entries still spawning a JS file are named, without failing the report", async () => {
  const home = tempDir();
  writeFileSync(
    join(home, ".claude.json"),
    JSON.stringify({ mcpServers: { "wa-mcp": { type: "stdio", command: "node", args: ["x"] } } }),
  );
  const report = await doctor(home, tempDir(), 1);
  expect(check(report, "mcp entries")?.ok).toBe(true);
  expect(check(report, "mcp entries")?.detail).toContain("claude-code");
  expect(check(report, "mcp entries")?.detail).toContain("wa-mcp install");
});

test("a Claude Desktop stdio entry is expected, not reported as legacy", async () => {
  const home = tempDir();
  const dir = join(home, "Library", "Application Support", "Claude");
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, "claude_desktop_config.json"),
    JSON.stringify({ mcpServers: { "wa-mcp": { command: "node", args: ["x"] } } }),
  );
  const report = await doctor(home, tempDir(), 1);
  expect(check(report, "mcp entries")?.detail ?? "").not.toContain("claude-desktop");
});

test("a renamed entry still spawning a JS file is named too", async () => {
  const home = tempDir();
  writeFileSync(
    join(home, ".claude.json"),
    JSON.stringify({
      mcpServers: {
        "whatsapp (wa-mcp)": { type: "stdio", command: "node", args: ["--bridge-url", "x"] },
      },
    }),
  );
  const report = await doctor(home, tempDir(), 1);
  expect(check(report, "mcp entries")?.detail).toContain("claude-code");
});
