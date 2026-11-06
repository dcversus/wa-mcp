import { existsSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { request } from "node:https";
import { resolveConfigPath } from "@wa-mcp/shared";
import { localCertPaths } from "@wa-mcp/shared/tls-cert";
import { HTTP_PLATFORMS } from "./writers.ts";

export interface DoctorCheck {
  name: string;
  ok: boolean;
  detail: string;
}

export interface DoctorOptions {
  home: string;
  dataDir: string;
  bridgeUrl: string;
  fetchFn?: typeof fetch;
  minNodeMajor: number;
  engines?: boolean;
  whichFn?: (bin: string) => Promise<boolean>;
  engine?: string;
  env?: NodeJS.ProcessEnv;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

/** The real handshake and an MCP initialize, trusting only the daemon's own
 * certificate: what a host configured with that certificate would see. */
function probeMcpOverTls(url: URL, ca: string, token: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        method: "POST",
        ca,
        agent: false,
        timeout: 5_000,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
      },
      (res) => {
        res.resume();
        resolve(res.statusCode ?? 0);
      },
    );
    req.on("timeout", () => req.destroy(new Error("timed out")));
    req.on("error", reject);
    req.end(
      JSON.stringify({
        jsonrpc: "2.0",
        id: 1,
        method: "initialize",
        params: {
          protocolVersion: "2025-06-18",
          capabilities: {},
          clientInfo: { name: "wa-mcp doctor", version: "0" },
        },
      }),
    );
  });
}

async function mcpHttpsCheck(options: DoctorOptions): Promise<DoctorCheck> {
  const name = "mcp https";
  const { certPath } = localCertPaths(options.dataDir);
  if ((options.env ?? process.env).WA_TLS === "0") {
    return { name, ok: true, detail: "turned off with WA_TLS=0" };
  }
  if (!existsSync(certPath)) {
    return { name, ok: true, detail: "no certificate yet: run wa-mcp install" };
  }
  const url = new URL(options.bridgeUrl);
  url.protocol = "https:";
  url.pathname = "/mcp";
  const tokenPath = `${options.dataDir}/token`;
  const token = existsSync(tokenPath) ? readFileSync(tokenPath, "utf8").trim() : "";
  try {
    const status = await probeMcpOverTls(url, readFileSync(certPath, "utf8"), token);
    return status === 200
      ? { name, ok: true, detail: `${url.href} answers with ${certPath}` }
      : { name, ok: false, detail: `${url.href} returned ${status}: check the token` };
  } catch (err) {
    const reason = err instanceof Error ? err.message : String(err);
    return {
      name,
      ok: false,
      detail: `${url.href} failed (${reason}): the daemon may predate TLS, run wa-mcp restart`,
    };
  }
}

function usesStdio(path: string, platform: string): boolean {
  if (!existsSync(path)) {
    return false;
  }
  const text = readFileSync(path, "utf8");
  if (platform === "codex") {
    return /\[mcp_servers\.wa-mcp\]\s*\ncommand\s*=/.test(text);
  }
  try {
    const servers = (JSON.parse(text) as { mcpServers?: Record<string, { command?: unknown }> })
      .mcpServers;
    return typeof servers?.["wa-mcp"]?.command === "string";
  } catch {
    return false;
  }
}

/** Old entries still work, so this informs rather than fails. */
function mcpEntriesCheck(home: string): DoctorCheck {
  const stale = [...HTTP_PLATFORMS].filter((platform) =>
    usesStdio(resolveConfigPath(platform, home), platform),
  );
  return {
    name: "mcp entries",
    ok: true,
    detail:
      stale.length === 0
        ? "no host that can use a URL is spawning a process"
        : `${stale.join(", ")} still spawn${stale.length === 1 ? "s" : ""} a process: run wa-mcp install to connect by URL`,
  };
}

export async function runDoctor(options: DoctorOptions): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const nodeMajor = Number(process.versions.node.split(".")[0]);
  checks.push({
    name: "node version",
    ok: nodeMajor >= options.minNodeMajor,
    detail: `node ${process.versions.node} (required >=${options.minNodeMajor})`,
  });
  let writable = false;
  try {
    const probe = `${options.dataDir}/.doctor-probe`;
    writeFileSync(probe, "x");
    writable = true;
  } catch {
    writable = false;
  }
  checks.push({ name: "data dir writable", ok: writable, detail: options.dataDir });
  const tokenPath = `${options.dataDir}/token`;
  let tokenOk = false;
  let tokenDetail = "missing";
  if (existsSync(tokenPath)) {
    const mode = statSync(tokenPath).mode & 0o777;
    if (process.platform === "win32") {
      tokenOk = true;
      tokenDetail = "present (posix perms not checked on windows)";
    } else if (mode === 0o600) {
      tokenOk = true;
      tokenDetail = "present, mode 0600";
    } else {
      tokenDetail = `present but mode ${mode.toString(8)} (expected 600)`;
    }
  }
  checks.push({ name: "bridge token", ok: tokenOk, detail: tokenDetail });
  let healthOk = false;
  let healthDetail = "unreachable";
  try {
    const fetchFn = options.fetchFn ?? fetch;
    const response = await fetchFn(`${options.bridgeUrl}/health`);
    healthOk = response.ok;
    healthDetail = response.ok
      ? `reachable at ${options.bridgeUrl}`
      : `returned ${response.status}`;
  } catch (err) {
    healthDetail = `unreachable at ${options.bridgeUrl} — is the daemon running? (${
      err instanceof Error ? err.message : String(err)
    })`;
  }
  checks.push({ name: "bridge health", ok: healthOk, detail: healthDetail });
  if (healthOk) {
    checks.push(await mcpHttpsCheck(options));
  }
  checks.push(mcpEntriesCheck(options.home));
  if (options.engines === true) {
    const whichFn =
      options.whichFn ??
      (async (bin: string) => {
        try {
          const { execFile } = await import("node:child_process");
          return await new Promise<boolean>((resolve) => {
            execFile("which", [bin], (err: unknown) => resolve(err === null));
          });
        } catch {
          return false;
        }
      });
    const { loadConfig, maskSecret } = await import("./config-store.ts");
    let selectedEngine = options.engine ?? "mock";
    let apiKey = "";
    try {
      const config = loadConfig(options.dataDir);
      selectedEngine = options.engine ?? config.transcription?.engine ?? "mock";
      apiKey = config.transcription?.api_key ?? "";
    } catch {
      selectedEngine = options.engine ?? process.env.WA_TRANSCRIBE_ENGINE ?? "mock";
      apiKey = process.env.WA_OPENAI_API_KEY ?? "";
    }
    const engineChecks: DoctorCheck[] = [];
    const optional = (name: string, present: boolean, hint: string) => {
      engineChecks.push({
        name: `engine ${name}`,
        ok: true,
        detail: present ? `available` : `not-configured (optional) — ${hint}`,
      });
    };
    const ffmpeg = await whichFn(process.env.WA_FFMPEG_BIN ?? "ffmpeg");
    optional("ffmpeg (video/audio)", ffmpeg, "brew install ffmpeg");
    if (selectedEngine === "openai") {
      const keyOk = apiKey.length > 0;
      engineChecks.push({
        name: "engine openai",
        ok: keyOk,
        detail: keyOk
          ? `configured (key ${maskSecret(apiKey)})`
          : "not-configured — set the key with: wa-mcp config set transcription.api_key <key>",
      });
    }
    if (selectedEngine === "whisper-local") {
      const bin = await whichFn(process.env.WA_WHISPER_BIN ?? "whisper-cli");
      let modelOk = false;
      try {
        const modelPath =
          process.env.WA_WHISPER_MODEL ?? loadConfig(options.dataDir).transcription?.model ?? "";
        modelOk = modelPath.length > 0 && existsSync(modelPath);
      } catch {
        modelOk = false;
      }
      const binOk = bin;
      engineChecks.push({
        name: "engine whisper-local",
        ok: binOk && modelOk,
        detail:
          `${binOk ? "binary available" : "binary missing — brew install whisper-cpp"}; ` +
          `${modelOk ? "model set" : "model missing — set WA_WHISPER_MODEL to a ggml .bin path"}`,
      });
    }
    if (selectedEngine === "mlx") {
      const mlx = await whichFn(process.env.WA_MLX_BIN ?? "mlx_whisper");
      optional("mlx", mlx, "pip install mlx-whisper");
    }
    const pdftotext = await whichFn("pdftotext");
    optional("pdftotext (PDF text)", pdftotext, "brew install poppler");
    checks.push(...engineChecks);
  }
  return { ok: checks.every((check) => check.ok), checks };
}
