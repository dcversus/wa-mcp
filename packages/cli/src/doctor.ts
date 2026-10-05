import { existsSync, statSync, writeFileSync } from "node:fs";

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
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
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
