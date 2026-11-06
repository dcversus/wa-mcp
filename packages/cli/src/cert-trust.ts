import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

const VARIABLE = "NODE_EXTRA_CA_CERTS";

export type CertTrust =
  | { status: "added" | "present" }
  /** another CA file is already set; the variable holds one path */
  | { status: "conflict"; current: string }
  | { status: "unreadable" };

interface ClaudeSettings {
  env?: Record<string, string>;
  [key: string]: unknown;
}

function settingsPath(home: string): string {
  return join(home, ".claude", "settings.json");
}

function readSettings(path: string): ClaudeSettings | null {
  if (!existsSync(path)) {
    return {};
  }
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    return parsed !== null && typeof parsed === "object" ? (parsed as ClaudeSettings) : null;
  } catch {
    return null;
  }
}

function writeSettings(path: string, settings: ClaudeSettings): void {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
}

/** Claude Code reads extra trust anchors from this variable, and honours it from
 * its settings file, so it is the one host whose trust a config write can set
 * up. The value is left alone if it already names something else. */
export function ensureClaudeCertTrust(
  home: string,
  certPath: string,
  env: NodeJS.ProcessEnv,
): CertTrust {
  const fromShell = env[VARIABLE];
  if (fromShell !== undefined && fromShell.length > 0 && fromShell !== certPath) {
    return { status: "conflict", current: fromShell };
  }
  const path = settingsPath(home);
  const settings = readSettings(path);
  if (settings === null) {
    return { status: "unreadable" };
  }
  const current = settings.env?.[VARIABLE];
  if (current === certPath) {
    return { status: "present" };
  }
  if (current !== undefined) {
    return { status: "conflict", current };
  }
  writeSettings(path, { ...settings, env: { ...settings.env, [VARIABLE]: certPath } });
  return { status: "added" };
}

/** Takes back what ensureClaudeCertTrust added; anything else stays. */
export function removeClaudeCertTrust(home: string, certPath: string): boolean {
  const path = settingsPath(home);
  const settings = readSettings(path);
  if (settings?.env?.[VARIABLE] !== certPath) {
    return false;
  }
  const { [VARIABLE]: _removed, ...env } = settings.env;
  const { env: _previous, ...rest } = settings;
  writeSettings(path, Object.keys(env).length === 0 ? rest : { ...rest, env });
  return true;
}
