import { spawn } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

/** R2-14: single marker line identifying our shims (never overwrite a
 * foreign sox/rec without --force). */
export const SHIM_MARKER = "# wa-mcp voice-dictation shim";

/** R2-14: the exact argv Claude Code 2.1.310 spawns on the SoX fallback
 * path (verified from the binary's voice recorder module). stdout must be
 * raw signed 16-bit LE PCM, 16 kHz, mono; SIGTERM stops. */
export const CLAUDE_CODE_REC_ARGS = [
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
] as const;

const SHIM_NAMES = ["rec", "sox"] as const;

export interface VoiceCtx {
  fetchFn: typeof fetch;
  print: (line: string) => void;
}

export interface VoiceOpts {
  baseUrl: string;
  token: string;
  dataDir: string;
  action: string;
  flags: Record<string, string>;
  version?: string;
}

function shellQuote(value: string): string {
  return `'${value.replaceAll("'", `'\\''`)}'`;
}

function shimScript(envPath: string, version: string): string {
  return [
    "#!/bin/sh",
    `${SHIM_MARKER} v${version}`,
    "# Claude Code /voice dictation fallback (sox rec): streams the next",
    "# WhatsApp voice note as raw signed 16-bit LE PCM 16kHz mono on stdout.",
    `ENV_FILE=${shellQuote(envPath)}`,
    'if [ "$1" = "--version" ]; then echo "sox: wa-mcp voice-dictation shim v' +
      version +
      '"; exit 0; fi',
    '. "$ENV_FILE"',
    'AUTH="Authorization: Bearer $WA_VOICE_TOKEN"',
    'URL="${WA_VOICE_BRIDGE_URL%/}/api/voice/next.pcm"',
    "if command -v curl >/dev/null 2>&1; then",
    '  exec curl -fsSL -H "$AUTH" "$URL"',
    "else",
    '  exec wget -q -O - --header="$AUTH" "$URL"',
    "fi",
    "",
  ].join("\n");
}

function isOurs(path: string): boolean {
  if (!existsSync(path)) {
    return false;
  }
  try {
    return readFileSync(path, "utf8").includes(SHIM_MARKER);
  } catch {
    return false;
  }
}

export async function runVoice(ctx: VoiceCtx, opts: VoiceOpts): Promise<number> {
  if (opts.action === "install") {
    return voiceInstall(ctx, opts);
  }
  if (opts.action === "uninstall") {
    return voiceUninstall(ctx, opts);
  }
  if (opts.action === "test") {
    return voiceTest(ctx, opts);
  }
  ctx.print(`voice: unknown action "${opts.action}" — use install | uninstall | test`);
  return 2;
}

function resolveBinDir(opts: VoiceOpts): string {
  const fromFlag = opts.flags["bin-dir"];
  if (fromFlag !== undefined && fromFlag.length > 0) {
    return fromFlag;
  }
  return join(opts.dataDir, "..", ".local", "bin");
}

function voiceInstall(ctx: VoiceCtx, opts: VoiceOpts): number {
  if (opts.token.length === 0) {
    ctx.print("voice: no bridge token — start the bridge once or pass --token");
    return 1;
  }
  const binDir = resolveBinDir(opts);
  mkdirSync(binDir, { recursive: true });
  mkdirSync(opts.dataDir, { recursive: true });
  const envPath = join(opts.dataDir, "voice-shim.env");
  const script = shimScript(envPath, opts.version ?? "0.1.0");
  let refused = false;
  const force = opts.flags.force !== undefined;
  for (const name of SHIM_NAMES) {
    const target = join(binDir, name);
    if (existsSync(target) && !isOurs(target) && !force) {
      ctx.print(`voice: refusing to overwrite foreign ${target} (use --force)`);
      refused = true;
      continue;
    }
    writeFileSync(target, script);
    chmodSync(target, 0o755);
    ctx.print(`voice: ${target}`);
  }
  writeFileSync(envPath, `WA_VOICE_BRIDGE_URL=${opts.baseUrl}\nWA_VOICE_TOKEN=${opts.token}\n`, {
    mode: 0o600,
  });
  chmodSync(envPath, 0o600);
  ctx.print(`voice: ${envPath}`);
  if (!(process.env.PATH ?? "").split(":").includes(binDir)) {
    ctx.print(`voice: warning: ${binDir} is not on PATH for Claude Code to find rec`);
  }
  return refused ? 1 : 0;
}

function voiceUninstall(ctx: VoiceCtx, opts: VoiceOpts): number {
  const binDir = resolveBinDir(opts);
  let removed = 0;
  for (const name of SHIM_NAMES) {
    const target = join(binDir, name);
    if (!existsSync(target)) {
      continue;
    }
    if (isOurs(target)) {
      rmSync(target);
      removed += 1;
      ctx.print(`voice: removed ${target}`);
    } else {
      ctx.print(`voice: kept foreign ${target}`);
    }
  }
  const envPath = join(opts.dataDir, "voice-shim.env");
  if (existsSync(envPath)) {
    rmSync(envPath);
    ctx.print(`voice: removed ${envPath}`);
  }
  if (removed === 0) {
    ctx.print("voice: nothing to remove");
  }
  return 0;
}

function probe(ctx: VoiceCtx, binDir: string, name: string): Promise<boolean> {
  return new Promise((resolve) => {
    const child = spawn(join(binDir, name), ["--version"]);
    child.on("error", () => resolve(false));
    child.on("close", (code) => {
      ctx.print(`${name} --version: ${code === 0 ? "ok" : `exit ${code ?? "signal"}`}`);
      resolve(code === 0);
    });
  });
}

async function voiceTest(ctx: VoiceCtx, opts: VoiceOpts): Promise<number> {
  const binDir = resolveBinDir(opts);
  const recOk = await probe(ctx, binDir, "rec");
  const soxOk = await probe(ctx, binDir, "sox");
  let exit = recOk && soxOk ? 0 : 1;
  if (!opts.baseUrl.startsWith("http")) {
    ctx.print("voice: bridge url missing — pass --bridge-url");
    return 1;
  }
  try {
    const peek = await ctx.fetchFn(`${opts.baseUrl}/api/voice/next`, {
      headers: { authorization: `Bearer ${opts.token}` },
    });
    if (peek.ok) {
      const body = (await peek.json()) as {
        pending: number;
        next: { id: string; chatJid?: string; senderName: string | null } | null;
      };
      ctx.print(`pending: ${body.pending}`);
      if (body.next !== null) {
        ctx.print(
          `next voice note: ${body.next.id} from ${body.next.senderName ?? body.next.chatJid ?? "unknown"}`,
        );
      }
    } else {
      ctx.print(`bridge /api/voice/next: HTTP ${peek.status}`);
      exit = 1;
    }
  } catch {
    ctx.print("voice: bridge unreachable");
    exit = 1;
  }
  if (!recOk) {
    return exit;
  }
  const served = await new Promise<{ code: number | null; bytes: number }>((resolve) => {
    const child = spawn(join(binDir, "rec"), [...CLAUDE_CODE_REC_ARGS]);
    let bytes = 0;
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.length;
    });
    child.on("error", () => resolve({ code: 1, bytes }));
    child.on("close", (code) => resolve({ code, bytes }));
  });
  ctx.print(
    `served ${served.bytes} bytes via the Claude Code rec argv (exit ${served.code ?? "signal"})`,
  );
  if (served.bytes === 0) {
    ctx.print("voice: no PCM served — no pending voice note or bridge/ffmpeg error");
    exit = 1;
  }
  return exit;
}
