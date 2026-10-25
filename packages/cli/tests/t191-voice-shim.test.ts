import {
  chmodSync,
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { afterEach, expect, test, vi } from "vite-plus/test";
import { main } from "../src/bin.ts";
import { CLAUDE_CODE_REC_ARGS, SHIM_MARKER } from "../src/voice-dictation.ts";

const roots: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  for (const root of roots.splice(0)) {
    rmSync(root, { recursive: true, force: true });
  }
});

async function run(argv: string[]): Promise<string> {
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  const err = vi.spyOn(console, "error").mockImplementation(() => {});
  try {
    await main(argv);
  } catch {
    // commands may exit non-zero; the captured output is what matters
  }
  const out =
    log.mock.calls.map((call) => call.join(" ")).join("\n") +
    "\n" +
    err.mock.calls.map((call) => call.join(" ")).join("\n");
  log.mockRestore();
  err.mockRestore();
  return out;
}

function setup(): { home: string; dataDir: string; binDir: string; flags: string[] } {
  const root = mkdtempSync(join(tmpdir(), "t191-voice-"));
  roots.push(root);
  const home = join(root, "home");
  const dataDir = join(home, ".wa-mcp");
  const binDir = join(root, "bin");
  return {
    home,
    dataDir,
    binDir,
    flags: ["--home", home, "--data-dir", dataDir, "--token", "tok"],
  };
}

function perms(path: string): number {
  return statSync(path).mode & 0o777;
}

test("T191 — the pinned Claude Code rec argv is the one from claude 2.1.310", () => {
  expect(CLAUDE_CODE_REC_ARGS).toEqual([
    "-q",
    "--buffer",
    "1024",
    "-t",
    "raw",
    "-r",
    "16000",
    "-e",
    "signed",
    "-b",
    "16",
    "-c",
    "1",
    "-",
    "silence",
    "1",
    "0.1",
    "3%",
    "1",
    "2.0",
    "3%",
  ]);
});

test("T191 — voice install writes rec+sox shims and a 0600 env file; idempotent", async () => {
  const { dataDir, binDir, flags } = setup();
  const out = await run([
    "voice",
    "install",
    "--bin-dir",
    binDir,
    "--bridge-url",
    "http://127.0.0.1:8080",
    ...flags,
  ]);
  expect(out).toContain(`voice: ${join(binDir, "rec")}`);
  expect(out).toContain(`voice: ${join(binDir, "sox")}`);
  const rec = readFileSync(join(binDir, "rec"), "utf8");
  expect(rec).toContain(SHIM_MARKER);
  expect(readFileSync(join(binDir, "sox"), "utf8")).toBe(rec);
  expect(perms(join(binDir, "rec"))).toBe(0o755);
  const envPath = join(dataDir, "voice-shim.env");
  const env = readFileSync(envPath, "utf8");
  expect(env).toContain("WA_VOICE_BRIDGE_URL=http://127.0.0.1:8080");
  expect(env).toContain("WA_VOICE_TOKEN=tok");
  expect(perms(envPath)).toBe(0o600);
  await run([
    "voice",
    "install",
    "--bin-dir",
    binDir,
    "--bridge-url",
    "http://127.0.0.1:8080",
    ...flags,
  ]);
  expect(existsSync(join(binDir, "rec"))).toBe(true);
});

test("T191 — voice install refuses a foreign rec unless --force; uninstall removes ours only", async () => {
  const { home, dataDir, binDir, flags } = setup();
  const { flags: _f, ...rest } = { flags };
  void rest;
  await run([
    "voice",
    "install",
    "--bin-dir",
    binDir,
    "--bridge-url",
    "http://127.0.0.1:8080",
    ...flags,
  ]);
  const foreign = join(binDir, "sox");
  rmSync(join(binDir, "sox"));
  writeFileSync(foreign, "#!/bin/sh\necho real sox\n");
  const refused = await run([
    "voice",
    "install",
    "--bin-dir",
    binDir,
    "--bridge-url",
    "http://127.0.0.1:8080",
    ...flags,
  ]);
  expect(refused).toContain("refusing");
  expect(readFileSync(foreign, "utf8")).not.toContain(SHIM_MARKER);
  const forced = await run([
    "voice",
    "install",
    "--bin-dir",
    binDir,
    "--bridge-url",
    "http://127.0.0.1:8080",
    "--force",
    ...flags,
  ]);
  expect(forced).toContain(`voice: ${join(binDir, "sox")}`);
  expect(readFileSync(foreign, "utf8")).toContain(SHIM_MARKER);

  const removed = await run(["voice", "uninstall", "--bin-dir", binDir, ...flags]);
  expect(removed).toContain("removed");
  expect(existsSync(join(binDir, "rec"))).toBe(false);
  expect(existsSync(join(binDir, "sox"))).toBe(false);
  expect(existsSync(join(dataDir, "voice-shim.env"))).toBe(false);
  void home;
});

function probe(binDir: string, name: string): Promise<{ code: number | null; stdout: string }> {
  return new Promise((resolve) => {
    const child = spawn(join(binDir, name), ["--version"]);
    let stdout = "";
    child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString("utf8")));
    child.on("close", (code) => resolve({ code, stdout }));
  });
}

function recordOnce(binDir: string): Promise<{ code: number | null; stdout: Buffer }> {
  return new Promise((resolve) => {
    const child = spawn(join(binDir, "rec"), CLAUDE_CODE_REC_ARGS);
    const chunks: Buffer[] = [];
    child.stdout.on("data", (chunk: Buffer) => chunks.push(Buffer.from(chunk)));
    child.on("close", (code) => resolve({ code, stdout: Buffer.concat(chunks) }));
  });
}

test(
  "T191 — installed shims answer the Claude Code probes and stream PCM for the record argv",
  { timeout: 15000 },
  async () => {
    const { home, dataDir, binDir, flags } = setup();
    const { createServer } = await import("node:http");
    const PCM = Buffer.from([9, 0, 8, 0, 7, 0]);
    const server = createServer((req, res) => {
      if (req.headers.authorization !== "Bearer tok") {
        res.writeHead(401).end();
        return;
      }
      if (req.url === "/api/voice/next.pcm") {
        res.writeHead(200, { "content-type": "audio/L16;rate=16000;channels=1" });
        res.end(PCM);
      } else {
        res.writeHead(404).end();
      }
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    const out = await run([
      "voice",
      "install",
      "--bin-dir",
      binDir,
      "--bridge-url",
      `http://127.0.0.1:${port}`,
      ...flags,
    ]);
    expect(out).toContain("voice:");

    const recProbe = await probe(binDir, "rec");
    expect(recProbe.code).toBe(0);
    expect(recProbe.stdout).toContain("sox");
    const soxProbe = await probe(binDir, "sox");
    expect(soxProbe.code).toBe(0);

    const recorded = await recordOnce(binDir);
    expect(recorded.code).toBe(0);
    expect(recorded.stdout).toEqual(PCM);
    server.close();
    void home;
    void dataDir;
  },
);

test(
  "T191 — voice test reports probe status and served bytes against the bridge",
  { timeout: 15000 },
  async () => {
    const { home, dataDir, binDir, flags } = setup();
    const { createServer } = await import("node:http");
    const PCM = Buffer.from([4, 0, 3, 0]);
    const server = createServer((req, res) => {
      if (req.url === "/api/voice/next" && req.headers.authorization === "Bearer tok") {
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({ pending: 1, next: { id: "V1", senderName: "Bob" } }));
        return;
      }
      if (req.url === "/api/voice/next.pcm" && req.headers.authorization === "Bearer tok") {
        res.writeHead(200, { "content-type": "audio/L16;rate=16000;channels=1" });
        res.end(PCM);
        return;
      }
      res.writeHead(req.headers.authorization ? 404 : 401).end();
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const port = (server.address() as { port: number }).port;
    await run([
      "voice",
      "install",
      "--bin-dir",
      binDir,
      "--bridge-url",
      `http://127.0.0.1:${port}`,
      ...flags,
    ]);
    const out = await run([
      "voice",
      "test",
      "--bin-dir",
      binDir,
      "--bridge-url",
      `http://127.0.0.1:${port}`,
      ...flags,
    ]);
    expect(out).toContain("rec --version: ok");
    expect(out).toContain("sox --version: ok");
    expect(out).toContain("pending: 1");
    expect(out).toContain("served");
    expect(out).toContain(`${PCM.length} bytes`);
    server.close();
    void home;
    void dataDir;
    void chmodSync;
  },
);
